import { Squid } from "@0xsquid/sdk";
import { ethers } from "ethers";

// Environment
// add to a file named ".env" to prevent them being uploaded to github
import * as dotenv from "dotenv";
dotenv.config();
const avaxRpcEndpoint = process.env.AVAX_RPC_ENDPOINT;
const privateKey = process.env.PRIVATE_KEY;

// ABIs
import moonwellGlmrAbi from "./abi/moonwellGlmrAbi.json" assert { type: "json" };

// addresses and IDs
const avalancheId = 43114;
const moonbeamId = 1284;
const nativeToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const moonwellGlmrAddress = "0x091608f4e4a15335145be0A279483C0f8E4c7955";

// amount of AVAX to send (currently 0.05 AVAX)
const amount = "50000000000000000";

// Get calldata from moonwell

const getSDK = () => {
  const squid = new Squid({
    baseUrl: "https://api.0xsquid.com",
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

  // Generate the encoded data for Squid's multicall to stake on Moonwell and transfer to signer
  const moonwellGlmrInterface = new ethers.utils.Interface(moonwellGlmrAbi);
  const mintEncodeData = moonwellGlmrInterface.encodeFunctionData("mint");
  const transferMglmrEncodeData = moonwellGlmrInterface.encodeFunctionData("transfer", [signer.address, "0"]);

  const { route } = await squid.getRoute({
    toAddress: signer.address,
    fromChain: avalancheId,
    fromToken: nativeToken,
    fromAmount: amount,
    toChain: moonbeamId,
    toToken: nativeToken,
    slippage: 1,
    customContractCalls: [
      {
        callType: 2,
        target: moonwellGlmrAddress,
        value: "0",
        callData: mintEncodeData,
        payload: {
          tokenAddress: "0x", // unused in callType 2, dummy value
          inputPos: 1, // unused
        },
        estimatedGas: "250000",
      },
      {
        callType: 1,
        target: moonwellGlmrAddress,
        value: "0",
        callData: transferMglmrEncodeData,
        payload: {
          tokenAddress: moonwellGlmrAddress,
          inputPos: 1, // use full balance of tokenAddress at position 1 (second argument)
        },
        estimatedGas: "50000",
      },
    ],
  });

  const tx = await squid.executeRoute({
    signer,
    route,
  });
  const txReceipt = await tx.wait();

  const axelarScanLink = "https://axelarscan.io/gmp/" + txReceipt.transactionHash;
  console.log("Finished! Please check axelarscan for more details: ", axelarScanLink);
})();
