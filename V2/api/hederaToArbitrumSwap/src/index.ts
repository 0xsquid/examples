import { ethers } from "ethers";
import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

// Load environment variables from .env file
const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const FROM_CHAIN_RPC: string = process.env.FROM_CHAIN_RPC_ENDPOINT!;

if (!privateKey || !integratorId || !FROM_CHAIN_RPC) {
  console.error("Missing environment variables. Ensure PRIVATE_KEY, INTEGRATOR_ID, and FROM_CHAIN_RPC_ENDPOINT are set.");
  process.exit(1);
}

// Define parameters from the provided payload
const fromChainId = "295"; // Hedera Mainnet
const fromToken = "0x000000000000000000000000000000000006f89a"; // USDC on Hedera
const fromAmount = "2000";

const toChainId = "8453"; // Arbitrum
const toToken = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // USDC on Arbitrum

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
const getStatus = async (params: any) => {
  try {
    const result = await axios.get("https://v2.api.squidrouter.com/v2/status", {
      params,
      headers: {
        "x-integrator-id": integratorId,
      },
    });
    return result.data;
  } catch (error: any) {
    if (error.response) {
      console.error("API Error when checking status:", error.response.data);
    }
    throw error;
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

// Function to periodically check the transaction status until it completes
const updateTransactionStatus = async (txHash: string, requestId: string, depositTxVerificationSignature?: string, quoteId?: string) => {
  const getStatusParams: any = {
    transactionId: txHash,
    requestId: requestId,
    fromChainId: fromChainId,
    toChainId: toChainId,
    bridgeType: "rfq",
    quoteId: quoteId || requestId, // Required for Coral V2 transactions
  };

  if (depositTxVerificationSignature) {
    getStatusParams.depositTxVerificationSignature = depositTxVerificationSignature;
  }

  console.log("Status API Params:", JSON.stringify(getStatusParams, null, 2));

  let status;
  const completedStatuses = ["success", "partial_success", "needs_gas", "not_found"];
  const maxRetries = 100;
  let retryCount = 0;

  do {
    try {
      status = await getStatus(getStatusParams);
      console.log(`Route status: ${status.squidTransactionStatus}`);
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        retryCount++;
        if (retryCount >= maxRetries) {
          console.error("Max retries reached. Transaction not found.");
          break;
        }
        console.log("Transaction not found. Retrying in 5 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      } else {
        throw error;
      }
    }

    if (status && status.squidTransactionStatus && !completedStatuses.includes(status.squidTransactionStatus as string)) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  } while (!(status && status.squidTransactionStatus && completedStatuses.includes(status.squidTransactionStatus as string)));

  console.log("Swap fully confirmed on Squid API!");
};

// Set up parameters for swapping tokens
(async () => {
  const params = {
    fromAddress: signer.address,
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: fromAmount,
    toChain: toChainId,
    toToken: toToken,
    toAddress: signer.address,
    quoteOnly: false
  };

  console.log("Parameters:", params);

  const routeResult = await getRoute(params);
  const route = routeResult.data.route;
  const requestId = routeResult.requestId;

  // Extract quoteId for Coral V2 transactions
  const quoteId = routeResult.data.route?.estimate?.actions?.[0]?.coralV2Order?.quoteId 
               || routeResult.data.route?.estimate?.quoteId 
               || routeResult.data.route?.quoteId 
               || routeResult.data?.quoteId;

  console.log("Calculated route... target output:", route.estimate.toAmount);
  console.log("requestId:", requestId);
  console.log("EXTRACTED quoteId:", quoteId);

  const transactionRequest = route.transactionRequest;

  let depositTxVerificationSignature: string | undefined;

  // Check if we need to bypass token allowance for Hedera direct routes
  if (transactionRequest.type === 'DEPOSIT_ADDRESS_WITH_SIGNATURE' || transactionRequest.routeType === 'DEPOSIT_ADDRESS_WITH_SIGNATURE') {
    console.log(`Route type is DEPOSIT_ADDRESS_WITH_SIGNATURE, skipping ERC-20 approval...`);

    // For DEPOSIT_ADDRESS_WITH_SIGNATURE, we must sign the orderhash with evmSigner
    const orderHash = transactionRequest.signatureRequired;
    if (orderHash) {
      // The Squid indexer strictly expects the signature of the literal UTF-8 hex string, NOT raw bytes!
      depositTxVerificationSignature = await signer.signMessage(orderHash);
      console.log("Successfully generated deposit verification signature:", depositTxVerificationSignature);
    } else {
      console.warn("Expected signatureRequired in transactionRequest for DEPOSIT_ADDRESS_WITH_SIGNATURE, but none was found.");
    }
  } else {
    // Approve the transactionRequest.target to spend fromAmount of fromToken
    await approveSpending(transactionRequest.target, fromToken, fromAmount);
  }

  // Poll `estimateGas` up to 15 times (~15 seconds) to ensure Coral's backend has completed the 
  // token association for this new deposit address on Hedera. `estimateGas` will natively throw 
  // HTS system errors (like TOKEN_NOT_ASSOCIATED_TO_ACCOUNT) until the deposit address is ready!
  console.log("Verifying Hedera token association on deposit address via gas estimation...");
  for (let i = 0; i < 15; i++) {
    try {
      await provider.estimateGas({
        from: signer.address,
        to: transactionRequest.target,
        data: transactionRequest.data,
        value: transactionRequest.value
      });
      console.log("Token successfully associated by Squid route! Proceeding with swap...");
      break;
    } catch (e: any) {
      if (i === 14) {
        console.warn("Token association polling timed out. Attempting EVM execution anyway...");
      } else {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  // Execute the swap transaction on EVM
  const tx = await signer.sendTransaction({
    to: transactionRequest.target,
    data: transactionRequest.data,
    value: transactionRequest.value,
    gasPrice: transactionRequest.gasPrice,
    gasLimit: transactionRequest.gasLimit,
  });
  console.log("Transaction Broadcasted, Hash:", tx.hash);
  const txReceipt = await tx.wait();

  console.log("Transaction Mined in EVM block!");

  // Use Coralscan for checking RFQ cross-chain intents
  const axelarScanLink = "https://scan.squidrouter.com/tx/" + txReceipt!.hash;
  console.log(`Check Coralscan for details: ${axelarScanLink}`);

  // Update transaction status until it completes, ensuring the signature is passed to the /status endpoint
  await updateTransactionStatus(txReceipt!.hash, requestId as string, depositTxVerificationSignature, quoteId);
})();
