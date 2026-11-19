import axios from "axios";
import * as dotenv from "dotenv";
import * as xrpl from "xrpl"; // Import xrpl library for native XRPL logic
import { Account } from "xrpl-secret-numbers"; // Import Xaman secret number converter
import { pollRouteStatus } from "./pollRouteStatus";

dotenv.config();

// Load environment variables from .env file
const xrplSeed: string = process.env.XRPL_SEED!;
const integratorId: string = process.env.INTEGRATOR_ID!;

if (!xrplSeed || !integratorId) {
  console.error("Missing environment variables. Ensure XRPL_SEED and INTEGRATOR_ID are set.");
  process.exit(1);
}

// Define parameters from the provided payload
const fromChainId = "xrpl-mainnet";
const fromToken = "xrp"; // Native XRP
const fromAmount = "10000";

const toChainId = "42161"; // Arbitrum
const toToken = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // USDC on Arbitrum

const quoteOnly = false;

// Set up XRPL public client and wallet
const XRPL_RPC = "wss://s1.ripple.com/"; // XRPL Mainnet Websocket RPC

// Detect if the seed is a Xaman secret number (contains spaces) or a standard base58 seed
let wallet: xrpl.Wallet;
if (xrplSeed.includes(" ")) {
  // Convert Xaman secret numbers (8 groups of 6 digits) to a family seed
  const account = new Account(xrplSeed);
  const familySeed = account.getFamilySeed();
  const keypair = account.getKeypair();
  console.log("Derived XRPL address from secret numbers:", account.getAddress());
  // Build wallet from the keypair to ensure address consistency
  wallet = new xrpl.Wallet(keypair.publicKey, keypair.privateKey);
} else {
  wallet = xrpl.Wallet.fromSeed(xrplSeed);
}

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
const getStatus = async (params: {
  transactionId: string;
  requestId?: string;
  fromChainId: string;
  toChainId: string;
  quoteId?: string;
}, signal: AbortSignal) => {
  const result = await axios.get<{ squidTransactionStatus?: string }>(
    "https://v2.api.squidrouter.com/v2/status",
    { params, headers: { "x-integrator-id": integratorId }, signal }
  );
  console.log(`Route status: ${result.data.squidTransactionStatus ?? "unknown"}`);
  return result.data.squidTransactionStatus;
};

// Main function
(async () => {
  const params = {
    fromAddress: wallet.address,
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: fromAmount,
    toChain: toChainId,
    toToken: toToken,
    toAddress: "0x0c9aB9754FAd739b167a338B99D37B21872BfeDb",
    quoteOnly: quoteOnly
  };

  console.log("Parameters:", params);

  // Get the swap route using Squid API
  const routeResult = await getRoute(params);
  const route = routeResult.data.route;
  const requestId = routeResult.requestId;
  
  // Extract quoteId for Coral V2 transactions
  const quoteId = routeResult.data.route?.estimate?.quoteId || routeResult.data.route?.quoteId || routeResult.data?.quoteId;
  
  console.log("Calculated route... target output:", route.estimate.toAmount);
  console.log("requestId:", requestId);

  if (quoteOnly) {
    // Quote-only mode: display the quote details and exit
    console.log("\n=== Quote Details ===");
    console.log("From:", fromAmount, fromToken, "on", fromChainId);
    console.log("To:", route.estimate.toAmount, toToken, "on", toChainId);
    console.log("Estimated USD value:", route.estimate.toAmountUSD || "N/A");
    console.log("quoteId:", quoteId);
    console.log("Quote-only mode — no transaction executed.");
  } else {
    // Full execution mode: connect to XRPL and submit the transaction
    const xrplClient = new xrpl.Client(XRPL_RPC);
    await xrplClient.connect();
    console.log(`Connected to XRPL: ${xrplClient.isConnected()}`);

    const transactionRequest = route.transactionRequest;

    // Execute the swap transaction natively on XRPL
    // route.transactionRequest.data contains the exact XRPL Payment struct, with Memos already prepared
    console.log(`Preparing XRPL transaction for ${transactionRequest.target}...`);
    const txJson = transactionRequest.data;
    
    // Update the sender explicitly just in case it's not dynamically matched to the wallet yet
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

    // We can track the transaction natively on XRPL via livenet block explorers
    const squidScanLink = "https://scan.squidrouter.com/tx/" + txHash;
    console.log(`Check Coralscan for details: ${squidScanLink}`);

    // Track the route using the source transaction hash and Coral V2 quote ID.
    // The deadline also cancels a slow status request.
    try {
      const outcome = await pollRouteStatus((signal) => getStatus({
        transactionId: txHash,
        requestId,
        fromChainId,
        toChainId,
        quoteId: quoteId || requestId,
      }, signal), AbortSignal.timeout(120_000));
      console.log(outcome.message);
    } finally {
      await xrplClient.disconnect();
    }
  }
})();
