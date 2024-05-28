import { ethers } from "ethers";
import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

import aaveLendingPoolAbi from "../abi/aavePoolAbi"; // Adjust the path if necessary

const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const FROM_CHAIN_RPC: string = process.env.RPC_ENDPOINT!;
const AAVE_LENDING_POOL_ADDRESS: string = process.env.AAVE_LENDING_POOL_ADDRESS!;
const usdcArbitrumAddress: string = process.env.USDC_ARBITRUM_ADDRESS!;

const fromChainId = "42161"; // Arbitrum
const toChainId = "56"; // Binance
const fromToken = usdcArbitrumAddress; // USDC on Arbitrum
const toToken = "0x55d398326f99059fF775485246999027B3197955"; // USDT on Binance

const amount = "1000000"; // 10 USDC in smallest units

// Set up JSON RPC provider and signer 
const provider = new ethers.providers.JsonRpcProvider(FROM_CHAIN_RPC);
const signer = new ethers.Wallet(privateKey, provider);


const aaveLendingPoolInterface = new ethers.utils.Interface(aaveLendingPoolAbi);
const withdrawEncodedData = aaveLendingPoolInterface.encodeFunctionData("withdraw", [
  usdcArbitrumAddress,
  amount,
  signer.address,
]);

console.log("Encoded Data:", withdrawEncodedData);

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
    const requestId = result.headers["x-request-id"];
    return { data: result.data, requestId: requestId };
  } catch (error) {
    console.error("Error in getRoute:", error.response?.data || error.message);
    throw error;
  }
};

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
    console.error("Error in getStatus:", error.response?.data || error.message);
    throw error;
  }
};

const updateTransactionStatus = async (txHash: string, requestId: string) => {
  const getStatusParams = {
    transactionId: txHash,
    requestId: requestId,
    fromChainId: fromChainId,
    toChainId: toChainId,
  };

  let status;
  const completedStatuses = ["success", "partial_success", "needs_gas", "not_found"];
  const maxRetries = 15;
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
        await new Promise((resolve) => setTimeout(resolve, 20000));
        continue;
      } else {
        throw error;
      }
    }

    if (!completedStatuses.includes(status.squidTransactionStatus)) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  } while (!completedStatuses.includes(status.squidTransactionStatus));
};

(async () => {
  const params = {
    fromAddress: signer.address,
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: amount,
    toChain: toChainId,
    toToken: toToken,
    toAddress: signer.address,
    slippage: 1,
    slippageConfig: {
      autoMode: 1,
    },
    preHook: {
      chainType: "evm",
      fundAmount: amount,
      fundToken: usdcArbitrumAddress,
      calls: [
        {
          callType: 1,
          target: AAVE_LENDING_POOL_ADDRESS,
          value: "0",
          callData: withdrawEncodedData,
          payload: {
            tokenAddress: usdcArbitrumAddress,
            inputPos: "1",
          },
          estimatedGas: "50000",
          chainType: "evm",
        },
      ],
      description: "Withdraw USDC from AAVE and swap to USDT on Binance",
    },
  };

  console.log("Parameters:", params);

  const routeResult = await getRoute(params);
  const route = routeResult.data.route;
  const requestId = routeResult.requestId;
  console.log("Calculated route:", route);
  console.log("requestId:", requestId);

  const transactionRequest = route.transactionRequest;

  try {
    const tx = await signer.sendTransaction({
      to: transactionRequest.target,
      data: transactionRequest.data,
      value: transactionRequest.value,
      gasPrice: await provider.getGasPrice(),
      gasLimit: ethers.utils.hexlify(3000000), // Increase gas limit
    });
    console.log("Transaction Hash:", tx.hash);
    const txReceipt = await tx.wait();
    console.log("Transaction Receipt:", txReceipt);

    const axelarScanLink = "https://axelarscan.io/gmp/" + txReceipt.transactionHash;
    console.log(`Finished! Check Axelarscan for details: ${axelarScanLink}`);

    await updateTransactionStatus(txReceipt.transactionHash, requestId);
  } catch (error) {
    console.error("Transaction failed:", error);
  }
})();
