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

// Add helper function to determine bridge type
const getBridgeType = (toChain: string): string => {
  return toChain === "42161" ? "chainflip" : "chainflipmultihop";
};

// Function to get route from Squid
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
      console.error("API error:", error.response.data);
    }
    console.error("Error with parameters:", params);
    throw error;
  }
};

// Function to get status
const getStatus = async (params: any) => {
  try {
    const result = await axios.get("https://v2.api.squidrouter.com/v2/status", {
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

// Add new function to get deposit address
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

// Execute the swap
(async () => {
  const params = {
    fromAddress: wallet.publicKey.toString(),
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: "150000000", // Amount in lamports
    toChain: toChainId,
    toToken: toToken,
    toAddress: "0xC601C9100f8420417A94F6D63e5712C21029525e",
    quoteOnly: false
  };

  console.log("Parameters:", params);

  const routeResult = await getRoute(params);
  const route = routeResult.data.route;
  const requestId = routeResult.requestId;
  
  // Get deposit address using transaction request
  const depositAddressResult = await getDepositAddress(route.transactionRequest);
  console.log("Deposit address result:", depositAddressResult);

  // Create Solana transaction with deposit address
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey(depositAddressResult.depositAddress),
      lamports: parseInt(depositAddressResult.amount),
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

    // Monitor using chainflipStatusTrackingId with determined bridge type
    await updateTransactionStatus(
      depositAddressResult.chainflipStatusTrackingId, 
      requestId
    );

  } catch (error) {
    console.error("Error executing transaction:", error);
    throw error;
  }
})();