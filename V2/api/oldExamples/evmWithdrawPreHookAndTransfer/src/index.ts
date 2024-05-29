import { ethers } from "ethers";
import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

import aaveLendingPoolAbi from "../abi/aavePoolAbi"; // Adjust the path if necessary
import erc20Abi from "../abi/erc20Abi";

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

//ave contract interface
const aaveLendingPoolInterface = new ethers.utils.Interface(aaveLendingPoolAbi);
const withdrawEncodedData = aaveLendingPoolInterface.encodeFunctionData("withdraw", [
  usdcArbitrumAddress,
  amount,
  signer.address,
]);

console.log("Encoded Data:", withdrawEncodedData);


// Approve the lending contract to spend the erc20
const erc20Interface = new ethers.utils.Interface(erc20Abi);
const approvalerc20 = erc20Interface.encodeFunctionData("approve", [
  "0x794a61358d6845594f94dc1db02a252b5b4814ad", //address to approve spending 
  ethers.constants.MaxUint256,
]);

//Approving squid router contract to spend Aave USDC


// Create a wallet instance


const erc20Contract = new ethers.Contract('0x724dc807b04555b71ed48a6896b6F41593b8C637', erc20Abi, signer);//aave usdc

// Function to approve tokens
async function approveToken() {
  console.log("entered approve function")
  try {
    const tx = await erc20Contract.approve('0xce16f69375520ab01377ce7b88f5ba8c48f8d666', amount);
    console.log("Transaction hash:", tx.hash);
    await tx.wait();
    console.log("Transaction confirmed");
  } catch (error) {
    console.error("Error approving tokens:", error);
  }
}

// Call the approve function






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

  approveToken();
  const params = {
    fromAddress: signer.address,
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: '1000', //check exchange rate of aave usdc to arbitrum usdc 
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
      fundToken: '0x724dc807b04555b71ed48a6896b6F41593b8C637', //aave usdc
      calls: [
        {
          callType: 1,
          target: usdcArbitrumAddress,
          value: "0",
          callData: approvalerc20,
          payload: {
            tokenAddress: usdcArbitrumAddress, //set to dummy address
            inputPos: "1",
          },
          estimatedGas: "450000",
          chainType: "evm",
        },
        {
          callType: 1,
          target: AAVE_LENDING_POOL_ADDRESS,
          value: "0",
          callData: withdrawEncodedData,
          payload: {
            tokenAddress: usdcArbitrumAddress, //set to dummy address
            inputPos: "1",
          },
          estimatedGas: "450000",
          chainType: "evm",
        },
      ],
      description: "Withdraw USDC from AAVE and swap to USDT on Binance",
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
  const tx = await signer.sendTransaction({
    to: transactionRequest.target,
    data: transactionRequest.data,
    value: transactionRequest.value,
    gasPrice: await provider.getGasPrice(),
    gasLimit: transactionRequest.gasLimit,
  });
  console.log("Transaction Hash:", tx.hash);
  const txReceipt = await tx.wait();

  // Show the transaction receipt with Axelarscan link
  const axelarScanLink = "https://axelarscan.io/gmp/" + txReceipt.transactionHash;
  console.log(`Finished! Check Axelarscan for details: ${axelarScanLink}`);

  // Update transaction status until it completes
  await updateTransactionStatus(txReceipt.transactionHash, requestId);
})();
