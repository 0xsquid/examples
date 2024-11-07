import { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, Keypair } from "@solana/web3.js";
import axios from "axios";
import * as dotenv from "dotenv";
import bs58 from "bs58";
dotenv.config();

// Load environment variables from .env file
const privateKey: string = process.env.SOLANA_PRIVATE_KEY!; // Base58 encoded private key
const integratorId: string = process.env.INTEGRATOR_ID!;
const SOLANA_RPC: string = process.env.SOLANA_RPC_ENDPOINT || "https://api.mainnet-beta.solana.com";

// Define chain and token addresses
const fromChainId = "solana-mainnet-beta";
const toChainId = "42161"; // Arbitrum
const fromToken = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"; // SOL
const toToken = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"; // USDC

// Set up Solana connection and wallet
const connection = new Connection(SOLANA_RPC, "confirmed");
const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));

// Function to get the optimal route for the swap using Squid API
const getRoute = async (params: any) => {
  try {
    const result = await axios.post(
      "https://api.uatsquidrouter.com/v2/route",
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

// Function to get the status of the transaction using Squid API
const getStatus = async (params: any) => {
  try {
    const result = await axios.get("https://api.uatsquidrouter.com/v2/status", {
      params: {
        transactionId: params.transactionId,
        requestId: params.requestId,
        fromChainId: params.fromChainId,
        toChainId: params.toChainId,
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

// Function to periodically check the transaction status until it completes
const updateTransactionStatus = async (txHash: string, requestId: string) => {
  const getStatusParams = {
    transactionId: txHash,
    requestId: requestId,
    fromChainId: fromChainId,
    toChainId: toChainId,
  };

  let status;
  const completedStatuses = ["success", "partial_success", "needs_gas", "not_found"];
  const maxRetries = 10;
  let retryCount = 0;

  do {
    try {
      status = await getStatus(getStatusParams);
      console.log(`Route status: ${status.squidTransactionStatus}`);
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        retryCount++;
        if (retryCount >= maxRetries) {
          console.error("Max retries reached. Transaction not found.");
          break;
        }
        console.log("Transaction not found. Retrying...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      } else {
        throw error;
      }
    }

    if (!completedStatuses.includes(status.squidTransactionStatus)) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  } while (!completedStatuses.includes(status.squidTransactionStatus));
};

// Execute the Solana transaction
const executeSwap = async () => {
  // Set up parameters for swapping tokens
  const params = {
    fromAddress: wallet.publicKey.toString(),
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: "25000000", // Amount in lamports (1 SOL = 1e9 lamports)
    toChain: toChainId,
    toToken: toToken,
    toAddress: "0xC601C9100f8420417A94F6D63e5712C21029525e",
    quoteOnly: false,
    enableBoost: true
  };

  console.log("Parameters:", params);

  // Get the swap route using Squid API
  const routeResult = await getRoute(params);
  const route = routeResult.data.route;
  const requestId = routeResult.requestId;
  console.log("Calculated route:", route);
  console.log("requestId:", requestId);

  const transactionRequest = route.transactionRequest;

  // Create Solana transaction
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey(transactionRequest.target),
      lamports: parseInt(transactionRequest.value), // Include the gas fee
    })
  );

  try {
    // Send and confirm transaction
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet]
    );
    console.log("Transaction Hash:", signature);

    // Show the transaction receipt with Solscan link
    const solscanLink = `https://solscan.io/tx/${signature}`;
    console.log(`Finished! Check Solscan for details: ${solscanLink}`);

    // Update transaction status until it completes
    await updateTransactionStatus(signature, requestId);
  } catch (error) {
    console.error("Error executing transaction:", error);
    throw error;
  }
};

// Execute the swap
executeSwap().catch(console.error);