import { ethers } from "ethers";
import { Squid, TokenData } from "@0xsquid/sdk";

// Environment
// add to a file named ".env" to prevent them being uploaded to github
import * as dotenv from "dotenv";
dotenv.config();
const avaxRpcEndpoint = process.env.AVAX_RPC_ENDPOINT;
const privateKey = process.env.PRIVATE_KEY;

// addresses and IDs
const avalancheId = 43114;
const nativeToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// amount of AVAX to send (currently 0.01 AVAX (~$0.10))
const amount = "10000000000000000";

const getSDK = () => {
  const squid = new Squid({
    baseUrl: "https://squid-api-git-feat-cosmos-maintestnet-0xsquid.vercel.app",
    integratorId: "your-integrator-id", // get at https://l19g3aali76.typeform.com/integrator-id
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

  // to get the token Osmo on Osmosis chain on testnet
  const fromToken = squid.tokens.find(
    (t) =>
      t.symbol.toLocaleLowerCase() === "osmo" && t.chainId === "osmo-test-5"
  );

  const params = {
    fromChain: 43113, // Avalanche Fuji Tesntet
    fromToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // AVAX on Avalanche
    fromAmount: "100000000000000000", // 0.1 AVAX
    toChain: "osmo-test-5", // Osmosis Testnet
    toToken:
      "ibc/40F1B2458AEDA66431F9D44F48413240B8D28C072463E2BF53655728683583E3", // nUSDC on Osmosis
    toAddress: "osmo16xz3ujtdszrqzzjqpx79wuxya3w27jn9khnumm", // the recipient of the tokens on Osmosis
    slippage: 1.0, // 1.00 = 1% max slippage across the entire route
    fromAddress: signer.address, // Fallback address for the EVM Side
    quoteOnly: false, // optional, defaults to false, if true there are less params required by the api, but no tx object is returned
  };

  const { route } = await squid.getRoute(params);

  console.log(route.estimate.route.toChain);

  const tx = (await squid.executeRoute({
    signer,
    route,
  })) as ethers.providers.TransactionResponse;
  const txReceipt = await tx.wait();

  const axelarScanLink =
    "https://testnet.axelarscan.io/gmp/" + txReceipt.transactionHash;
  console.log(
    "Finished! Please check Axelarscan for more details: ",
    axelarScanLink,
    "\n"
  );

  // console.log(
  //   "Track status via API call to: https://api.squidrouter.com/v1/status?transactionId=" +
  //     txReceipt.transactionHash,
  //   "\n"
  // );

  // // It's best to wait a few seconds before checking the status
  // await new Promise((resolve) => setTimeout(resolve, 5000));

  // const status = await squid.getStatus({
  //   transactionId: txReceipt.transactionHash,
  // });

  // console.log("Status: ", status);
})();
