import { Squid } from "@0xsquid/sdk";
import { ethers } from "ethers";

// Environment
// add to a file named ".env" to prevent them being uploaded to github
import * as dotenv from "dotenv";
dotenv.config();
const avaxRpcEndpoint = process.env.AVAX_RPC_ENDPOINT;
const privateKey = process.env.PRIVATE_KEY;

// Squid call types for multicall
const SquidCallType = {
  DEFAULT: 0,
  FULL_TOKEN_BALANCE: 1,
  FULL_NATIVE_BALANCE: 2,
  COLLECT_TOKEN_BALANCE: 3,
};

// ABIs
import moonwellGlmrAbi from "../abi/moonwellGlmrAbi";

// addresses and IDs
const avalancheId = 43114;
const moonbeamId = 1284;
const nativeToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const moonwellGlmrAddress = "0x091608f4e4a15335145be0A279483C0f8E4c7955";

// amount of AVAX to send (currently 0.01 AVAX)
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

  // Generate the encoded data for Squid's multicall to stake on Moonwell and transfer to signer
  const moonwellGlmrInterface = new ethers.utils.Interface(moonwellGlmrAbi);
  const mintEncodeData = moonwellGlmrInterface.encodeFunctionData("mint");
  const transferMglmrEncodeData = moonwellGlmrInterface.encodeFunctionData(
    "transfer",
    [signer.address, "0"]
  );

  const { route } = await squid.getRoute({
    toAddress: signer.address,
    fromChain: avalancheId,
    fromToken: nativeToken,
    fromAmount: amount,
    toChain: moonbeamId,
    toToken: nativeToken,
    slippage: 1,
    // enableExpress: false, // default is true on all chains except Ethereum
    customContractCalls: [
      {
        callType: SquidCallType.FULL_NATIVE_BALANCE,
        target: moonwellGlmrAddress,
        value: "0", // this will be replaced by the full native balance of the multicall after the swap
        callData: mintEncodeData,
        payload: {
          tokenAddress: "0x", // unused in callType 2, dummy value
          inputPos: 1, // unused
        },
        estimatedGas: "250000",
      },
      {
        callType: SquidCallType.FULL_TOKEN_BALANCE,
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

  const tx = (await squid.executeRoute({
    signer,
    route,
  })) as ethers.providers.TransactionResponse;

  const txReceipt = await tx.wait();

  const axelarScanLink =
    "https://axelarscan.io/gmp/" + txReceipt.transactionHash;

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

  // It's best to wait a few seconds before checking the status
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const status = await squid.getStatus({
    transactionId: txReceipt.transactionHash,
  });

  console.log("Status: ", status);
})();
