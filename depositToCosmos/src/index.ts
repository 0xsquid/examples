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

// amount of AVAX to send (currently 0.1 AVAX)
const amount = "100000000000000000";

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
    fromAddress: signer.address,
    toAddress: osmosisRecipientAddress,
    fromChain: avalancheId,
    fromToken: nativeToken,
    fromAmount: amount,
    toChain: osmosisId,
    toToken: osmosisUsdc,
    slippage: 1,
  });

  console.log(
    "Cross chain fee costs for this route: ",
    route.estimate.feeCosts
  );

  const tx = (await squid.executeRoute({
    signer,
    route,
  })) as ethers.providers.TransactionResponse;

  const txReceipt = await tx.wait();

  const axelarScanLink =
    "https://axelarscan.io/transfer/" + txReceipt.transactionHash;

  console.log(
    "Finished! Please check Axelarscan for more details: ",
    axelarScanLink,
    "\n"
  );

  console.log(
    "Track status via API call to: https://api.squidrouter.com/v1/status?transactionId=" +
      txReceipt.transactionHash,
    "\n"
  );

  // // It's best to wait a few seconds before checking the status
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const status = await squid.getStatus({
    transactionId: txReceipt.transactionHash,
  });

  console.log("Status: ", status);
})();
