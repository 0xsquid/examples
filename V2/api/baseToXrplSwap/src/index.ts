//EVM to EVM Swap Using Squid API
import { ethers } from "ethers";
import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

// Load environment variables from .env file
const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const FROM_CHAIN_RPC: string = process.env.FROM_CHAIN_RPC_ENDPOINT!;

// Define chain and token addresses
const fromChainId = "8453"; // Base
const toChainId = "xrpl-mainnet"; // XRPL
const fromToken = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // USDC
const toToken = "524C555344000000000000000000000000000000.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De"; // RLUSD

// Define the amount to be sent
const amount = ".100000"; // 1 USDC

// Set up JSON RPC provider and signer 
const provider = new ethers.JsonRpcProvider(FROM_CHAIN_RPC);
const signer = new ethers.Wallet(privateKey, provider);

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
    const requestId = result.headers["x-request-id"]; // Retrieve request ID from response headers
    return { data: result.data, requestId: requestId };
  } catch (error) {
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
      params: {
        transactionId: params.transactionId,
        requestId: params.requestId,
        fromChainId: params.fromChainId,
        toChainId: params.toChainId,
        quoteId: params.quoteId || params.requestId, // Required for Coral V2 transactions
      },
      headers: {
        "x-integrator-id": integratorId,
      },
    });
    return result.data;
  } catch (error) {
    if (error.response) {
      console.error("API error:", error.response.data);
    }
    console.error("Error with parameters:", params);
    throw error;
  }
};

// Function to determine if the route contains an RFQ action

const hasRfqAction = (route: any) => {

  return route.estimate.actions.some((action: any) => action.type === "rfq");

};

// Function to get the appropriate explorer URL based on route type
const getExplorerUrl = (txHash: string, route: any) => {
  return "https://scan.squidrouter.com/tx/" + txHash; // Standardized to Coralscan
};

// Function to periodically check the transaction status until it completes
const updateTransactionStatus = async (txHash: string, requestId: string, quoteId?: string) => {
  const getStatusParams = {
    transactionId: txHash,
    requestId: requestId,
    fromChainId: fromChainId,
    toChainId: toChainId,
    quoteId: quoteId || requestId, // Required for Coral V2 transactions
  };

  let status;
  const completedStatuses = ["success", "partial_success", "needs_gas", "not_found"];
  const maxRetries = 10; // Maximum number of retries for status check
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
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait for 5 seconds before retrying
        continue;
      } else {
        throw error; // Rethrow other errors
      }
    }

    if (!completedStatuses.includes(status.squidTransactionStatus)) {
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait for 5 seconds before checking the status again
    }
  } while (!completedStatuses.includes(status.squidTransactionStatus));
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

// Set up parameters for swapping tokens
(async () => {
  const params = {
    fromAddress: signer.address,
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: amount,
    toChain: toChainId,
    toToken: toToken,
    toAddress: "rHhyFkaCtJwKbu52DXdVnxQAkTgEvVmEXS", // Exact XRPL destination
    quoteOnly: false
  };

  console.log("Parameters:", params);

  // Get the swap route using Squid API
  const routeResult = await getRoute(params);
  const route = routeResult.data.route;
  const quoteId = routeResult.data?.route?.estimate?.actions?.[0]?.coralV2Order?.quoteId || routeResult.data?.route?.estimate?.quoteId || routeResult.data?.route?.quoteId || routeResult.data?.quoteId;
  const requestId = routeResult.requestId;
  console.log("Calculated route:", route);
  console.log("requestId:", requestId);

  const transactionRequest = route.transactionRequest;

  // Approve the transactionRequest.target to spend fromAmount of fromToken
  await approveSpending(transactionRequest.target, fromToken, amount);

  // Execute the swap transaction
  const tx = await signer.sendTransaction({
    to: transactionRequest.target,
    data: transactionRequest.data,
    value: transactionRequest.value,
    gasPrice: transactionRequest.gasPrice,
    gasLimit: transactionRequest.gasLimit,
  });
  console.log("Transaction Hash:", tx.hash);
  const txReceipt = await tx.wait();


  // Get the appropriate explorer URL based on route type
  const explorerUrl = getExplorerUrl(txReceipt.hash, route);
  console.log(`Finished! Check transaction details: ${explorerUrl}`);

  // Update transaction status until it completes
  await updateTransactionStatus(txReceipt.hash, requestId, quoteId);
})();
