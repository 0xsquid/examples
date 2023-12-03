// Import necessary libraries
import { ethers } from "ethers";
import { Squid } from "@0xsquid/sdk";

// Load environment variables from .env file
import * as dotenv from "dotenv";
dotenv.config();

const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!; // get one at https://form.typeform.com/to/cqFtqSvX
const RpcEndpoint: string = process.env.RPC_ENDPOINT!;

// Define chain and token addresses
const evmChainId = "43114";
const nobleChainId = "noble-1";
const usdcEVMToken = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";
const usdcTokenNoble = "uusdc";

// Define amount to be sent
const amount = "100000"; // 0.01 USDC

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
  // Set up JSON RPC provider and signer
  const provider = new ethers.providers.JsonRpcProvider(RpcEndpoint);
  const signer = new ethers.Wallet(privateKey, provider);

  // Initialize Squid SDK
  const squid = getSDK();
  await squid.init();
  console.log("Initialized Squid SDK");

  // Set up parameters for swapping tokens
  const params = {
    fromAddress: signer.address,
    fromChain: evmChainId,
    fromToken: usdcEVMToken,
    fromAmount: amount,
    toChain: nobleChainId,
    toToken: usdcTokenNoble,
    toAddress: "noble1zqnudqmjrgh9m3ec9yztkrn4ttx7ys64p87kkx",
    slippage: 1,
    slippageConfig: {
      autoMode: 1,
    },
    quoteOnly: false,
  };

  console.log("Parameters:", params);
  // Get the swap route using Squid SDK
  const { route, requestId } = await squid.getRoute(params);
  console.log("Calculated route:", route.estimate.toAmount);

  const { isApproved, message } = await squid.isRouteApproved({
    route,
    sender: signer.address,
  });

  // check if route is approved
  if (!isApproved) {
    console.log("Route is not approved, approving now...");
    const approve = await squid.approveRoute({ signer, route });
    signer.provider.getNetwork;
  }
  console.log("Route is approved");

  // Execute the swap transaction
  const tx = (await squid.executeRoute({
    signer,
    route,
  })) as unknown as ethers.providers.TransactionResponse;
  const txReceipt = await tx.wait();

  // Wait a few seconds before checking the status
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Retrieve the transaction's route status
  const getStatusParams = {
    transactionId: txReceipt.transactionHash,
    requestId: requestId,
    fromChainId: evmChainId,
    toChainId: nobleChainId,
    bridgeType: "cctp",
  };

  console.log("checkig tx status....");
  async function waitForSuccess() {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    let isSuccess = false;
    while (!isSuccess) {
      try {
        const status = await squid.getStatus(getStatusParams);
        if (status && status.squidTransactionStatus === "success") {
          console.log(status);
          console.log("Transaction successful!");
          isSuccess = true;
        } else {
          console.log(status);
          console.log("In progress....");
          await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait for 5 seconds before the next check
        }
      } catch (error) {
        console.log("Error:", error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  await waitForSuccess();
})();
