import { ethers } from "ethers";
import { Squid } from "@0xsquid/sdk";
import { ChainType, EvmContractCall } from "@0xsquid/squid-types";
import * as dotenv from "dotenv";
dotenv.config();

// Load environment variables from the .env file
const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const FROM_CHAIN_RPC: string = process.env.RPC_ENDPOINT!;

// Define chain and token addresses
const fromChainId = "42161"; // Arbitrum
const toChainId = "56"; // Binance Smart Chain
const toToken = "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56"; // BUSD on Binance
const WETH_ADDRESS = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";

// Define amount to be wrapped and bridged
const amount = ethers.parseEther("0.0001"); // Amount in ETH

// Set up JSON RPC provider and signer
const provider = new ethers.JsonRpcProvider(FROM_CHAIN_RPC);
const signer = new ethers.Wallet(privateKey, provider);

// Import WETH ABI
import wethAbi from "../abi/wethAbi"; // Adjust the path if necessary

// Function to get Squid SDK instance
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

  // Creating Contract interfaces
  const wethInterface = new ethers.Interface(wethAbi);
  const wrapEncodedData = wethInterface.encodeFunctionData("deposit");

  // Set up parameters for wrapping ETH to wETH and bridging to BUSD on Binance Smart Chain
  const params = {
    fromAddress: await signer.getAddress(),
    fromChain: fromChainId,
    fromToken: WETH_ADDRESS, // WETH on Arbitrum
    fromAmount: amount.toString(),
    toChain: toChainId,
    toToken: toToken,
    toAddress: await signer.getAddress(),
    slippage: 1, //optional, Squid will dynamically calculate if removed
    preHook: {
      chainType: ChainType.EVM,
      fundAmount: amount.toString(),
      fundToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // Native ETH
      provider: "Integration Test", //This should be the name of your product or application that is triggering the hook
      description: "Wrap native ETH",
      logoURI: "http://", //This should be your product or application's logo
      calls: [
        {
          chainType: ChainType.EVM,
          callType: 2, // 2 corresponds to CALL_DATA
          target: WETH_ADDRESS,
          value: amount.toString(), // Amount of ETH to wrap
          callData: wrapEncodedData,
          payload: {
            tokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // Native ETH
            inputPos: 0,
          },
          estimatedGas: "500000",
        } as EvmContractCall,
      ],
    },
  };

  console.log("Parameters:", params);

  // Get the swap route using Squid SDK
  const { route, requestId } = await squid.getRoute(params);
  console.log("Calculated route:", route.estimate.toAmount);

  // Execute the wrap and bridge transaction
  const txResponse = await squid.executeRoute({
    signer: signer as any,
    route,
    bypassBalanceChecks: true // Add this to bypass balance checks since we're wrapping ETH for this example
  });
  
  // Handle the transaction response 
  let txHash: string = 'unknown';
  
  if (txResponse && typeof txResponse === 'object') {
    if ('hash' in txResponse) {
      txHash = txResponse.hash as string;
      const txReceipt = await (txResponse as any).wait?.(); // Wait for the transaction 
      console.log("Transaction Hash: ", txHash);
    } else if ('transactionHash' in txResponse) {
      // This might be a v5 style response or custom Squid format
      txHash = (txResponse as any).transactionHash as string;
      console.log("Transaction Hash: ", txHash);
    } else {
      // Fallback - try to find a hash property
      txHash = (txResponse as any).hash as string || 'unknown';
      console.log("Transaction Hash: ", txHash);
    }
  }

  // Show the transaction receipt with Axelarscan link
  const axelarScanLink = "https://axelarscan.io/gmp/" + txHash;
  console.log(`Finished! Check Axelarscan for details: ${axelarScanLink}`);

  // Wait a few seconds before checking the status
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Parameters for checking the status of the transaction
  const getStatusParams = {
    transactionId: txHash,
    requestId: requestId,
    integratorId: integratorId,
    fromChainId: fromChainId,
    toChainId: toChainId,
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

  // Wait for the transaction to be mined
  console.log("Transaction executed:", txHash);
})();
