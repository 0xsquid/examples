// Canton to EVM Swap Using Squid API (Squid Intents)
//
// NOTE: Unlike EVM examples, this script cannot execute the full swap end-to-end.
// Canton wallets use the CIP-103 protocol, which relies on browser-based wallet
// extensions (Send, C8, Nightly) communicating via window.postMessage. There is
// no exportable private key or Node.js signing SDK for Canton — keys are managed
// entirely within the browser wallet.
//
// This script handles everything that can be done programmatically:
//   1. Requests an optimal route from the Squid API
//   2. Displays the deposit address and order hash (memo)
//   3. Polls the status API until the swap completes
//
// The manual step is sending Canton Coin to the deposit address using your
// Canton wallet, with the order hash included as the transfer memo/reason.
//
// For fully automated browser-based execution, see the Squid Widget,
// which connects to Canton wallets via CIP-103.

import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

// Load environment variables from .env file
const cantonAddress: string = process.env.CANTON_ADDRESS!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const evmAddress: string = process.env.EVM_ADDRESS!;

if (!cantonAddress || !integratorId || !evmAddress) {
  console.error(
    "Missing environment variables. Ensure CANTON_ADDRESS, EVM_ADDRESS, and INTEGRATOR_ID are set."
  );
  process.exit(1);
}

// Define parameters for the swap
const fromChainId = "canton";
const fromToken =
  "DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc"; // Canton Coin (CC)
const fromAmount = "10000000000"; // 1 CC (Canton Coin uses 10 decimals)

const toChainId = "8453"; // Base
const toToken = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // USDC on Base

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
    const result = await axios.get(
      "https://v2.api.squidrouter.com/v2/status",
      {
        params,
        headers: {
          "x-integrator-id": integratorId,
        },
      }
    );
    return result.data;
  } catch (error: any) {
    if (error.response) {
      console.error("API Error when checking status:", error.response.data);
    }
    throw error;
  }
};

// Function to periodically check the transaction status until it completes
const updateTransactionStatus = async (
  requestId: string,
  quoteId: string
) => {
  const getStatusParams: any = {
    requestId: requestId,
    transactionId: requestId,
    fromChainId: fromChainId,
    toChainId: toChainId,
    quoteId: quoteId,
  };

  console.log(
    "Status API Params:",
    JSON.stringify(getStatusParams, null, 2)
  );

  let status;
  const completedStatuses = [
    "success",
    "partial_success",
    "needs_gas",
    "not_found",
  ];
  const maxRetries = 60; // ~5 minutes to allow time for manual deposit
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
          return;
        }
        console.log("Transaction not found. Retrying in 5 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      } else {
        throw error;
      }
    }

    if (
      status &&
      status.squidTransactionStatus &&
      !completedStatuses.includes(status.squidTransactionStatus as string)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  } while (
    !(
      status &&
      status.squidTransactionStatus &&
      completedStatuses.includes(status.squidTransactionStatus as string)
    )
  );

  console.log("Swap completed! Final status:", status.squidTransactionStatus);
};

// Main function
(async () => {
  console.log(`Canton wallet address: ${cantonAddress}`);

  const params = {
    fromAddress: cantonAddress,
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: fromAmount,
    toChain: toChainId,
    toToken: toToken,
    toAddress: evmAddress,
    quoteOnly: false,
  };

  console.log("Parameters:", params);

  // Get the swap route using Squid API
  const routeResult = await getRoute(params);
  const route = routeResult.data.route;
  const requestId = routeResult.requestId;

  // Extract quoteId for Squid Intents transactions
  const quoteId =
    routeResult.data.route?.estimate?.actions?.[0]?.coralV2Order?.quoteId ||
    routeResult.data.route?.estimate?.quoteId ||
    routeResult.data.route?.quoteId ||
    routeResult.data?.quoteId;

  console.log("Calculated route... target output:", route.estimate.toAmount);
  console.log("requestId:", requestId);
  console.log("Extracted quoteId:", quoteId);

  const transactionRequest = route.transactionRequest;

  // Canton routes use DEPOSIT_ADDRESS_DIRECT_TRANSFER:
  // - transactionRequest.target = the deposit address
  // - transactionRequest.data = the order hash (used as transfer memo)
  //
  // To complete the swap, send Canton Coin to the deposit address
  // and include the order hash as the transfer memo.
  //
  // In a browser environment with a CIP-103-compatible Canton wallet,
  // this is done via the Splice token-standard TransferFactory.
  // For programmatic use, send the funds using your Canton wallet
  // and include the order hash in the memo/reason field.

  const depositAddress = transactionRequest.target;
  const orderHash = transactionRequest.data;

  console.log("\n========================================");
  console.log("       CANTON DEPOSIT DETAILS");
  console.log("========================================");
  console.log(`  Deposit Address : ${depositAddress}`);
  console.log(`  Order Hash/Memo : ${orderHash}`);
  console.log(`  Amount          : ${fromAmount} (smallest unit)`);
  console.log("----------------------------------------");
  console.log("  Send the specified amount of Canton Coin");
  console.log("  to the deposit address above using your");
  console.log("  Canton wallet. Include the order hash");
  console.log("  as the transfer memo (reason field).");
  console.log("========================================\n");

  // Track transaction status
  console.log("Waiting for deposit and tracking swap status...");

  const coralscanLink = "https://scan.squidrouter.com";
  console.log(`Track on Squid Scanner: ${coralscanLink}`);

  await updateTransactionStatus(requestId as string, quoteId);
})();
