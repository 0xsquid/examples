import * as bitcoin from 'bitcoinjs-lib';
import axios from 'axios';
import * as dotenv from 'dotenv';
import ECPairFactory from 'ecpair';
import * as ecc from 'tiny-secp256k1';

dotenv.config();

// Initialize the ECC library for bitcoinjs-lib
bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

// Load environment variables
const btcPrivateKey: string = process.env.BITCOIN_PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID || 'your-integrator-id';
const BITCOIN_NETWORK = bitcoin.networks.bitcoin;

if (!btcPrivateKey) {
  console.error("Please provide a BITCOIN_PRIVATE_KEY in your .env file.");
  process.exit(1);
}

// Create key pair from WIF (starts with L or K for mainnet compressed)
const keyPair = ECPair.fromWIF(btcPrivateKey, BITCOIN_NETWORK);

// Define chain and token config
const fromChainId = "bitcoin";
const toChainId = "42161"; // Arbitrum
const fromToken = "satoshi";
const toToken = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // USDC on Arbitrum

// Function to fetch the route from Squid V2 API
const getRoute = async (params: any) => {
  try {
    const result = await axios.post(
      "https://v2.api.squidrouter.com/v2/route",
      params,
      {
        headers: {
          "x-integrator-id": integratorId,
          "Content-Type": "application/json",
        },
      }
    );
    const requestId = result.headers["x-request-id"];
    return { data: result.data, requestId: requestId };
  } catch (error: any) {
    if (error.response) {
      console.error("API error:", JSON.stringify(error.response.data, null, 2));
    }
    console.error("Error with parameters:", params);
    throw error;
  }
};

// Function to get deposit address for Chainflip fallback flow
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

// Get the bridge type for status tracking in Chainflip fallback flow
const getBridgeType = (toChain: string): string => {
  return toChain === "42161" ? "chainflip" : "chainflipmultihop";
};

// Status API call
const getStatus = async (params: { transactionId: string; quoteId?: string; bridgeType?: string }) => {
  try {
    const queryParams: any = {
      transactionId: params.transactionId,
      fromChainId: fromChainId,
      toChainId: toChainId,
    };
    if (params.quoteId) {
      queryParams.quoteId = params.quoteId;
    }
    if (params.bridgeType) {
      queryParams.bridgeType = params.bridgeType;
    }

    const result = await axios.get("https://v2.api.squidrouter.com/v2/status", {
      params: queryParams,
      headers: {
        "x-integrator-id": integratorId,
      },
    });
    return result.data;
  } catch (error: any) {
    if (error.response) {
      console.error("API error:", error.response.data);
    }
    console.error("Error checking status with parameters:", params);
    throw error;
  }
};

// Poll the status API until the transaction completes
const monitorTransactionStatus = async (params: { transactionId: string; quoteId?: string; bridgeType?: string }) => {
  const completedStatuses = ["success", "partial_success", "needs_gas", "not_found", "refund"];
  const maxRetries = 30;
  let retryCount = 0;
  let status;

  console.log(`Starting transaction status monitoring for ID: ${params.transactionId}...`);

  do {
    try {
      status = await getStatus(params);
      console.log(`Route status: ${status.squidTransactionStatus}`);

      if (!completedStatuses.includes(status.squidTransactionStatus)) {
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
        console.error("Error checking status:", error.message);
        break;
      }
    }
  } while (status && !completedStatuses.includes(status.squidTransactionStatus));

  if (status) {
    console.log(`Transaction finished with status: ${status.squidTransactionStatus}`);
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

// Main Execution
(async () => {
  try {
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

    console.log("Requesting Squid Route with parameters:", JSON.stringify(params, null, 2));

    const routeResult = await getRoute(params);
    const route = routeResult.data.route;
    const quoteId = route.quoteId || routeResult.data?.quoteId || route?.estimate?.quoteId;
    const requestId = routeResult.requestId;

    console.log("Squid Route response received.");
    console.log(`Request ID: ${requestId}`);
    console.log(`Quote ID: ${quoteId}`);

    const transactionRequest = route.transactionRequest;
    if (!transactionRequest) {
      throw new Error("No transactionRequest found in route response.");
    }

    // Determine if we got an Intent route or a standard deposit-address route
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

      // Monitor Status for Squid Intents
      // QuoteId is REQUIRED for Squid Intents status polling to prevent refunds
      await monitorTransactionStatus({
        transactionId: txHash,
        quoteId: quoteId,
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

      // Monitor Status for Chainflip
      // When bridging from Bitcoin/Solana via Chainflip deposit addresses, we poll status
      // using the chainflipStatusTrackingId as transactionId, and bridgeType as chainflip/chainflipmultihop
      await monitorTransactionStatus({
        transactionId: depositAddressResult.chainflipStatusTrackingId,
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
