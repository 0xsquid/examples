// Import necessary libraries
import { ethers } from "ethers";
import { Squid } from "@0xsquid/sdk";
import { ChainType, EvmContractCall } from "@0xsquid/squid-types"; 

// Load environment variables from the .env file
import * as dotenv from "dotenv";
dotenv.config();

// Load environment variables from .env file
const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const FROM_CHAIN_RPC: string = process.env.RPC_ENDPOINT!;
const aaveArbitrumPoolAddress: string = "0x794a61358D6845594F94dc1DB02A252b5b4814aD"; // Aave v3 pool on Arbitrum
const usdcArbitrumAddress: string = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

// Define chain and token addresses
const fromChainId = "56"; // Binance
const toChainId = "42161"; // Arbitrum
const fromToken = "0x55d398326f99059fF775485246999027B3197955"; // Define departing token

// Define amount to be sent
const amount = "100000000000000000";

// Set up JSON RPC provider and signer using the private key and RPC URL
const provider = new ethers.JsonRpcProvider(FROM_CHAIN_RPC);
const signer = new ethers.Wallet(privateKey, provider);

// Import erc20 contract ABI
import erc20Abi from "../abi/erc20Abi";

// Define Aave pool ABI (simplified for this example)
const aavePoolAbi = [
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external"
];

// Function to get Squid SDK instance
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

  // Creating Contract interfaces
  // Approve the Aave pool contract to spend the USDC
  const erc20Interface = new ethers.Interface(erc20Abi);
  const approvalData = erc20Interface.encodeFunctionData("approve", [
    aaveArbitrumPoolAddress,
    ethers.MaxUint256, // ethers v6 uses MaxUint256 directly on ethers
  ]);

  // Create contract interface and encode supply function for Aave lending pool
  const aavePoolInterface = new ethers.Interface(aavePoolAbi);
  
  const userAddress = await signer.getAddress();
  
  const supplyData = aavePoolInterface.encodeFunctionData(
    "supply",
    [
      usdcArbitrumAddress,
      "0", // Amount will be replaced with the full token balance
      userAddress,
      0, // referralCode
    ]
  );

  
  
  // Set up parameters for swapping tokens and depositing into Aave lending pool
  const params = {
    fromAddress: userAddress,
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: amount,
    toChain: toChainId,
    toToken: usdcArbitrumAddress,
    toAddress: userAddress,
    quoteOnly: false,
    postHook: {
      chainType: ChainType.EVM,
      calls: [
        {
          chainType: ChainType.EVM, 
          callType: 1, // SquidCallType.FULL_TOKEN_BALANCE
          target: usdcArbitrumAddress,
          value: "0", // this will be replaced by the full native balance of the multicall after the swap
          callData: approvalData,
          payload: {
            tokenAddress: usdcArbitrumAddress,
            inputPos: 1,
          },
          estimatedGas: "50000",
        } as EvmContractCall,
        {
          chainType: ChainType.EVM,
          callType: 1, // SquidCallType.FULL_TOKEN_BALANCE
          target: aaveArbitrumPoolAddress,
          value: "0",
          callData: supplyData,
          payload: {
            tokenAddress: usdcArbitrumAddress,
            inputPos: 1,
          },
          estimatedGas: "200000",
        } as EvmContractCall,
      ],
      provider: "Aave",
      description: "Deposit to Aave on Arbitrum",
      logoURI: "https://app.aave.com/favicon.ico",
    },
  };
  

  console.log("Parameters:", params); // Printing the parameters for QA

  // Get the swap route using Squid SDK
  const { route, requestId } = await squid.getRoute(params);
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

  // Wait for the transaction to be executed
  console.log("Swap transaction executed:", txHash);
})();
