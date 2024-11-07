import axios from "axios";
import { SigningStargateClient, GasPrice } from "@cosmjs/stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { Registry } from "@cosmjs/proto-signing";
import { defaultRegistryTypes } from "@cosmjs/stargate";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";
import { coin } from "@cosmjs/stargate";
import { Dec } from "@keplr-wallet/unit";
import * as dotenv from "dotenv";
import { MsgTransfer } from "cosmjs-types/ibc/applications/transfer/v1/tx";
dotenv.config();

// Load environment variables
const mnemonic = process.env.MNEMONIC;
const integratorId = process.env.INTEGRATOR_ID;
const osmosisRPC = process.env.OSMOSIS_RPC_ENDPOINT;

// Main function to execute the swap
(async () => {
  try {
    // Set up Cosmos wallet and client
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: "celestia" });
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
      fromAddress: "celestia136gxfadc5dg2aejc6twaltt9rqv39qzyhvffrt",
      fromChain: "celestia",
      fromToken: "utia",
      fromAmount: "10000",
      toChain: "osmosis-1",
      toToken: "uosmo",
      toAddress: "osmo136gxfadc5dg2aejc6twaltt9rqv39qzywatf05",
      enableForecall: true,
      quoteOnly: false,
      postHook: {
        calls: [
          {
            contract: "osmo1c3ljch9dfw5kf52nfwpxd2zmj2ese7agnx0p9tenkrryasrle5sqf3ftpg",
            msg: {
              deposit: {
                on_behalf_of: "osmo136gxfadc5dg2aejc6twaltt9rqv39qzywatf05",
              }
            }
          }
        ],
        chainType: "cosmos",
        callType: 2,
        provider: "Saga",
        description: "Saga PoC",
        logoURI: "https://pbs.twimg.com/profile_images/1508474357315616768/zcPXETKs_400x400.jpg"
      }
    };

    // Get the swap route using Squid API
    const routeResult = await getRoute(params);
    const route = routeResult.data.route;
    const requestId = routeResult.requestId;
    console.log("Calculated route:", route);
    console.log("requestId:", requestId);

    // Parse the data field from the transactionRequest
    const parsedData = JSON.parse(route.transactionRequest.data);
    console.log('parsed data:', parsedData);

    // Convert timestamp to proper format
    const timestamp = parsedData.value.timeoutTimestamp;
    const timeoutTimestamp = timestamp.unsigned 
      ? BigInt(timestamp.high) * BigInt(2 ** 32) + BigInt(timestamp.low)
      : BigInt(timestamp.high) * BigInt(2 ** 32) + BigInt(timestamp.low >>> 0);

    // Create IBC transfer message
    const msg = {
      typeUrl: "/ibc.applications.transfer.v1.MsgTransfer",
      value: MsgTransfer.fromPartial({
        sourcePort: parsedData.value.sourcePort,
        sourceChannel: parsedData.value.sourceChannel,
        token: parsedData.value.token,
        sender: parsedData.value.sender,
        receiver: parsedData.value.receiver,
        timeoutTimestamp: timeoutTimestamp,
        memo: parsedData.value.memo
      })
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

// Helper function to get route
async function getRoute(params: any) {
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
  } catch (error: any) {
    if (error.response) {
      console.error("API error:", error.response.data);
    }
    console.error("Error with parameters:", params);
    throw error;
  }
}

// Helper function to get status
async function getStatus(params: any) {
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
  } catch (error: any) {
    if (error.response) {
      console.error("API error:", error.response.data);
    }
    console.error("Error with parameters:", params);
    throw error;
  }
}

// Helper function to update transaction status
async function updateTransactionStatus(txHash: string, requestId: string) {
  const getStatusParams = {
    transactionId: txHash,
    requestId: requestId,
    fromChainId: "celestia",
    toChainId: "osmosis-1"
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
}