// Canton to EVM Swap Using Squid SDK (Squid Intents)
//
// NOTE: Unlike EVM examples, this script cannot execute the full swap end-to-end.
// Canton wallets use the CIP-103 protocol, which relies on browser-based wallet
// extensions (Send, C8, Nightly) communicating via window.postMessage. There is
// no exportable private key or Node.js signing SDK for Canton — keys are managed
// entirely within the browser wallet.
//
// This script handles everything that can be done programmatically:
//   1. Initializes the Squid SDK and requests an optimal route
//   2. Displays the deposit address and order hash (memo)
//   3. Polls the status API until the swap completes
//
// The manual step is sending Canton Coin to the deposit address using your
// Canton wallet, with the order hash included as the transfer memo/reason.
//
// For fully automated browser-based execution, see the Squid Widget,
// which connects to Canton wallets via CIP-103.

import { Squid } from "@0xsquid/sdk";
import * as dotenv from "dotenv";
dotenv.config();

// Retrieve environment variables
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

// Initialize the Squid client with the base URL and integrator ID
const getSDK = (): Squid => {
  const squid = new Squid({
    baseUrl: "https://v2.api.squidrouter.com",
    integratorId: integratorId,
  });
  return squid;
};

// Main function
(async () => {
  // Initialize Squid SDK
  const squid = getSDK();
  await squid.init();
  console.log("Initialized Squid SDK");
  console.log(`Canton wallet address: ${cantonAddress}`);

  // Set up parameters for swapping tokens
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

  // Get the swap route using Squid SDK
  const { route, requestId } = await squid.getRoute(params);

  // Extract quoteId for Squid Intents transactions
  const quoteId =
    (route as any).estimate?.actions?.[0]?.coralV2Order?.quoteId ||
    (route as any).estimate?.quoteId ||
    (route as any).quoteId;

  console.log(
    "Calculated route. Target output amount:",
    route.estimate.toAmount
  );
  console.log("requestId:", requestId);
  console.log("Extracted quoteId:", quoteId);

  // Get the transaction request from route
  if (!route.transactionRequest) {
    console.error("No transaction request in route");
    process.exit(1);
  }

  const transactionRequest = route.transactionRequest as any;

  // Canton routes use DEPOSIT_ADDRESS_DIRECT_TRANSFER:
  // - transactionRequest.target = the deposit address
  // - transactionRequest.data = the order hash (used as transfer memo)
  //
  // Instead of passing it into squid.executeRoute (which expects EVM interfaces
  // by default), Canton transactions must be dispatched natively:
  //
  // In a browser environment with a CIP-103-compatible Canton wallet,
  // this is done via the Splice token-standard TransferFactory using
  // the wallet's prepareExecuteAndWait method.
  //
  // For programmatic/CLI use, send the funds using your Canton wallet
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

  // Track on Squid Scanner
  const coralscanLink = "https://scan.squidrouter.com";
  console.log(`Track on Squid Scanner: ${coralscanLink}`);

  // Parameters for checking the status of the transaction via Squid SDK
  const getStatusParams: any = {
    requestId: requestId,
    transactionId: requestId,
    integratorId: integratorId,
    fromChainId: fromChainId,
    toChainId: toChainId,
    quoteId: quoteId,
  };

  console.log(
    "Status API Params:",
    JSON.stringify(getStatusParams, null, 2)
  );

  const completedStatuses = [
    "success",
    "partial_success",
    "needs_gas",
    "not_found",
  ];
  const maxRetries = 60; // ~5 minutes to allow time for manual deposit
  let retryCount = 0;

  console.log("Waiting for deposit and tracking swap status...");

  let status: any;

  // Loop to check the transaction status
  do {
    try {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      status = await squid.getStatus(getStatusParams);
      console.log(`Route status: ${status.squidTransactionStatus}`);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error as any).response &&
        (error as any).response.status === 404
      ) {
        retryCount++;
        if (retryCount >= maxRetries) {
          console.error("Max retries reached. Transaction not found.");
          return;
        }
        console.log("Transaction not found. Retrying in 5 seconds...");
        continue;
      } else {
        throw error;
      }
    }
  } while (
    status &&
    status.squidTransactionStatus &&
    !completedStatuses.includes(status.squidTransactionStatus as string)
  );

  console.log("Swap completed! Final status:", status.squidTransactionStatus);
})();
