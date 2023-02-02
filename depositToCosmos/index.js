import { Squid } from "@0xsquid/sdk";
import { ethers } from "ethers";

// Environment
// add to a file named ".env" to prevent them being uploaded to github
import * as dotenv from "dotenv";
dotenv.config();
const avaxRpcEndpoint = process.env.AVAX_RPC_ENDPOINT;
const privateKey = process.env.PRIVATE_KEY;
const osmosisRecipientAddress = process.env.OSMOSIS_RECIPIENT_ADDRESS;

// addresses and IDs
const avalancheId = 43114;
const osmosisId = "osmosis-1";
const nativeToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const osmosisUsdc = "uusdc";

// amount of AVAX to send (currently 0.05 AVAX)
const amount = "50000000000000000";

const getSDK = () => {
  const squid = new Squid({
    baseUrl: "https://api.squidrouter.com",
  });
  return squid;
};

(async () => {
  // set up your RPC provider and signer
  const provider = new ethers.providers.JsonRpcProvider(avaxRpcEndpoint);
  const signer = new ethers.Wallet(privateKey, provider);

  // instantiate the SDK
  const squid = getSDK();
  // init the SDK
  await squid.init();
  console.log("Squid inited");

  const { route } = await squid.getRoute({
    toAddress: osmosisRecipientAddress,
    fromChain: avalancheId,
    fromToken: nativeToken,
    fromAmount: amount,
    toChain: osmosisId,
    toToken: osmosisUsdc,
    slippage: 1,
  });

  const tx = await squid.executeRoute({
    signer,
    route,
  });

  const txReceipt = await tx.wait();

  const status = await squid.getStatus({
    transactionId: txReceipt.transactionHash
  });

  console.log("Finished! Please check axelarscan for more details: ", status.axelarTransactionUrl);
})();
