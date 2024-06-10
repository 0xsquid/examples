import { ethers } from "ethers";
import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

// Load environment variables from .env file
const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const FROM_CHAIN_RPC: string = process.env.RPC_ENDPOINT!;


// Define chain and token addresses
const fromChainId = "42161"; // Arbitrum
const toChainId = "56"; // Binance Smart Chain
const toToken = "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56"; // BUSD on Binance
const WETH_ADDRESS = "WETH_ADDRESS ='0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";

// Define amount to be wrapped and bridged
const amount = ethers.utils.parseEther("0.0001"); // Amount in ETH

// Set up JSON RPC provider and signer
const provider = new ethers.providers.JsonRpcProvider(FROM_CHAIN_RPC);
const signer = new ethers.Wallet(privateKey, provider);

// Import WETH ABI
import wethAbi from "../abi/wethAbi"; // Adjust the path if necessary

// Creating Contract interfaces
const wethContract = new ethers.Contract(WETH_ADDRESS, wethAbi, signer);

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
        await new Promise((resolve) => setTimeout(resolve, 20000)); // Wait for 20 seconds before retrying
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

// Set up parameters for wrapping ETH to wETH and bridging to BUSD on Binance Smart Chain
(async () => {
  const params = {
    fromAddress: signer.address,
    fromChain: fromChainId,
    fromToken: WETH_ADDRESS, // WETH on Arbitrum
    fromAmount: amount.toString(),
    toChain: toChainId,
    toToken: toToken,
    toAddress: signer.address,
    slippage: 1,  //optional, Squid will dynamically calculate if removed
    preHook: {
      chainType: "evm",
      fundAmount: amount.toString(),
      fundToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // Native ETH
      provider: "Integration Test", //This should be the name of your product or application that is triggering the hook
      description: "Wrap native ETH",
      logoURI: "https://pbs.twimg.com/profile_images/1548647667135291394/W2WOtKUq_400x400.jpg", //Add your logo here
      calls: [
        {
          chainType: "evm",
          callType: 2,
          target: WETH_ADDRESS,
          value: "0",
          callData: wethContract.interface.encodeFunctionData("deposit"), // Function signature for deposit() in WETH contract
          payload: {
            tokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // Native ETH
            inputPos: 0,
          },
          estimatedGas: "500000",
        },
      ],
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

  // Execute the wrap and bridge transaction
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
