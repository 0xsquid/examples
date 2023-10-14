// Import necessary libraries
import { ethers } from "ethers";
import { Squid } from "@0xsquid/sdk";

// Load environment variables from .env file
import * as dotenv from "dotenv";
dotenv.config();

const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!; // get one at https://form.typeform.com/to/cqFtqSvX
const polygonRpcEndpoint: string = process.env.POLYGON_RPC_ENDPOINT!;

// Define chain and token addresses
const polygonChainId = "137"; // Polygon
const moonbeamChainId = "1284"; // Moonbeam
const nativeToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const polygonUsdc = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";

// Define amount to be sent
const amount = "10000"; // 0.01 USDC

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
  const provider = new ethers.providers.JsonRpcProvider(polygonRpcEndpoint);
  const signer = new ethers.Wallet(privateKey, provider);

  // Initialize Squid SDK
  const squid = getSDK();
  await squid.init();
  console.log("Initialized Squid SDK");

  // Set up parameters for swapping tokens
  const params = {
    fromAddress: signer.address,
    fromChain: polygonChainId,
    fromToken: polygonUsdc,
    fromAmount: amount,
    toChain: moonbeamChainId,
    toToken: nativeToken,
    toAddress: signer.address,
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

  // Execute the swap transaction
  const tx = (await squid.executeRoute({
    signer,
    route,
  })) as unknown as ethers.providers.TransactionResponse;
  const txReceipt = await tx.wait();

  // Show the transaction receipt with Axelarscan link
  const axelarScanLink =
    "https://axelarscan.io/gmp/" + txReceipt.transactionHash;
  console.log(`Finished! Check Axelarscan for details: ${axelarScanLink}`);

  // Wait a few seconds before checking the status
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Retrieve the transaction's route status
  const getStatusParams = {
    transactionId: txReceipt.transactionHash,
    requestId: requestId,
    fromChainId: polygonChainId,
    toChainId: moonbeamChainId,
  };
  const status = await squid.getStatus(getStatusParams);

  // Display the route status
  console.log(`Route status: ${status.squidTransactionStatus}`);
})();
