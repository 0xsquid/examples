import { ethers } from "ethers";
import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

// Load environment variables from .env file
const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const FROM_CHAIN_RPC: string = process.env.FROM_CHAIN_RPC_ENDPOINT!;

// Define chain and token addresses
const fromChainId = "56"; // BNB
const toChainId = "42161"; // Arbitrum
const fromToken = "0x55d398326f99059fF775485246999027B3197955"; // USDT
const toToken = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"; // USDC

// Set up JSON RPC provider and signer 
const provider = new ethers.providers.JsonRpcProvider(FROM_CHAIN_RPC);
const signer = new ethers.Wallet(privateKey, provider);

// Function to get token information from Squid API
const getTokens = async () => {
  try {
    const result = await axios.get('https://v2.api.squidrouter.com/v2/sdk-info', {
      headers: {
        'x-integrator-id': integratorId,
      },
    });
    return result.data.tokens;
  } catch (error) {
    console.error("Error fetching token data:", error);
    return [];
  }
};

// Function to find a specific token in the token list
function findToken(tokens: any[], address: string, chainId: string) {
  if (!Array.isArray(tokens)) {
    console.error("Invalid tokens data structure");
    return null;
  }

  return tokens.find(t => 
    t.address.toLowerCase() === address.toLowerCase() && 
    t.chainId === chainId
  );
}

// Function to calculate the amount of fromToken needed based on user-specified toAmount
function calculateFromAmountBasedOnToAmount(toAmount: string, fromToken: any, toToken: any): string {
  const fromTokenDecimals = fromToken.decimals;
  const toTokenDecimals = toToken.decimals;
  const fromTokenUsdPrice = fromToken.usdPrice;
  const toTokenUsdPrice = toToken.usdPrice;

  // Convert toAmount to a number, considering its decimals
  const toAmountNumber = Number(toAmount) / (10 ** toTokenDecimals);

  // Calculate the USD value of the toAmount
  const usdValue = toAmountNumber * toTokenUsdPrice;

  // Calculate the amount of fromToken needed to match this USD value
  const fromAmountNumber = usdValue / fromTokenUsdPrice;

  // Add a 1% buffer for price fluctuations and fees
  const fromAmountWithBuffer = fromAmountNumber * 1.01;

  // Convert back to the fromToken's decimal representation and round up
  const fromAmount = Math.ceil(fromAmountWithBuffer * (10 ** fromTokenDecimals)).toString();

  return fromAmount;
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

// Main execution function
(async () => {
  try {
    // Fetch token information
    const tokens = await getTokens();

    if (!Array.isArray(tokens)) {
      throw new Error("Unexpected token data structure");
    }

    const fromTokenInfo = findToken(tokens, fromToken, fromChainId);
    const toTokenInfo = findToken(tokens, toToken, toChainId);

    if (!fromTokenInfo || !toTokenInfo) {
      throw new Error("Unable to find token information");
    }

    // User-specified toAmount (this should be set based on user input or configuration)
    const userSpecifiedToAmount = "1000000"; // Example: 1 USDC (6 decimals)

    // Calculate the amount of fromToken needed
    const calculatedFromAmount = calculateFromAmountBasedOnToAmount(userSpecifiedToAmount, fromTokenInfo, toTokenInfo);

    console.log("User specified toAmount:", userSpecifiedToAmount);
    console.log("Calculated fromAmount:", calculatedFromAmount);

    const params = {
      fromAddress: signer.address,
      fromChain: fromChainId,
      fromToken: fromToken,
      fromAmount: calculatedFromAmount,
      toChain: toChainId,
      toToken: toToken,
      toAddress: signer.address,
      enableForecall: true,
      quoteOnly: false
    };

    console.log("Parameters:", params);

    // Get the swap route using Squid API
    const routeResult = await getRoute(params);
    const route = routeResult.data.route;
    const requestId = routeResult.requestId;
    console.log("Calculated route:", route);
    console.log("requestId:", requestId);

    const transactionRequest = route.transactionRequest;

    // Approve the transactionRequest.target to spend fromAmount of fromToken
    await approveSpending(transactionRequest.target, fromToken, calculatedFromAmount);

    // Execute the swap transaction
    const tx = await signer.sendTransaction({
      to: transactionRequest.target,
      data: transactionRequest.data,
      value: transactionRequest.value,
      gasPrice: await provider.getGasPrice(),
      gasLimit: transactionRequest.gasLimit,
    });
    console.log("Transaction Hash:", tx.hash);
    const txReceipt = await tx.wait();

    // Show the transaction receipt with Axelarscan link
    const axelarScanLink = "https://axelarscan.io/gmp/" + txReceipt.transactionHash;
    console.log(`Finished! Check Axelarscan for details: ${axelarScanLink}`);

    // Update transaction status until it completes
    await updateTransactionStatus(txReceipt.transactionHash, requestId);
  } catch (error) {
    console.error("An error occurred:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
  }
})();