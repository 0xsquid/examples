import { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, Keypair } from "@solana/web3.js";
import axios from "axios";
import * as dotenv from "dotenv";
import bs58 from "bs58";
dotenv.config();

// Load environment variables
const privateKey: string = process.env.SOLANA_PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const SOLANA_RPC: string = process.env.SOLANA_RPC_ENDPOINT || "https://api.mainnet-beta.solana.com";

// Chain and token config
const fromChainId = "solana-mainnet-beta";
const toChainId = "42161";
const fromToken = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const toToken = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"; //USDC

// Solana setup
const connection = new Connection(SOLANA_RPC, "confirmed");
const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));

// Function to get route from Squid
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

// Function to get status
const getStatus = async (params: any) => {
  try {
    const result = await axios.get("https://api.uatsquidrouter.com/v2/status", {
      params: {
        transactionId: params.chainflipId, // Using chainflipId
        requestId: params.requestId,
        fromChainId: fromChainId,
        toChainId: toChainId,
        bridgeType: "chainflip" // Added bridge type
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
    requestId,
    fromChainId,
    toChainId
  };

  let status;
  const completedStatuses = ["success", "partial_success", "needs_gas", "not_found"];
  const maxRetries = 10;
  let retryCount = 0;

  do {
    try {
      status = await getStatus(getStatusParams);
      console.log(`Route status: ${status.squidTransactionStatus}`);
    } catch (error) {
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

// Execute the swap
(async () => {
  const params = {
    fromAddress: wallet.publicKey.toString(),
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: "110000000", // Amount in lamports
    toChain: toChainId,
    toToken: toToken,
    toAddress: "0xC601C9100f8420417A94F6D63e5712C21029525e",
    quoteOnly: false,
    enableBoost: true
  };

  console.log("Parameters:", params);

  const routeResult = await getRoute(params);
  const route = routeResult.data.route;
  const requestId = routeResult.requestId;
  const chainflipId = route.transactionRequest.chainflipId; // Get chainflipId from route
  console.log("Calculated route:", route);
  console.log("requestId:", requestId);
  console.log("chainflipId:", chainflipId);

  const transactionRequest = route.transactionRequest;

  // Create Solana transaction
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey(transactionRequest.target),
      lamports: parseInt(transactionRequest.value),
    })
  );

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet]
    );
    console.log("Transaction Hash:", signature);
    console.log(`Solscan: https://solscan.io/tx/${signature}`);

    // Monitor using chainflipId instead of transaction hash
    await updateTransactionStatus(chainflipId, requestId);

  } catch (error) {
    console.error("Error executing transaction:", error);
    throw error;
  }
})();