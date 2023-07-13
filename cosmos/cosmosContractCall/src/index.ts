import { Squid } from "@0xsquid/sdk";
import { SigningStargateClient, DeliverTxResponse } from "@cosmjs/stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { fromBech32, toBech32 } from "@cosmjs/encoding";

// Environment
// add to a file named ".env" to prevent them being uploaded to github
import * as dotenv from "dotenv";
dotenv.config();

const mnemonic = process.env.MNEMONIC;
const axelarRpc = process.env.AXELAR_RPC_ENDPOINT;

// addresses and IDs
const axelarChainId = "axelar-dojo-1";
const osmosisChainId = "osmosis-1";
const uaxlAddressAxelar = "uaxl";
const uaxlAddressOsmosis =
  "ibc/903A61A498756EA560B85A85132D3AEE21B5DEDD41213725D22ABF276EA6945E";

// amount of uaxl to send from Axelar to Osmosis
const amount = "1000000";

const getSDK = () => {
  const squid = new Squid({
    baseUrl: "https://squid-api-git-feat-cosmos-mainmainnet-0xsquid.vercel.app",
  });
  return squid;
};

(async () => {
  const offlineSigner = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: "axelar",
  });

  const signerAddress = (await offlineSigner.getAccounts())[0].address;
  console.log(`Sender address: ${signerAddress}`);

  const osmosisAddress = deriveCosmosAddress("osmo", signerAddress);
  console.log(`Receiver address: ${osmosisAddress}`);

  const signer = await SigningStargateClient.connectWithSigner(
    axelarRpc,
    offlineSigner
  );

  // instantiate the SDK
  const squid = getSDK();
  // init the SDK
  await squid.init();
  console.log("Squid inited");

  const params = {
    fromChain: axelarChainId,
    fromToken: uaxlAddressAxelar,
    fromAmount: amount,
    cosmosSignerAddress: signerAddress,
    toChain: osmosisChainId,
    toToken: uaxlAddressOsmosis,
    toAddress: osmosisAddress, // this address will be replaced with contract address
    slippage: 3.0,
    customCosmosContractCall: {
      contract:
        "osmo15jw7xccxaxk30lf4xgag8f7aeg53pgkh74e39rv00xfnymldjaas2fk627",
      msg: {
        wasm: {
          contract:
            "osmo15jw7xccxaxk30lf4xgag8f7aeg53pgkh74e39rv00xfnymldjaas2fk627",
          msg: {
            swap_with_action: {
              swap_msg: {
                token_out_min_amount: "61810",
                path: [
                  {
                    pool_id: "812",
                    token_out_denom: "uosmo",
                  },
                  {
                    pool_id: "678",
                    token_out_denom:
                      "ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858",
                  },
                ],
              },
              after_swap_action: {
                bank_send: {
                  receiver: osmosisAddress,
                },
              },
              local_fallback_address: osmosisAddress,
            },
          },
        },
      },
    },
  };

  const { route } = await squid.getRoute(params);

  const txInfo = (await squid.executeRoute({
    signer,
    signerAddress,
    route,
  })) as DeliverTxResponse;

  const txLink = `https://www.mintscan.io/axelar/txs/${txInfo.transactionHash}`;
  console.log(`Finished! You can find your transaction here: ${txLink}`);
})();

export const deriveCosmosAddress = (
  chainPrefix: string,
  address: string
): string => {
  return toBech32(chainPrefix, fromBech32(address).data);
};
