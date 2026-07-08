import { Squid } from "@0xsquid/sdk";
import * as bitcoin from 'bitcoinjs-lib';
import axios from 'axios';
import * as dotenv from 'dotenv';
import ECPairFactory from 'ecpair';
import * as ecc from 'tiny-secp256k1';

dotenv.config();

// Initialize the ECC library for bitcoinjs-lib
bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

// Retrieve environment variables
const btcPrivateKey: string = process.env.BITCOIN_PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID || 'inkblot-api';
const BITCOIN_NETWORK = bitcoin.networks.bitcoin;

if (!btcPrivateKey) {
  console.error("Please provide a BITCOIN_PRIVATE_KEY in your .env file.");
  process.exit(1);
}

// Create key pair from WIF
const keyPair = ECPair.fromWIF(btcPrivateKey, BITCOIN_NETWORK);

// Define chain and token config
const fromChainId = "bitcoin";
const toChainId = "42161"; // Arbitrum
const fromToken = "satoshi";
const toToken = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // USDC on Arbitrum

// Initialize Squid SDK
const getSDK = (): Squid => {
  return new Squid({
    baseUrl: "https://v2.api.squidrouter.com",
    integratorId: integratorId,
  });
};

// Get the bridge type for status tracking in Chainflip fallback flow
const getBridgeType = (toChain: string): string => {
  return toChain === "42161" ? "chainflip" : "chainflipmultihop";
};

// Fallback flow: Get deposit address
const getDepositAddress = async (transactionRequest: any) => {
  try {
    const result = await axios.post(
      "https://v2.api.squidrouter.com/v2/deposit-address",
      transactionRequest,
      {
        headers: {
          "x-integrator-id": integratorId,
          "Content-Type": "application/json",
        },
      }
    );
    return result.data;
  } catch (error: any) {
    if (error.response) {
      console.error("API error:", error.response.data);
    }
    console.error("Error getting deposit address:", error);
    throw error;
  }
};

// Fallback flow: Create and broadcast a transaction manually to a deposit address
const createAndBroadcastTransaction = async (
  keypair: ReturnType<typeof ECPair.fromWIF>,
  destinationAddress: string,
  amountSats: string
) => {
  try {
    const sourceAddress = bitcoin.payments.p2wpkh({ pubkey: keypair.publicKey, network: BITCOIN_NETWORK }).address!;
    console.log(`Fetching UTXOs for address: ${sourceAddress}...`);
    const utxoResponse = await axios.get(`https://blockstream.info/api/address/${sourceAddress}/utxo`);
    const utxos = utxoResponse.data;

    const psbt = new bitcoin.Psbt({ network: BITCOIN_NETWORK });
    let totalInput = BigInt(0);

    for (const utxo of utxos) {
      const txResponse = await axios.get(`https://blockstream.info/api/tx/${utxo.txid}/hex`);
      const txHex = txResponse.data;
      
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({ pubkey: keypair.publicKey, network: BITCOIN_NETWORK }).output!,
          value: BigInt(utxo.value),
        },
      });
      totalInput = totalInput + BigInt(utxo.value);
    }

    const amount = BigInt(amountSats);
    psbt.addOutput({
      address: destinationAddress,
      value: amount,
    });

    const fee = BigInt(800); // 800 satoshis flat fee
    const changeAmount = totalInput - amount - fee;
    if (changeAmount > BigInt(546)) { // Dust threshold
      psbt.addOutput({
        address: sourceAddress,
        value: changeAmount,
      });
    }

    psbt.signAllInputs(keypair);
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    const txHex = tx.toHex();

    console.log("Broadcasting manual transaction...");
    await axios.post('https://blockstream.info/api/tx', txHex);
    return tx.getId();
  } catch (error) {
    console.error('Error creating/broadcasting manual transaction:', error);
    throw error;
  }
};

// Monitor transaction status using Squid SDK
const monitorTransactionStatus = async (
  squid: Squid,
  getStatusParams: {
    transactionId: string;
    requestId?: string;
    integratorId: string;
    fromChainId: string;
    toChainId: string;
    quoteId?: string;
    bridgeType?: string;
  }
) => {
  const completedStatuses = ["success", "partial_success", "needs_gas", "not_found", "refund"];
  const maxRetries = 30;
  let retryCount = 0;
  let status: any;

  console.log(`Starting status monitoring via Squid SDK for transaction ID: ${getStatusParams.transactionId}...`);

  do {
    try {
      status = await squid.getStatus({
        transactionId: getStatusParams.transactionId,
        requestId: getStatusParams.requestId,
        integratorId: getStatusParams.integratorId,
        fromChainId: getStatusParams.fromChainId,
        toChainId: getStatusParams.toChainId,
        quoteId: (getStatusParams.quoteId || getStatusParams.requestId || "") as string,
        bridgeType: getStatusParams.bridgeType
      } as any);
      
      console.log(`Route status: ${status.squidTransactionStatus}`);

      if (status.squidTransactionStatus && !completedStatuses.includes(status.squidTransactionStatus)) {
        await new Promise((resolve) => setTimeout(resolve, 30000));
      }
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        retryCount++;
        if (retryCount >= maxRetries) {
          console.error("Max retries reached. Transaction not found.");
          break;
        }
        console.log("Transaction not found. Retrying in 30s...");
        await new Promise((resolve) => setTimeout(resolve, 30000));
        continue;
      } else {
        console.error("Error checking status:", error.message || error);
        break;
      }
    }
  } while (status && status.squidTransactionStatus && !completedStatuses.includes(status.squidTransactionStatus));

  if (status) {
    console.log(`Transaction finished with status: ${status.squidTransactionStatus}`);
  }
};

