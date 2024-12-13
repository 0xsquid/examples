//imports
import { ethers } from "ethers";
import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

// Load environment variables
const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const FROM_CHAIN_RPC: string = process.env.RPC_ENDPOINT!;

// Define chain and token addresses
const fromChainId = "42161"; // Arbitrum
const toChainId = "10"; // Optimism
const fromToken = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // USDC on Arbitrum
const toToken = "0x0b2c639c533813f4aa9d7837caf62653d097ff85"; // USDC on Optimism (Updated)
const aaveArbitrumPoolAddress = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
const aaveOptimismPoolAddress = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
const withdrawToken = "0x724dc807b04555b71ed48a6896b6F41593b8C637"; // aArbUSDCn

// Define amount to be withdrawn and bridged
const amount = ethers.utils.parseUnits("1", 6); // 100 USDC

// Set up JSON RPC provider and signer
const provider = new ethers.providers.JsonRpcProvider(FROM_CHAIN_RPC);
const signer = new ethers.Wallet(privateKey, provider);

// Import ABIs
import erc20Abi from "../abi/erc20Abi";

// Define Aave pool ABI
const aavePoolAbi = [
  "function withdraw(address asset, uint256 amount, address to) external returns (uint256)",
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external"
];

// Creating Contract interfaces
const withdrawTokenContract = new ethers.Contract(withdrawToken, erc20Abi, signer);
const aaveArbitrumPoolContract = new ethers.Contract(aaveArbitrumPoolAddress, aavePoolAbi, signer);
const aaveOptimismPoolContract = new ethers.Contract(aaveOptimismPoolAddress, aavePoolAbi, signer);
const toTokenContract = new ethers.Contract(toToken, erc20Abi, signer);

// Function to get the optimal route for the swap using Squid API
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

// Set up parameters for withdrawing from Aave on Arbitrum and depositing to Aave on Optimism
(async () => {
  // Construct the withdraw function call data
  const withdrawData = aaveArbitrumPoolContract.interface.encodeFunctionData("withdraw", [
    fromToken,
    amount,
    "0xaD6Cea45f98444a922a2b4fE96b8C90F0862D2F4" // Squid multi-router address
  ]);

  // Construct the supply function call data
  const supplyData = aaveOptimismPoolContract.interface.encodeFunctionData("supply", [
    toToken,
    "0", // Amount will be replaced with the full token balance
    signer.address,
    0 // referralCode
  ]);

  // Construct the approval call data
  const approvalData = toTokenContract.interface.encodeFunctionData("approve", [
    aaveOptimismPoolAddress,
    ethers.constants.MaxUint256,
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
          target: aaveArbitrumPoolAddress,
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
      description: "Withdraw from Aave on Arbitrum",
      logoURI: "https://app.aave.com/favicon.ico",
    },
    postHook: {
      chainType: "evm",
      calls: [
        {
          callType: 1,
          target: toToken,
          value: "0",
          callData: approvalData,
          payload: {
            tokenAddress: toToken,
            inputPos: "1",
          },
          estimatedGas: "50000",
          chainType: "evm",
        },
        {
          callType: 1,
          target: aaveOptimismPoolAddress,
          value: "0",
          callData: supplyData,
          payload: {
            tokenAddress: toToken,
            inputPos: "1",
          },
          estimatedGas: "200000",
          chainType: "evm",
        },
      ],
      provider: "Aave",
      description: "Deposit to Aave on Optimism",
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

  // Execute the withdraw, bridge, and deposit transaction
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