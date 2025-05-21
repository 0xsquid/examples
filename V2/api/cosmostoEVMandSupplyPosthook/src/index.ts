//cosmos to EVM swap using api with postHook

//imports
import axios from "axios";
import { SigningStargateClient, GasPrice } from "@cosmjs/stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { Registry } from "@cosmjs/proto-signing";
import { defaultRegistryTypes } from "@cosmjs/stargate";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";
import { coin } from "@cosmjs/stargate";
import { Dec } from "@keplr-wallet/unit";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
dotenv.config();

// Load environment variables
const mnemonic = process.env.MNEMONIC;
const integratorId = process.env.INTEGRATOR_ID;
const osmosisRPC = process.env.OSMOSIS_RPC_ENDPOINT;

// Define chain and token addresses
const fromChainId = "osmosis-1";
const toChainId = "42161"; // Arbitrum
const fromToken = "uosmo"; // Osmosis native token
const toToken = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // USDC on Arbitrum
const toAddress = '0xC601C9100f8420417A94F6D63e5712C21029525e' //Set toAddress as your recipient 

// Define the amount to be sent (in uosmo)
const amount = "3000000"; // 1 OSMO

// Aave pool address on Arbitrum
const aavePoolAddress = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";

// ERC20 approve ABI 
const erc20Abi = [
  "function approve(address spender, uint256 amount) public returns (bool)"
];

// Aave pool supply ABI 
const aavePoolAbi = [
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external"
];

// Create contract interfaces
const erc20Interface = new ethers.utils.Interface(erc20Abi);
const aavePoolInterface = new ethers.utils.Interface(aavePoolAbi);

// Generate calldata for approve
const approveCalldata = erc20Interface.encodeFunctionData("approve", [
  aavePoolAddress,
  ethers.constants.MaxUint256 // Approve max amount
]);

// Generate calldata for supply
const supplyCalldata = aavePoolInterface.encodeFunctionData("supply", [
  toToken, // asset (USDC on Arbitrum)
  0, // amount (will be filled by Squid)
  toAddress, // onBehalfOf (will be replaced with actual address)
  0 // referralCode
]);
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
  } catch (error: any) {
    if (error.response) {
      console.error("API error:", error.response.data);
    }
    console.error("Error with parameters:", params);
    throw error;
  }
};

// Function to periodically check the transaction status until it completes
const updateTransactionStatus = async (txHash: string, requestId: string) => {
  const getStatusParams = {
    transactionId: txHash,
    requestId: requestId,
    fromChainId: fromChainId,
    toChainId: toChainId,
  };

  let status;
  const completedStatuses = ["success", "partial_success", "needs_gas", "not_found"];
  const maxRetries = 10;
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
        console.log("Transaction not found. Retrying...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
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

// Main function to execute the swap
(async () => {
  try {
    // Set up Cosmos wallet and client
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: "osmo" });
    const [account] = await wallet.getAccounts();

    const myRegistry = new Registry([
      ...defaultRegistryTypes,
      ["/cosmwasm.wasm.v1.MsgExecuteContract", MsgExecuteContract],
    ]);

    const client = await SigningStargateClient.connectWithSigner(
      osmosisRPC,
      wallet,
      { registry: myRegistry }
    );

    // Set up parameters for swapping tokens
    const params = {
      fromAddress: account.address,
      fromChain: fromChainId,
      fromToken: fromToken,
      fromAmount: amount,
      toChain: toChainId,
      toToken: toToken,
      toAddress: toAddress,
      slippage: 1,
      postHook: {
        chainType: "evm",
        calls: [
          {
            callType: 1,
            target: toToken,
            value: "0",
            callData: approveCalldata,
            payload: {
              tokenAddress: toToken,
              inputPos: "1",
            },
            estimatedGas: "150000",
            chainType: "evm",
          },
          {
            callType: 1,
            target: aavePoolAddress,
            value: "0",
            callData: supplyCalldata,
            payload: {
              tokenAddress: toToken,
              inputPos: "1",
            },
            estimatedGas: "150000",
            chainType: "evm",
          },
        ],
        provider: "Test",
        description: "Test arb post hook",
        logoURI: "https://valoraapp.com/favicon.ico",
      },
    };

    console.log("Parameters:", params);

    // Get the swap route using Squid API
    const routeResult = await getRoute(params);
    const route = routeResult.data.route;
    const requestId = routeResult.requestId;
    console.log("Calculated route:", route);
    console.log("requestId:", requestId);

    // Parse the data field from the transactionRequest
    const parsedData = JSON.parse(route.transactionRequest.data);
    console.log('parsed data:', parsedData);
    console.log('parsed data funds:', parsedData.value.funds);

    // Create a proper MsgExecuteContract object
    const msg = {
      typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
      value: MsgExecuteContract.fromPartial({
        sender: parsedData.value.sender,
        contract: parsedData.value.contract,
        msg: Buffer.from(parsedData.value.msg),
        funds: parsedData.value.funds,
      }),
    };

    // Extract gas price from the Squid API response
    const gasPrice = GasPrice.fromString(route.transactionRequest.gasPrice);

    // Set a higher default gas limit and apply a multiplier
    const defaultGasLimit = 1000000;
    const gasLimitMultiplier = 2;
    const gasLimit = Math.ceil(
      (parseInt(route.transactionRequest.gasLimit) || defaultGasLimit) * gasLimitMultiplier
    ).toString();

    // Calculate the fee amount
    const gasPriceDec = new Dec(gasPrice.amount.toString());
    const gasLimitDec = new Dec(gasLimit);
    const feeAmount = gasPriceDec.mul(gasLimitDec).truncate().toString();

    // Execute the swap transaction
    const fee = {
      amount: [coin(feeAmount, gasPrice.denom)],
      gas: gasLimit,
    };

    console.log("Fee:", fee);

    const tx = await client.signAndBroadcast(
      account.address,
      [msg],
      fee,
      "Squid cross-chain swap with Aave deposit"
    );

    console.log("Transaction Hash:", tx.transactionHash);

    // Show the transaction receipt with Axelarscan link
    const axelarScanLink = "https://axelarscan.io/gmp/" + tx.transactionHash;
    console.log(`Finished! Check Axelarscan for details: ${axelarScanLink}`);

    // Update transaction status until it completes
    await updateTransactionStatus(tx.transactionHash, requestId);
  } catch (error) {
    console.error("Error:", error);
  }
})();