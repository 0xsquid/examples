import { Squid } from "@0xsquid/sdk";
import * as dotenv from "dotenv";
import * as xrpl from "xrpl"; // Import native XRPL SDK
import { Account } from "xrpl-secret-numbers"; // Import Xaman secret number converter
dotenv.config();

// Retrieve environment variables
const xrplSeed: string = process.env.XRPL_SEED!;
const integratorId: string = process.env.INTEGRATOR_ID!;

if (!xrplSeed || !integratorId) {
  console.error("Missing environment variables. Ensure XRPL_SEED and INTEGRATOR_ID are set.");
  process.exit(1);
}

// Define parameters for same-chain XRPL swap: XRP → RLUSD
const fromChainId = "xrpl-mainnet";
const fromToken = "xrp"; // Native XRP
const fromAmount = "300000"; // 0.3 XRP in drops

const toChainId = "xrpl-mainnet"; // Same chain
const toToken = "524C555344000000000000000000000000000000.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De"; // RLUSD

// Set up XRPL public client and wallet
const XRPL_RPC = "wss://s1.ripple.com/"; 

// Detect if the seed is a Xaman secret number (contains spaces) or a standard base58 seed
let wallet: xrpl.Wallet;
if (xrplSeed.includes(" ")) {
  // Convert Xaman secret numbers (8 groups of 6 digits) to a family seed
  const account = new Account(xrplSeed);
  const keypair = account.getKeypair();
  console.log("Derived XRPL address from secret numbers:", account.getAddress());
  // Build wallet from the keypair to ensure address consistency
  wallet = new xrpl.Wallet(keypair.publicKey, keypair.privateKey);
} else {
  wallet = xrpl.Wallet.fromSeed(xrplSeed);
}

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
  // Setup XRPL client
  const xrplClient = new xrpl.Client(XRPL_RPC);
  await xrplClient.connect();
  console.log(`Connected to XRPL: ${xrplClient.isConnected()}`);

  // Initialize Squid SDK
  const squid = getSDK();
  await squid.init();
  console.log("Initialized Squid SDK");

  // Set up parameters for same-chain swap: XRP → RLUSD on XRPL
  const params = {
    fromAddress: wallet.address,
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: fromAmount,
    toChain: toChainId,
    toToken: toToken,
    // For same-chain swaps, toAddress is the same XRPL wallet
    toAddress: wallet.address,
    quoteOnly: false
  };

  console.log("Parameters:", params);

  // Get the swap route using Squid SDK
  const { route, requestId } = await squid.getRoute(params);
  
  // Extract quoteId for Coral V2 transactions
  const quoteId = (route as any).estimate?.actions?.[0]?.coralV2Order?.quoteId 
               || (route as any).estimate?.quoteId 
               || (route as any).quoteId;
  
  console.log("Calculated route. Target output amount:", route.estimate.toAmount);

  // Get the transaction request from route
  if (!route.transactionRequest) {
    console.error("No transaction request in route");
    process.exit(1);
  }

  const transactionRequest = route.transactionRequest as any;

  // Execute the swap transaction natively on XRPL
  // route.transactionRequest.data contains the exact XRPL Payment/OfferCreate struct.
  // Instead of passing it into squid.executeRoute which expects EVM interfaces by default,
  // we dispatch it exactly as provided natively:
  console.log(`Preparing XRPL transaction for target ${transactionRequest.target}...`);
  const txJson = transactionRequest.data;
  
  txJson.Account = wallet.address;

  // Autofill missing fields (such as Fee, Sequence, etc.)
  const prepared = await xrplClient.autofill(txJson);
  
  // Sign the transaction
  const signed = wallet.sign(prepared);
  
  console.log("Submitting transaction payload to XRPL...");
  
  // Submit the transaction and wait for ledger validation
  const txResult = await xrplClient.submitAndWait(signed.tx_blob);
  
  const txHash = txResult.result.hash;
  console.log("Transaction Mined in XRPL ledger! Hash:", txHash);

  const squidScanLink = "https://scan.squidrouter.com/tx/" + txHash;
  console.log(`Check Coralscan for details: ${squidScanLink}`);

  // Parameters for checking the status of the transaction via Squid SDK
  const getStatusParams: any = {
    transactionId: txHash,
    requestId: requestId,
    integratorId: integratorId,
    fromChainId: fromChainId,
    toChainId: toChainId,
    quoteId: quoteId || requestId, // Required for Coral V2 transactions
  };

  const completedStatuses = ["success", "partial_success", "needs_gas", "not_found"];
  const maxRetries = 20; 
  let retryCount = 0;
  
  let status = await squid.getStatus(getStatusParams);
  console.log(`Initial route status: ${status.squidTransactionStatus}`);

  // Loop to check the transaction status
  do {
    try {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      status = await squid.getStatus(getStatusParams);
      console.log(`Route status: ${status.squidTransactionStatus}`);
    } catch (error: unknown) {
      if (error instanceof Error && (error as any).response && (error as any).response.status === 404) {
        retryCount++;
        if (retryCount >= maxRetries) {
          console.error("Max retries reached. Transaction not found.");
          break;
        }
        console.log("Transaction not found. Retrying in 5 seconds...");
        continue;
      } else {
        throw error;
      }
    }
  } while (status && status.squidTransactionStatus && !completedStatuses.includes(status.squidTransactionStatus as string));

  console.log("Swap transaction fully confirmed!");

  await xrplClient.disconnect();
})();
