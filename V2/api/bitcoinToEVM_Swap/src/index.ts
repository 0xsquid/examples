import * as bitcoin from 'bitcoinjs-lib';
import axios from 'axios';
import * as dotenv from 'dotenv';
import ECPairFactory from 'ecpair';
import * as ecc from 'tiny-secp256k1';
dotenv.config();

// Initialize the ECC library
bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);

// Load environment variables from .env file
const btcPrivateKey: string = process.env.BITCOIN_PRIVATE_KEY!; // Starting with L for mainnet
const integratorId: string = process.env.INTEGRATOR_ID!;
const BITCOIN_NETWORK = bitcoin.networks.bitcoin;

// Create key pair from WIF (Wallet Import Format - starts with L for mainnet compressed)
const keyPair = ECPair.fromWIF(btcPrivateKey, BITCOIN_NETWORK);

// Define chain and token addresses
const fromChainId = "bitcoin";
const toChainId = "42161"; // Arbitrum
const fromToken = "satoshi";
const toToken = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // USDC

// Function to get the optimal route for the swap using Squid API
const getRoute = async (params: any) => {
  try {
    const result = await axios.post(
      "https://apiplus.squidrouter.com/v2/route",
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
      console.error("API error:", error.response.data);
    }
    console.error("Error with parameters:", params);
    throw error;
  }
};

// Add helper function to determine bridge type
const getBridgeType = (toChain: string): string => {
  return toChain === "42161" ? "chainflip" : "chainflipmultihop";
};

// Add new function to get deposit address
const getDepositAddress = async (transactionRequest: any) => {
  try {
    const result = await axios.post(
      "https://apiplus.squidrouter.com/v2/deposit-address",
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

// Function to get status
const getStatus = async (params: any) => {
  try {
    const result = await axios.get("https://apiplus.squidrouter.com/v2/status", {
      params: {
        transactionId: params.chainflipId,
        fromChainId: fromChainId,
        toChainId: toChainId,
        bridgeType: getBridgeType(toChainId)
      },
      headers: {
        "x-integrator-id": integratorId,
      },
    });
    return result.data;
  } catch (error: any) {
    if (error.response) {
      console.error("API error:", error.response.data);
    }
    console.error("Error with parameters:", params);
    throw error;
  }
};

// Function to check transaction status
const updateTransactionStatus = async (chainflipId: string, requestId: string) => {
  const getStatusParams = {
    chainflipId,
    fromChainId,
    toChainId,
    bridgeType: getBridgeType(toChainId)
  };

  let status;
  const completedStatuses = ["success", "partial_success", "needs_gas", "not_found"];
  const maxRetries = 20;
  let retryCount = 0;

  do {
    try {
      status = await getStatus(getStatusParams);
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
        console.log("Transaction not found. Retrying...");
        await new Promise((resolve) => setTimeout(resolve, 30000));
        continue;
      } else {
        console.error("Error checking status:", error.message);
        break;
      }
    }
  } while (status && !completedStatuses.includes(status.squidTransactionStatus));
};

// Function to create and broadcast Bitcoin transaction
const createAndBroadcastTransaction = async (
  keypair: ReturnType<typeof ECPair.fromWIF>,
  destinationAddress: string,
  amountSats: string
) => {
  try {
    // Get UTXOs for the source address
    const sourceAddress = bitcoin.payments.p2wpkh({ pubkey: keypair.publicKey, network: BITCOIN_NETWORK }).address!;
    const utxoResponse = await axios.get(`https://blockstream.info/api/address/${sourceAddress}/utxo`);
    const utxos = utxoResponse.data;

    // Create transaction
    const psbt = new bitcoin.Psbt({ network: BITCOIN_NETWORK });

    // Add inputs
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

    // Add output for the destination
    const amount = BigInt(amountSats);
    psbt.addOutput({
      address: destinationAddress,
      value: amount,
    });

    // Add change output if necessary (assuming 800 sats fee)
    const fee = BigInt(800);
    const changeAmount = totalInput - amount - fee;
    if (changeAmount > BigInt(546)) { // Dust threshold
      psbt.addOutput({
        address: sourceAddress,
        value: changeAmount,
      });
    }

    // Sign all inputs
    psbt.signAllInputs(keypair);
    psbt.finalizeAllInputs();

    // Get transaction hex and broadcast
    const tx = psbt.extractTransaction();
    const txHex = tx.toHex();

    const broadcastResponse = await axios.post('https://blockstream.info/api/tx', txHex);
    return tx.getId();
  } catch (error) {
    console.error('Error creating/broadcasting transaction:', error);
    throw error;
  }
};

// Execute the swap
(async () => {
  try {
    const sourceAddress = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: BITCOIN_NETWORK }).address!;

    // Set up parameters for swapping tokens
    const params = {
      fromAddress: sourceAddress,
      fromChain: fromChainId,
      fromToken: fromToken,
      fromAmount: "70000", // Amount in satoshis
      toChain: toChainId,
      toToken: toToken,
      toAddress: "0xC601C9100f8420417A94F6D63e5712C21029525e",
      quoteOnly: false
    };

    console.log("Parameters:", params);

    // Get the swap route using Squid API
    const routeResult = await getRoute(params);
    const route = routeResult.data.route;
    const requestId = routeResult.requestId;

    // Get deposit address using transaction request
    const depositAddressResult = await getDepositAddress(route.transactionRequest);
    console.log("Deposit address result:", depositAddressResult);

    // Create and broadcast Bitcoin transaction to deposit address
    const txHash = await createAndBroadcastTransaction(
      keyPair,
      depositAddressResult.depositAddress,
      depositAddressResult.amount
    );
    
    console.log("Transaction Hash:", txHash);
    console.log(`Bitcoin Explorer: https://mempool.space/tx/${txHash}`);

    // Monitor using chainflipStatusTrackingId with determined bridge type
    await updateTransactionStatus(
      depositAddressResult.chainflipStatusTrackingId, 
      requestId
    );

  } catch (error) {
    console.error("Error executing swap:", error);
    throw error;
  }
})();
