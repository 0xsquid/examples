import { Squid } from "@0xsquid/sdk";
import { SigningStargateClient, DeliverTxResponse } from "@cosmjs/stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { fromBech32, toBech32 } from "@cosmjs/encoding";

// Environment
// add to a file named ".env" to prevent them being uploaded to github
import * as dotenv from "dotenv";
dotenv.config();

const mnemonic = process.env.MNEMONIC;
const osmosisRpc = process.env.OSMOSIS_RPC_ENDPOINT;
const evmToAddress = process.env.EVM_RECEIVER_ADDRESS;

// addresses and IDs
const osmosisChainId = "osmosis-1";
const uosmoAddress = "uosmo";
const avalancheChainId = 43114;
const nativeAvax = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

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
    cosmosSignerAddress: signerAddress,
    toChain: avalancheChainId,
    toToken: nativeAvax,
    toAddress: evmToAddress,
    slippage: 3.0,
  };

  const { route } = await squid.getRoute(params);

  const txInfo = (await squid.executeRoute({
    signer,
    signerAddress,
    route,
  })) as DeliverTxResponse;

  const txLink = `https://www.mintscan.io/osmosis/txs/${txInfo.transactionHash}`;
  console.log(`Finished! You can find your transaction here: ${txLink}`);
  console.log(
    `Also track whole tx flow via Axelar Scan - https://axelarscan.io/gmp/${txInfo.transactionHash}`
  );
})();

export const deriveCosmosAddress = (
  chainPrefix: string,
  address: string
): string => {
  return toBech32(chainPrefix, fromBech32(address).data);
};
