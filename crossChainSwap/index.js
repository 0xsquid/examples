import { Squid } from "@0xsquid/sdk";
import { ethers } from "ethers";

// Environment
// add to a file named ".env" to prevent them being uploaded to github
import * as dotenv from "dotenv";
dotenv.config();
const avaxRpcEndpoint = process.env.AVAX_RPC_ENDPOINT;
const privateKey = process.env.PRIVATE_KEY;

// addresses and IDs
const avalancheId = 43114;
const polygonChainId = 137;
const nativeToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const polygonUsdc = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

// amount of AVAX to send (currently 0.01 AVAX (~$0.10))
const amount = "10000000000000000";

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
    toAddress: signer.address,
    fromChain: avalancheId,
    fromToken: nativeToken,
    fromAmount: amount,
    toChain: polygonChainId,
    toToken: polygonUsdc,
    slippage: 1,
    customContractCalls: [],
  });

  const tx = await squid.executeRoute({
    signer,
    route,
  });
  const txReceipt = await tx.wait();

  const axelarScanLink = "https://axelarscan.io/gmp/" + txReceipt.transactionHash;
  console.log("Finished! Please check Axelarscan for more details: ", axelarScanLink, "\n");

  console.log("Track status at: https://api.squidrouter.com/v1/status?transactionId=" + txReceipt.transactionHash, "\n");
  
  // It's best to wait a few seconds before checking the status
  // const status = await squid.getStatus({
  //   transactionId: txReceipt.transactionHash
  // });

  // console.log("Status: ", status);
})();
