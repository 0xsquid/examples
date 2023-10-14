// Import necessary libraries
import { ethers } from "ethers";
import axios from "axios";

// Load environment variables from .env file
import * as dotenv from "dotenv";
dotenv.config();

const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!; // get one at https://form.typeform.com/to/cqFtqSvX
const moonbeamRpcEndpoint: string = process.env.MOONBEAM_RPC_ENDPOINT!;

// Define chain and token addresses
const avalancheChainId = "43114"; // Avalanche
const moonbeamChainId = "1284"; // Moonbeam
const nativeToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const avalancheUsdc = "0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664"; // USDC.e

// Define amount to be sent
const amount = "10000";

// Set up JSON RPC provider and signer
const provider = new ethers.providers.JsonRpcProvider(moonbeamRpcEndpoint);
const signer = new ethers.Wallet(privateKey, provider);

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
  } catch (error) {
    // Log the error response if it's available.
    if (error.response) {
      console.error("API error:", error.response.data);
    }
    console.error("Error with parameters:", params);
    throw error;
  }
};

const getStatus = async (params: any) => {
  try {
    const result = await axios.get("https://api.squidrouter.com/v1/status", {
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

(async () => {
  // Set up parameters for swapping tokens
  const params = {
    fromAddress: signer.address,
    fromChain: avalancheChainId,
    fromToken: avalancheUsdc,
    fromAmount: amount,
    toChain: moonbeamChainId,
    toToken: nativeToken,
    toAddress: signer.address,
    slippage: 1,
    slippageConfig: {
      autoMode: 1,
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

  // Execute the swap transaction
  const contract = new ethers.Contract(
    transactionRequest.targetAddress,
    [],
    signer
  );

  const tx = await contract.send(transactionRequest.data, {
    value: transactionRequest.value,
    gasPrice: await provider.getGasPrice(),
    gasLimit: transactionRequest.gasLimit,
  });
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
    fromChainId: avalancheChainId,
    toChainId: moonbeamChainId,
  };
  const status = await getStatus(getStatusParams);

  // Display the route status
  console.log(`Route status: ${status.squidTransactionStatus}`);
})();
