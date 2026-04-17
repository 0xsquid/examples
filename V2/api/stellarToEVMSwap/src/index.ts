// Stellar to EVM Swap Using Squid API (Coral V2 Intents)
import * as StellarSdk from "@stellar/stellar-sdk";
import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

// Load environment variables from .env file
const stellarSecretKey: string = process.env.STELLAR_SECRET_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;

if (!stellarSecretKey || !integratorId) {
  console.error("Missing environment variables. Ensure STELLAR_SECRET_KEY and INTEGRATOR_ID are set.");
  process.exit(1);
}

// Define parameters for the swap
const fromChainId = "stellar-mainnet";
const fromToken = "USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"; // USDC on Stellar
const fromAmount = "1000000"; // 0.1 USDC (7 decimals on Stellar)

const toChainId = "8453"; // Base
const toToken = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // USDC on Base

// Set up Stellar keypair and Horizon server
const keypair = StellarSdk.Keypair.fromSecret(stellarSecretKey);
const horizonServer = new StellarSdk.Horizon.Server("https://horizon.stellar.org");

// Function to get the optimal route for the swap using Squid API
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

// Function to get the status of the transaction using Squid API
const getStatus = async (params: any) => {
  try {
    const result = await axios.get("https://v2.api.squidrouter.com/v2/status", {
      params,
      headers: {
        "x-integrator-id": integratorId,
      },
    });
    return result.data;
  } catch (error: any) {
    if (error.response) {
      console.error("API Error when checking status:", error.response.data);
    }
    throw error;
  }
};

// Function to periodically check the transaction status until it completes
const updateTransactionStatus = async (txHash: string, requestId: string, quoteId?: string) => {
  const getStatusParams: any = {
    transactionId: txHash,
    requestId: requestId,
    fromChainId: fromChainId,
    toChainId: toChainId,
    quoteId: quoteId || requestId, // Required for Coral V2 transactions
  };

  console.log("Status API Params:", JSON.stringify(getStatusParams, null, 2));

  let status;
  const completedStatuses = ["success", "partial_success", "needs_gas", "not_found"];
  const maxRetries = 20;
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
        console.log("Transaction not found. Retrying in 5 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      } else {
        throw error;
      }
    }

    if (status && status.squidTransactionStatus && !completedStatuses.includes(status.squidTransactionStatus as string)) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  } while (!(status && status.squidTransactionStatus && completedStatuses.includes(status.squidTransactionStatus as string)));

  console.log("Swap fully confirmed on Squid API!");
};

// Main function
(async () => {
  console.log(`Stellar wallet address: ${keypair.publicKey()}`);

  const params = {
    fromAddress: keypair.publicKey(),
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: fromAmount,
    toChain: toChainId,
    toToken: toToken,
    // toAddress can be any EVM address – replace with your destination wallet
    toAddress: "0x0c9aB9754FAd739b167a338B99D37B21872BfeDb",
    quoteOnly: false
  };

  console.log("Parameters:", params);

  // Get the swap route using Squid API
  const routeResult = await getRoute(params);
  const route = routeResult.data.route;
  const requestId = routeResult.requestId;

  // Extract quoteId for Coral V2 transactions
  const quoteId = routeResult.data.route?.estimate?.actions?.[0]?.coralV2Order?.quoteId
               || routeResult.data.route?.estimate?.quoteId
               || routeResult.data.route?.quoteId
               || routeResult.data?.quoteId;

  console.log("Calculated route... target output:", route.estimate.toAmount);
  console.log("requestId:", requestId);
  console.log("Extracted quoteId:", quoteId);

  const transactionRequest = route.transactionRequest;

  // Execute the swap transaction natively on Stellar
  // route.transactionRequest.data contains the Stellar transaction payload
  // This may be an XDR-encoded transaction envelope or a JSON payment structure
  console.log(`Preparing Stellar transaction for deposit address ${transactionRequest.target}...`);

  let txHash: string;

  if (typeof transactionRequest.data === "string") {
    // Case 1: transactionRequest.data is an XDR-encoded transaction envelope
    // Deserialize, sign, and submit
    console.log("Received XDR transaction envelope from Squid API...");
    const transaction = StellarSdk.TransactionBuilder.fromXDR(
      transactionRequest.data,
      StellarSdk.Networks.PUBLIC
    );
    transaction.sign(keypair);

    console.log("Submitting signed transaction to Stellar network...");
    const result = await horizonServer.submitTransaction(transaction as StellarSdk.Transaction);
    txHash = result.hash;
  } else {
    // Case 2: transactionRequest.data is a JSON payment object (similar to XRPL pattern)
    // Build a native Stellar payment transaction from the provided details
    console.log("Building Stellar payment transaction from route data...");

    const sourceAccount = await horizonServer.loadAccount(keypair.publicKey());

    // Parse the asset from the transaction data
    // The deposit target and asset details come from the Squid route
    const txData = transactionRequest.data;
    let paymentAsset: StellarSdk.Asset;

    if (txData.asset && txData.asset.code && txData.asset.issuer) {
      // Non-native asset (e.g., USDC)
      paymentAsset = new StellarSdk.Asset(txData.asset.code, txData.asset.issuer);
    } else {
      // Native XLM
      paymentAsset = StellarSdk.Asset.native();
    }

    const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: (await horizonServer.fetchBaseFee()).toString(),
      networkPassphrase: StellarSdk.Networks.PUBLIC,
    });

    builder.addOperation(
      StellarSdk.Operation.payment({
        destination: transactionRequest.target,
        asset: paymentAsset,
        amount: txData.amount || fromAmount,
      })
    );

    // Add any memos from the transaction data (Squid may require memos for intent tracking)
    if (txData.memo) {
      if (txData.memoType === "hash" || txData.memoType === "MEMO_HASH") {
        builder.addMemo(StellarSdk.Memo.hash(txData.memo));
      } else if (txData.memoType === "id" || txData.memoType === "MEMO_ID") {
        builder.addMemo(StellarSdk.Memo.id(txData.memo));
      } else {
        // Default to text memo
        builder.addMemo(StellarSdk.Memo.text(txData.memo));
      }
    }

    builder.setTimeout(180); // 3 minute timeout

    const transaction = builder.build();
    transaction.sign(keypair);

    console.log("Submitting signed transaction to Stellar network...");
    const result = await horizonServer.submitTransaction(transaction);
    txHash = result.hash;
  }

  console.log("Transaction confirmed in Stellar ledger! Hash:", txHash);

  // Stellar block explorer links
  const stellarExpertLink = "https://stellar.expert/explorer/public/tx/" + txHash;
  console.log(`Check transaction on StellarExpert: ${stellarExpertLink}`);

  const coralscanLink = "https://scan.squidrouter.com/tx/" + txHash;
  console.log(`Check Coralscan for cross-chain details: ${coralscanLink}`);

  // Update transaction status until it completes
  // Note: Stellar native deposits do not require depositTxVerificationSignature
  await updateTransactionStatus(txHash, requestId as string, quoteId);
})();
