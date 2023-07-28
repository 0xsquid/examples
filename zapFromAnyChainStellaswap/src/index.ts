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
import erc20Abi from "../abi/erc20Abi";
import wglmrUsdcLpZapAbi from "../abi/wglmrUsdcLpZapAbi";

// addresses and IDs
const avalancheId = 43114;
const moonbeamId = 1284;
const nativeToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

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
  console.log("signer.address: ", signer.address);

  // instantiate the SDK
  const squid = getSDK();
  // init the SDK
  await squid.init();
  console.log("Squid inited");

  // Generate the encoded data for Squid's multicall to zapIn and then transfer to signer
  const glmrUsdcZapInterface = new ethers.utils.Interface(wglmrUsdcLpZapAbi);
  const zapInEncodeData = glmrUsdcZapInterface.encodeFunctionData("zapIn", [
    "0x8CCBbcAF58f5422F6efD4034d8E8a3c9120ADf79",
  ]);

  const erc20Interface = new ethers.utils.Interface(erc20Abi);
  const transferErc20EncodeData = erc20Interface.encodeFunctionData(
    "transfer",
    [signer.address, "0"]
  );

  const wglmrUsdcLpZapAddress = "0xee7516ad6bc30aacf3cb6bde345b401d5e0603e8";
  const wglmrUsdcLpAddress = "0x8CCBbcAF58f5422F6efD4034d8E8a3c9120ADf79";

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
        callType: SquidCallType.FULL_NATIVE_BALANCE,
        target: wglmrUsdcLpZapAddress,
        value: "0", // this will be replaced by the full native balance of the multicall after the swap
        callData: zapInEncodeData,
        payload: {
          tokenAddress: "0x", // unused in callType 2, dummy value
          inputPos: 4, // unused
        },
        estimatedGas: "300000",
      },
      {
        callType: SquidCallType.FULL_TOKEN_BALANCE,
        target: wglmrUsdcLpAddress,
        value: "0",
        callData: transferErc20EncodeData,
        payload: {
          tokenAddress: wglmrUsdcLpAddress,
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
