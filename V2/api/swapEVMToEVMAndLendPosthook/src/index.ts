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
const aaveArbitrumPoolAddress: string = "0x794a61358D6845594F94dc1DB02A252b5b4814aD"; // Aave v3 pool on Arbitrum
const usdcArbitrumAddress: string = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"; // USDC on Arbitrum

// Define chain and token addresses
const fromChainId = "56"; // Binance
const toChainId = "42161"; // Arbitrum
const fromToken = "0x55d398326f99059fF775485246999027B3197955"; // Define departing token

// Define amount to be swapped and deposited
const amount = "1000000000000000000";

// Import erc20 contract ABI
import erc20Abi from "../abi/erc20Abi";

// Define Aave pool ABI
const aavePoolAbi = [
  "function withdraw(address asset, uint256 amount, address to) external returns (uint256)",
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external"
];

// Set up JSON RPC provider and signer 
const provider = new ethers.providers.JsonRpcProvider(FROM_CHAIN_RPC);
const signer = new ethers.Wallet(privateKey, provider);

// Creating Contract interfaces
const aaveArbitrumPoolContract = new ethers.Contract(aaveArbitrumPoolAddress, aavePoolAbi, signer);
const toTokenContract = new ethers.Contract(usdcArbitrumAddress, erc20Abi, signer);

// Approve the Aave pool contract to spend the USDC
const erc20Interface = new ethers.utils.Interface(erc20Abi);
const approvalData = erc20Interface.encodeFunctionData("approve", [
  aaveArbitrumPoolAddress,
  ethers.constants.MaxUint256,
]);

// Create contract interface and encode supply function for Aave lending pool
const aavePoolInterface = new ethers.utils.Interface(aavePoolAbi);
const supplyData = aavePoolInterface.encodeFunctionData("supply", [
  usdcArbitrumAddress,
  "0", // Amount will be replaced with the full token balance
  signer.address,
  0 // referralCode
]);

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
  const maxRetries = 20; // Increased maximum number of retries for status check
  let retryCount = 0;
  let consecutiveFailures = 0;

  console.log(`Starting status monitoring for transaction: ${txHash}`);
  console.log(`Request ID: ${requestId}`);

  do {
    try {
      console.log(`Checking status... (attempt ${retryCount + 1}/${maxRetries})`);
      status = await getStatus(getStatusParams);
      
      console.log(`✅ Status check successful: ${status.squidTransactionStatus}`);
      consecutiveFailures = 0; // Reset failure counter on success
      
      // If not completed, wait before next check
      if (!completedStatuses.includes(status.squidTransactionStatus)) {
        console.log("Transaction still processing. Waiting 5 seconds before next check...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        retryCount++;
        consecutiveFailures++;
        
        console.log(`❌ Transaction not found in indexer (404 error)`);
        console.log(`   Retry attempt: ${retryCount}/${maxRetries}`);
        console.log(`   Consecutive failures: ${consecutiveFailures}`);
        
        if (error.response.data && error.response.data.message) {
          console.log(`   API message: ${error.response.data.message}`);
        }
        
        if (retryCount >= maxRetries) {
          console.error("❌ Max retries reached. Transaction may still be processing.");
          console.error("💡 This doesn't mean the transaction failed - it may just take longer to index.");
          console.error(`🔗 Check manually: https://axelarscan.io/gmp/${txHash}`);
          break;
        }
        
        // Implement exponential backoff for 404 errors
        let waitTime;
        if (consecutiveFailures <= 3) {
          waitTime = 10000; // 10 seconds for first few failures
        } else if (consecutiveFailures <= 6) {
          waitTime = 20000; // 20 seconds for subsequent failures
        } else {
          waitTime = 30000; // 30 seconds for persistent failures
        }
        
        console.log(`⏳ Waiting ${waitTime/1000} seconds before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
        
      } else {
        // Handle non-404 errors
        console.error("❌ Unexpected error checking status:", error.message);
        
        if (error.response) {
          console.error(`   HTTP Status: ${error.response.status}`);
          console.error(`   Status Text: ${error.response.statusText}`);
          if (error.response.data) {
            console.error(`   Response:`, error.response.data);
          }
        }
        
        retryCount++;
        consecutiveFailures++;
        
        if (retryCount >= maxRetries) {
          console.error("❌ Max retries reached due to persistent errors.");
          throw error;
        }
        
        console.log(`⏳ Waiting 15 seconds before retry due to error...`);
        await new Promise((resolve) => setTimeout(resolve, 15000));
        continue;
      }
    }
    
  } while (status && !completedStatuses.includes(status.squidTransactionStatus));

  if (status && completedStatuses.includes(status.squidTransactionStatus)) {
    console.log(`🎉 Transaction completed with status: ${status.squidTransactionStatus}`);
    
    // Provide additional context based on final status
    switch (status.squidTransactionStatus) {
      case "success":
        console.log("✅ Transaction completed successfully!");
        break;
      case "partial_success":
        console.log("⚠️  Transaction partially completed. Some operations may have failed.");
        break;
      case "needs_gas":
        console.log("⛽ Transaction needs additional gas to complete.");
        break;
      case "not_found":
        console.log("❓ Transaction not found in final check.");
        break;
    }
  } else {
    console.log("⏹️  Status monitoring ended without completion confirmation.");
    console.log(`🔗 Monitor progress: https://axelarscan.io/gmp/${txHash}`);
  }
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
  // Set up parameters for swapping tokens and depositing into Aave lending pool
  const params = {
    fromAddress: signer.address,
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: amount,
    toChain: toChainId,
    toToken: usdcArbitrumAddress,
    toAddress: signer.address,
    slippage: 1, //optional, Squid will dynamically calculate if removed
    postHook: {
      chainType: "evm",
      calls: [
        {
          callType: 1,
          target: usdcArbitrumAddress,
          value: "0",
          callData: approvalData,
          payload: {
            tokenAddress: usdcArbitrumAddress,
            inputPos: "1",
          },
          estimatedGas: "50000",
          chainType: "evm",
        },
        {
          callType: 1, // SquidCallType.FULL_TOKEN_BALANCE
          target: aaveArbitrumPoolAddress,
          value: "0",
          callData: supplyData,
          payload: {
            tokenAddress: usdcArbitrumAddress,
            inputPos: "1",
          },
          estimatedGas: "200000",
          chainType: "evm",
        },
      ],
      provider: "Aave",
      description: "Deposit to Aave on Arbitrum",
      logoURI: "https://app.aave.com/favicon.ico",
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
