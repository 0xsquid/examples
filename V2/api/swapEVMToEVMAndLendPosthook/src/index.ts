// Import necessary libraries
import { ethers } from "ethers";
import axios from "axios";

// Load environment variables from .env file
import * as dotenv from "dotenv";
dotenv.config();

// Load environment variables from .env file
const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const FROM_CHAIN_RPC: string = process.env.RPC_ENDPOINT!;
const radiantLendingPoolAddress: string = process.env.RADIANT_LENDING_POOL_ADDRESS!;
const usdcArbitrumAddress: string = process.env.USDC_ARBITRUM_ADDRESS!;

// Define chain and token addresses
const fromChainId = "56"; // Binance
const toChainId = "42161"; // Arbitrum
const fromToken = "0x55d398326f99059fF775485246999027B3197955"; // Define departing token


// Define amount to be swapped and deposited
const amount = "1000000000000000";

// Import Radiant lending pool ABI
import radiantLendingPoolAbi from "../abi/radiantLendingPoolAbi";

// Import erc20 contract ABI
import erc20Abi from "../abi/erc20Abi";

// Set up JSON RPC provider and signer 
const provider = new ethers.providers.JsonRpcProvider(FROM_CHAIN_RPC);
const signer = new ethers.Wallet(privateKey, provider);



// Creating Contract interfaces

// Approve the lending contract to spend the erc20
const erc20Interface = new ethers.utils.Interface(erc20Abi);
const approvalerc20 = erc20Interface.encodeFunctionData("approve", [
  radiantLendingPoolAddress,
  ethers.constants.MaxUint256,
]);

// Create contract interface and encode deposit function for Radiant lending pool
const radiantLendingPoolInterface = new ethers.utils.Interface(
  radiantLendingPoolAbi
);
const depositEncodedData = radiantLendingPoolInterface.encodeFunctionData(
  "deposit",
  [
    usdcArbitrumAddress,
    "0", // Placeholder for dynamic balance
    signer.address,
    0,
  ]
);




// Function to get the optimal route for the swap using Squid API
const getRoute = async (params: any) => {
  try {
    const result = await axios.post(
      "https://apiplus.squidrouter.com/v2/route",

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
    const result = await axios.get("https://apiplus.squidrouter.com/v2/status", {
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
  const maxRetries = 15; // Maximum number of retries for status check
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
        await new Promise((resolve) => setTimeout(resolve, 20000)); // Wait for 10 seconds before retrying
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
  // Set up parameters for swapping tokens and depositing into Radiant lending pool
  const params = {
    fromAddress: signer.address,
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: amount,
    toChain: toChainId,
    toToken: usdcArbitrumAddress,
    toAddress: signer.address,
    slippage: 1,
    postHook: {
      chainType: "evm",
      //fundAmount: amount,  //only required for prehooks
      //fundToken: usdcArbitrumAddress, //only required for prehooks
      calls: [
        {
          callType: 1,
          target: usdcArbitrumAddress,
          value: "0", // this will be replaced by the full native balance of the multicall after the swap
          callData: approvalerc20,
          payload: {
            tokenAddress: usdcArbitrumAddress, // unused in callType 2, dummy value
            inputPos: "1", // unused
          },
          estimatedGas: "50000",
          chainType: "evm",
        },
        {
          callType: 1, // SquidCallType.FULL_TOKEN_BALANCE
          target: radiantLendingPoolAddress,
          value: "0",
          callData: depositEncodedData,
          payload: {
            tokenAddress: usdcArbitrumAddress,
            inputPos: "1",
          },
          estimatedGas: "50000",
          chainType: "evm",
        },
      ],
      provider: "Integration Test",
      description: "Radiant Lend postHook",
      logoURI: "https://pbs.twimg.com/profile_images/1548647667135291394/W2WOtKUq_400x400.jpg",
    },
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
  await approveSpending(transactionRequest.target, fromToken, amount);

  // Execute the swap transaction
  const tx = await signer.sendTransaction({
    to: transactionRequest.target,
    data: transactionRequest.data,
    value: transactionRequest.value,
    gasLimit: (BigInt(transactionRequest.gasLimit) * BigInt(2)).toString(),
  });

  const txReceipt = await tx.wait();
  console.log("Transaction Hash: ", txReceipt.transactionHash);

  // Show the transaction receipt with Axelarscan link
  const axelarScanLink = "https://axelarscan.io/gmp/" + txReceipt.transactionHash;
  console.log(`Finished! Check Axelarscan for details: ${axelarScanLink}`);

  // Update transaction status until it completes
  await updateTransactionStatus(txReceipt.transactionHash, requestId);
})();
