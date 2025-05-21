//cosmos to cosmos swap using api

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
dotenv.config();

// Load environment variables
const mnemonic = process.env.MNEMONIC;
const integratorId = process.env.INTEGRATOR_ID;
const osmosisRPC = process.env.OSMOSIS_RPC_ENDPOINT;

// Define chain and token addresses
const fromChainId = "osmosis-1";
const toChainId = "celestia";
const fromToken = "uosmo";
const toToken = "utia";

// Define the amount to be sent (in uosmo)
const amount = "1000000"; // 1 OSMO

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
      fromAddress: "osmo136gxfadc5dg2aejc6twaltt9rqv39qzywatf05",
      fromChain: "osmosis-1",
      fromToken: "uosmo",
      fromAmount: amount,
      toChain: "celestia",
      toToken: "utia",
      toAddress: "celestia136gxfadc5dg2aejc6twaltt9rqv39qzyhvffrt", //destination of the cross-chain transfer
      enableForecall: true,
      quoteOnly: false,
      postHook: {
        chainType: "cosmos",
        callType: 2,
        calls: [
          {
            chainType: "cosmos",
            contract: "celestia136gxfadc5dg2aejc6twaltt9rqv39qzyhvffrt", //the contract address is the receiver of the IBC message
            msg: {
              forward: {
                receiver: "osmo136gxfadc5dg2aejc6twaltt9rqv39qzywatf05", //your address for the pfm module
                port: "transfer",
                channel: "channel-2"
              }
            }
          }
        ],
        provider: "Squid",
        description: "Squid PFM Posthook Test",
        logoURI: "https://mma.prnewswire.com/media/1993096/Squid_Logo.jpg"
      }
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
      "Squid cross-chain swap"
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