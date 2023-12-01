// Import necessary libraries
import { ethers } from "ethers";
import { Squid } from "@0xsquid/sdk";

// Load environment variables from .env file
import * as dotenv from "dotenv";
dotenv.config();

const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!; // get one at https://form.typeform.com/to/cqFtqSvX
const ethereumRpcEndpoint: string = process.env.ETHEREUM_RPC_ENDPOINT!;

// Define chain and token addresses
const ethereumChainId = "1"; //
const nobleChainId = "grand-1"; //
const usdcTokenEthereum = "0x07865c6E87B9F70255377e024ace6630C1Eaa37F";
const usdcTokenNoble = "uusdc"; //

// Define amount to be sent
const amount = "1000000"; // 0.01 USDC

// Function to get Squid SDK instance
const getSDK = (): Squid => {
  const squid = new Squid({
    baseUrl: "https://testnet.v2.api.squidrouter.com",
    integratorId: integratorId,
  });
  return squid;
};

// Main function
(async () => {
  // Set up JSON RPC provider and signer
  const provider = new ethers.JsonRpcProvider(ethereumRpcEndpoint);
  const signer = new ethers.Wallet(privateKey, provider);

  // Initialize Squid SDK
  const squid = getSDK();
  await squid.init();
  console.log("Initialized Squid SDK");

  // Set up parameters for swapping tokens
  const params = {
    fromAddress: signer.address,
    fromChain: ethereumChainId,
    fromToken: usdcTokenEthereum,
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
  })) as unknown as ethers.TransactionResponse;
  const txReceipt = await tx.wait();

  // Wait a few seconds before checking the status
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Retrieve the transaction's route status
  const getStatusParams = {
    transactionId: txReceipt.hash,
    requestId: requestId,
    fromChainId: ethereumChainId,
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
