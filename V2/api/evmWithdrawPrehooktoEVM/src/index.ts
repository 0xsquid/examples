import { ethers } from "ethers";
import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

// Load environment variables from .env file
const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const FROM_CHAIN_RPC: string = process.env.RPC_ENDPOINT!;

// Define chain and token addresses
const fromChainId = "42161"; // Arbitrum
const toChainId = "10"; // Optimism
const fromToken = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // USDC on Arbitrum
const toToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"; // ETH on Optimism
const aavePoolAddress = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
const withdrawToken = "0x724dc807b04555b71ed48a6896b6F41593b8C637"; // aArbUSDCn

// Define amount to be withdrawn and bridged
const amount = ethers.utils.parseUnits("0.12", 6); // 0.12 USDC

// Set up JSON RPC provider and signer
const provider = new ethers.providers.JsonRpcProvider(FROM_CHAIN_RPC);
const signer = new ethers.Wallet(privateKey, provider);

// Import ABIs
import erc20Abi from "../abi/erc20Abi";

// Define Aave pool ABI (just the withdraw function)
const aavePoolAbi = [
  "function withdraw(address asset, uint256 amount, address to) external returns (uint256)"
];

// Creating Contract interfaces
const withdrawTokenContract = new ethers.Contract(withdrawToken, erc20Abi, signer);
const aavePoolContract = new ethers.Contract(aavePoolAddress, aavePoolAbi, signer);

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
  } catch (error) {
    if (error.response) {
      console.error("API error:", error.response.data);
    }
    console.error("Error with parameters:", params);
    throw error;
  }
};

// Function to approve the transactionRequest.target to spend fromAmount of withdrawToken
const approveSpending = async (transactionRequestTarget: string, tokenAmount: string) => {
  try {
    const currentAllowance = await withdrawTokenContract.allowance(signer.address, transactionRequestTarget);
    if (currentAllowance.lt(tokenAmount)) {
      const tx = await withdrawTokenContract.approve(transactionRequestTarget, tokenAmount);
      await tx.wait();
      console.log(`Approved ${tokenAmount} tokens for ${transactionRequestTarget}`);
    } else {
      console.log("Sufficient allowance already exists.");
    }
  } catch (error) {
    console.error('Approval failed:', error);
    throw error;
  }
};

// Set up parameters for withdrawing from Aave and bridging to Optimism
(async () => {
  
  // Construct the withdraw function call data using the contract interface
  const withdrawData = aavePoolContract.interface.encodeFunctionData("withdraw", [
    fromToken,
    amount,
    "0xaD6Cea45f98444a922a2b4fE96b8C90F0862D2F4" // Squid multi-router address
  ]);

  const params = {
    fromAddress: signer.address,
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: amount.toString(),
    toChain: toChainId,
    toToken: toToken,
    toAddress: signer.address,
    slippage: 1,
    preHook: {
      chainType: "evm",
      fundAmount: amount.toString(),
      fundToken: withdrawToken,
      calls: [
        {
          callType: 2,
          target: aavePoolAddress,
          value: "0",
          callData: withdrawData,
          payload: {
            tokenAddress: fromToken,
            inputPos: 1,
          },
          estimatedGas: "150000",
          chainType: "evm",
        },
      ],
      provider: "Aave",
      description: "Aave Withdraw",
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

  // Approve the transactionRequest.target to spend fromAmount of withdrawToken
  await approveSpending(transactionRequest.target, amount.toString());

  // Execute the withdraw and bridge transaction
  const tx = await signer.sendTransaction({
    to: transactionRequest.target,
    data: transactionRequest.data,
    value: transactionRequest.value,
    gasPrice: transactionRequest.gasPrice,
    gasLimit: (BigInt(transactionRequest.gasLimit) * BigInt(2)).toString(),
  });

  const txReceipt = await tx.wait();
  console.log("Transaction Hash: ", txReceipt.transactionHash);

  // Show the transaction receipt with Axelarscan link
  const axelarScanLink = "https://axelarscan.io/gmp/" + txReceipt.transactionHash;
  console.log(`Finished! Check Axelarscan for details: ${axelarScanLink}`);
})();