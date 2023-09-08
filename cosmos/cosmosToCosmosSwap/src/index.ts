import { Squid } from "@0xsquid/sdk";
import { SigningStargateClient } from "@cosmjs/stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { fromBech32, toBech32 } from "@cosmjs/encoding";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";

// Environment
// add to a file named ".env" to prevent them being uploaded to github
import * as dotenv from "dotenv";
dotenv.config();

const mnemonic = process.env.MNEMONIC;
const osmosisRpc = process.env.OSMOSIS_RPC_ENDPOINT;

// addresses and IDs
const axelarChainId = "axelar-dojo-1";
const osmosisChainId = "osmosis-1";
const uaxlAddressAxelar = "uaxl";
const uosmoAddress = "uosmo";

// amount of uosmo to swap
const amount = "1000000";

const getSDK = () => {
  const squid = new Squid({
    baseUrl: "https://squid-api-git-feat-cosmos-mainmainnet-0xsquid.vercel.app",
  });
  return squid;
};

(async () => {
  const offlineSigner = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: "osmo",
  });

  const signerAddress = (await offlineSigner.getAccounts())[0].address;
  console.log(`Sender address: ${signerAddress}`);

  const axelarAddress = deriveCosmosAddress("axelar", signerAddress);
  console.log(`Receiver address: ${axelarAddress}`);

  const signer = await SigningStargateClient.connectWithSigner(
    osmosisRpc,
    offlineSigner
  );

  // instantiate the SDK
  const squid = getSDK();
  // init the SDK
  await squid.init();
  console.log("Squid inited");

  const params = {
    fromChain: osmosisChainId,
    fromToken: uosmoAddress,
    fromAmount: amount,
    fromAddress: signerAddress,
    toChain: axelarChainId,
    toToken: uaxlAddressAxelar,
    toAddress: axelarAddress,
    slippage: 3.0,
  };

  const { route } = await squid.getRoute(params);

  const txRaw = (await squid.executeRoute({
    signer,
    signerAddress,
    route,
  })) as TxRaw;

  const txInfo = await signer.broadcastTx(TxRaw.encode(txRaw).finish());

  const txLink = `https://www.mintscan.io/osmosis/txs/${txInfo.transactionHash}`;
  console.log(`Finished! You can find your transaction here: ${txLink}`);
})();

export const deriveCosmosAddress = (
  chainPrefix: string,
  address: string
): string => {
  return toBech32(chainPrefix, fromBech32(address).data);
};
