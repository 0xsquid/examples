import { Squid } from "@0xsquid/sdk"; // Import Squid SDK
import { ethers } from "ethers"; // Import ethers v6
import * as dotenv from "dotenv"; // Import dotenv for environment variables
dotenv.config(); // Load environment variables from .env file

// Retrieve environment variables
const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const FROM_CHAIN_RPC: string = process.env.FROM_CHAIN_RPC_ENDPOINT!;

if (!privateKey || !integratorId || !FROM_CHAIN_RPC) {
  console.error("Missing environment variables. Ensure PRIVATE_KEY, INTEGRATOR_ID, and FROM_CHAIN_RPC_ENDPOINT are set.");
  process.exit(1);
}

// Define chain and token addresses
const fromChainId = "8453"; // Base chain ID
const toChainId = "xrpl-mainnet"; // XRPL
const fromToken = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // USDC on Base
const toToken = "524C555344000000000000000000000000000000.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De"; // RLUSD on XRPL

// Define the amount to be sent (in smallest unit, e.g., 6 decimals for USDC)
const amount = "100000"; // .1 USDC 

// Set up JSON RPC provider and signer using the private key and RPC URL
// Create provider with the full URL
const provider = new ethers.JsonRpcProvider(FROM_CHAIN_RPC);
// Create wallet with the private key
const signer = new ethers.Wallet(privateKey, provider);

// Initialize the Squid client with the base URL and integrator ID
const getSDK = (): Squid => {
  const squid = new Squid({
    baseUrl: "https://v2.api.squidrouter.com",
    integratorId: integratorId,
  });
  return squid;
};

// Function to approve the transactionRequest.target to spend fromAmount of fromToken
const approveSpending = async (transactionRequestTarget: string, fromToken: string, fromAmount: string) => {
  const erc20Abi = [
    "function approve(address spender, uint256 amount) public returns (bool)"
  ];
  const tokenContract = new ethers.Contract(fromToken, erc20Abi, signer);
  try {
    const tx = await tokenContract.approve(transactionRequestTarget, fromAmount);
    await tx.wait();
    console.log(`Approved ${fromAmount} tokens for ${transactionRequestTarget}`);
  } catch (error) {
    console.error('Approval failed:', error);
    throw error;
  }
};

// Main function
(async () => {
  // Initialize Squid SDK
  const squid = getSDK();
  await squid.init();
  console.log("Initialized Squid SDK");

  // Set up parameters for swapping tokens
  const params = {
    fromAddress: await signer.getAddress(),
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: amount,
    toChain: toChainId,
    toToken: toToken,
    toAddress: "rHhyFkaCtJwKbu52DXdVnxQAkTgEvVmEXS", // Exact XRPL destination
    quoteOnly: false
  };

  console.log("Parameters:", params); // Printing the parameters for QA

  // Get the swap route using Squid SDK
  const { route, requestId } = await squid.getRoute(params);
  // Extract quoteId for Coral V2 transactions
  const quoteId = (route as any).estimate?.actions?.[0]?.coralV2Order?.quoteId
    || (route as any).estimate?.quoteId
    || (route as any).quoteId;
  console.log("Calculated route:", route.estimate.toAmount);

  // Get the transaction request from route
  if (!route.transactionRequest) {
    console.error("No transaction request in route");
    process.exit(1);
  }

  // For SquidData objects, we need to check what type it is and extract the target
  let target: string;
  if ('target' in route.transactionRequest) {
    target = route.transactionRequest.target;
  } else {
    console.error("Cannot determine target address from transaction request");
    console.log("Transaction request:", route.transactionRequest);
    process.exit(1);
  }

  // Approve the target to spend fromAmount of fromToken
  await approveSpending(target, fromToken, amount);

  // Execute the swap transaction
  const txResponse = await squid.executeRoute({
    signer: signer as any, // Cast to any to bypass type checking issues
    route,
  });

  // Handle the transaction response - could be an ethers v6 TransactionResponse or something else
  let txHash: string = 'unknown';

  if (txResponse && typeof txResponse === 'object') {
    if ('hash' in txResponse) {
      // This is an ethers TransactionResponse
      txHash = txResponse.hash as string;
      await (txResponse as any).wait?.(); // Wait for the transaction to be mined if possible
    } else if ('transactionHash' in txResponse) {
      // This might be a v5 style response or custom Squid format
      txHash = (txResponse as any).transactionHash as string;
    } else {
      // Fallback - try to find a hash property
      txHash = (txResponse as any).hash as string || 'unknown';
    }
  }

  // Use Coralscan for cross-chain intent tracing
  const axelarScanLink = "https://scan.squidrouter.com/tx/" + txHash;
  console.log(`Finished! Check Coralscan for details: ${axelarScanLink}`);

  // Wait a few seconds before checking the status
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Parameters for checking the status of the transaction
  const getStatusParams = {
    transactionId: txHash,
    requestId: requestId,
    integratorId: integratorId,
    fromChainId: fromChainId,
    toChainId: toChainId,
    quoteId: quoteId || requestId, // Required for Coral V2 transactions
  };

  const completedStatuses = ["success", "partial_success", "needs_gas", "not_found"];
  const maxRetries = 10; // Maximum number of retries for status check
  let retryCount = 0;

  // Get the initial status
  let status = await squid.getStatus(getStatusParams);
  console.log(`Initial route status: ${status.squidTransactionStatus}`);

  // Loop to check the transaction status until it is completed or max retries are reached
  do {
    try {
      // Wait a few seconds before checking the status
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Retrieve the transaction's route status
      status = await squid.getStatus(getStatusParams);

      // Display the route status
      console.log(`Route status: ${status.squidTransactionStatus}`);

    } catch (error: unknown) {
      // Handle error if the transaction status is not found
      if (error instanceof Error && (error as any).response && (error as any).response.status === 404) {
        retryCount++;
        if (retryCount >= maxRetries) {
          console.error("Max retries reached. Transaction not found.");
          break;
        }
        console.log("Transaction not found. Retrying...");
        continue;
      } else {
        throw error;
      }
    }

  } while (status && !completedStatuses.includes(status.squidTransactionStatus));

  // Wait for the transaction to be executed
  console.log("Swap transaction executed:", txHash);
})();