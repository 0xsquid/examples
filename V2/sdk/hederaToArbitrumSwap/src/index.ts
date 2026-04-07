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

// Define chain and token addresses based on provided payload
const fromChainId = "295"; // Hedera
const fromToken = "0x000000000000000000000000000000000006f89a"; // USDC on Hedera
const fromAddress = "0x5937b0EAF840fAbe4619DB8E7e846Dc74C5Ca3d7";
const fromAmount = "2000";

const toChainId = "42161"; // Arbitrum
const toToken = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // USDC on Arbitrum
const toAddress = "0x5937b0EAF840fAbe4619DB8E7e846Dc74C5Ca3d7";

// Set up JSON RPC provider and signer using the private key and RPC URL
const provider = new ethers.JsonRpcProvider(FROM_CHAIN_RPC);
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
    fromAddress: signer.address,
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: fromAmount,
    toChain: toChainId,
    toToken: toToken,
    toAddress: signer.address
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

  // Determine target address from transaction request
  let target: string;
  if ('target' in route.transactionRequest) {
    target = route.transactionRequest.target as string;
  } else {
    console.error("Cannot determine target address from transaction request");
    process.exit(1);
  }

  // Check if we need to bypass token allowance for Hedera direct routes
  if (route.transactionRequest && ('type' in route.transactionRequest || 'routeType' in route.transactionRequest)) {
    const txReqAny = route.transactionRequest as any;
    const routeType = txReqAny.type || txReqAny.routeType;
    if (routeType !== 'DEPOSIT_ADDRESS_WITH_SIGNATURE') {
      await approveSpending(target, fromToken, fromAmount);
    } else {
      console.log(`Route type is ${routeType}, skipping allowance approval as requested for direct Hedera routes.`);
    }
  } else {
    // Standard EVM fallback
    await approveSpending(target, fromToken, fromAmount);
  }
  // Poll `estimateGas` up to 15 times (~15 seconds) to ensure Coral's backend has completed the 
  // token association for this new deposit address on Hedera. `estimateGas` will natively throw 
  // HTS system errors (like TOKEN_NOT_ASSOCIATED_TO_ACCOUNT) until the deposit address is ready!
  console.log("Verifying Hedera token association on deposit address via gas estimation...");
  if (route.transactionRequest) {
    const txReq = route.transactionRequest as any;
    for (let i = 0; i < 15; i++) {
      try {
        await provider.estimateGas({
          from: signer.address,
          to: txReq.target,
          data: txReq.data,
          value: txReq.value
        });
        console.log("Token successfully associated by Squid route! Proceeding with swap...");
        break;
      } catch (e: any) {
        if (i === 14) {
          console.warn("Token association polling timed out. Executing anyway...");
        } else {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }

  // Execute the swap transaction
  // The SDK automatically signs the orderHash (route.transactionRequest.signatureRequired) 
  // and sends the transaction for DEPOSIT_ADDRESS_WITH_SIGNATURE routes.
  const response = await squid.executeRoute({
    signer: signer as any,
    route,
  });

  // Since executeRoute for DEPOSIT_ADDRESS_WITH_SIGNATURE returns { depositTxVerificationSignature: string }
  // along with transaction information
  let txHash: string = 'unknown';
  let depositTxVerificationSignature: string | undefined = undefined;

  if (response && typeof response === 'object') {
    if ('hash' in response) {
      txHash = response.hash as string;
      await (response as any).wait?.();
    } else if ('transactionHash' in response) {
      txHash = (response as any).transactionHash as string;
    } else {
      txHash = (response as any).hash as string || 'unknown';
    }

    // Grab the signature automatically handled by the SDK
    if ('depositTxVerificationSignature' in response) {
      depositTxVerificationSignature = (response as any).depositTxVerificationSignature as string;
    }
  }

  // Show the transaction receipt with Axelarscan link
  const axelarScanLink = "https://scan.squidrouter.com/tx/" + txHash;
  console.log(`Finished execution! Check Coralscan for details: ${axelarScanLink}`);

  // Parameters for checking the status of the transaction
  const getStatusParams: any = {
    transactionId: txHash,
    requestId: requestId,
    integratorId: integratorId,
    fromChainId: fromChainId,
    toChainId: toChainId,
    bridgeType: "rfq",
    quoteId: quoteId || requestId, // Required for Coral V2 transactions
  };

  // MUST append quoteId for Coral V2 transactions

  // MUST append depositTxVerificationSignature to status params to track status correctly!
  if (depositTxVerificationSignature) {
    getStatusParams.depositTxVerificationSignature = depositTxVerificationSignature;
  }
  
  console.log("Status API Params:", JSON.stringify(getStatusParams, null, 2));

  const completedStatuses = ["success", "partial_success", "needs_gas", "not_found"];
  const maxRetries = 100;
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
        console.log("Transaction not found. Retrying...");
        continue;
      } else {
        throw error;
      }
    }
  } while (status && status.squidTransactionStatus && !completedStatuses.includes(status.squidTransactionStatus as string));

  console.log("Swap transaction fully confirmed!");
})();