// Main execution function
(async () => {
  try {
    // Initialize Squid SDK
    const squid = getSDK();
    await squid.init();
    console.log("Initialized Squid SDK");

    const sourceAddress = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: BITCOIN_NETWORK }).address!;
    console.log(`Source Bitcoin address (SegWit): ${sourceAddress}`);

    const params = {
      fromAddress: sourceAddress,
      fromChain: fromChainId,
      fromToken: fromToken,
      fromAmount: "8000", // Amount in satoshis (Intents have very low minimums, e.g. 8000 satoshis)
      toChain: toChainId,
      toToken: toToken,
      toAddress: "0xC601C9100f8420417A94F6D63e5712C21029525e", // Destination EVM Address
      quoteOnly: false
    };

    console.log("Requesting route via Squid SDK with params:", JSON.stringify(params, null, 2));

    const { route, requestId } = await squid.getRoute(params);
    const quoteId = (route as any).estimate?.quoteId || (route as any).quoteId || (route as any).estimate?.actions?.[0]?.coralV2Order?.quoteId;

    console.log("Route response received.");
    console.log(`Request ID: ${requestId}`);
    console.log(`Quote ID: ${quoteId}`);

    const transactionRequest = route.transactionRequest as any;
    if (!transactionRequest) {
      throw new Error("No transactionRequest found in route response.");
    }

    // Determine the execution flow
    const txType = transactionRequest.transaction_request_type || transactionRequest.type;
    console.log(`Transaction Request Type: ${txType}`);

    if (txType === "DEPOSIT_ADDRESS_CALLDATA") {
      // --- Squid Intents Flow ---
      console.log("Executing Squid Intents Flow (PSBT Signing)...");
      const psbtHex = transactionRequest.data;
      if (!psbtHex) {
        throw new Error("No PSBT transaction data found in transactionRequest.");
      }

      console.log("Deserializing PSBT from route transaction data...");
      const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: BITCOIN_NETWORK });

      console.log("Signing PSBT inputs...");
      psbt.signAllInputs(keyPair);

      console.log("Finalizing PSBT inputs...");
      psbt.finalizeAllInputs();

      const tx = psbt.extractTransaction();
      const txHex = tx.toHex();
      const txHash = tx.getId();

      console.log(`Broadcasting transaction to Bitcoin Network...`);
      await axios.post('https://blockstream.info/api/tx', txHex);
      
      console.log(`Transaction Hash: ${txHash}`);
      console.log(`Bitcoin Explorer: https://mempool.space/tx/${txHash}`);

      // Poll transaction status using Squid SDK getStatus
      // QuoteId is REQUIRED for Squid Intents status polling to prevent refunds
      await monitorTransactionStatus(squid, {
        transactionId: txHash,
        requestId: requestId || "",
        integratorId: integratorId,
        fromChainId: fromChainId,
        toChainId: toChainId,
        quoteId: quoteId || requestId || "",
      });

    } else if (txType === "CHAINFLIP_DEPOSIT_ADDRESS") {
      // --- Chainflip Fallback Flow ---
      console.log("Executing Chainflip Fallback Flow...");
      
      const depositAddressResult = await getDepositAddress(transactionRequest);
      console.log("Deposit address result received:", depositAddressResult);

      const txHash = await createAndBroadcastTransaction(
        keyPair,
        depositAddressResult.depositAddress,
        depositAddressResult.amount
      );

      console.log(`Transaction Hash: ${txHash}`);
      console.log(`Bitcoin Explorer: https://mempool.space/tx/${txHash}`);

      // Poll transaction status using Squid SDK getStatus
      // For Chainflip deposit address swaps, we pass bridgeType and chainflipStatusTrackingId
      await monitorTransactionStatus(squid, {
        transactionId: depositAddressResult.chainflipStatusTrackingId,
        requestId: requestId || "",
        integratorId: integratorId,
        fromChainId: fromChainId,
        toChainId: toChainId,
        quoteId: quoteId || requestId || "",
        bridgeType: getBridgeType(toChainId),
      });

    } else {
      throw new Error(`Unsupported transaction request type: ${txType}`);
    }

  } catch (error: any) {
    console.error("An error occurred during execution:", error.message || error);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
})();
