import { Squid } from "@0xsquid/sdk";
import { ethers } from "ethers";

// Environment
// add to a file named ".env" to prevent them being uploaded to github
import * as dotenv from "dotenv";
dotenv.config()
const avaxRpcEndpoint = process.env.AVAX_RPC_ENDPOINT;
const privateKey = process.env.PRIVATE_KEY;

// Squid call types for multicall
const SquidCallType = {
  "DEFAULT": 0,
  "FULL_TOKEN_BALANCE": 1,
  "FULL_NATIVE_BALANCE": 2,
  "COLLECT_TOKEN_BALANCE": 3
}

// ABIs
import erc20Abi from "./abi/erc20.json" assert { type: "json" };

// addresses and IDs
const avalancheId = 43114;
const polygonId = 137;
const nativeToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const polygonUsdc = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

// amount of AVAX to send (currently 0.1 AVAX)
const amount = "100000000000000000";

// address of portal router contract
const portalPolygonCurveAxlUsdc = "0xab9e491ba682bb256ae31841641b0835fab75e08";

// Get calldata from Portal
const calldataPortalPolygonCurveAxlUsdcIn =
  "0xe6baeb7a0000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa8417400000000000000000000000000000000000000000000000000000000000f42400000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa84174000000000000000000000000fba3b7bb043415035220b1c44fb47564346393920000000000000000000000000000000000000000000000000c5c6b20c5c7292f00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000120000000000000000000000000508ee1b661c7dee089a5b5c3fd234f1058f03c380000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000fba3b7bb043415035220b1c44fb4756434639392000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000";

const usdcContractInterface = new ethers.utils.Interface(erc20Abi);
const approveEncodeData = usdcContractInterface.encodeFunctionData("approve", [portalPolygonCurveAxlUsdc, "0"]);

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
    toChain: polygonId,
    toToken: polygonUsdc,
    slippage: 1,
    customContractCalls: [
      {
        callType: SquidCallType.FULL_TOKEN_BALANCE,
        target: polygonUsdc,
        value: "0",
        callData: approveEncodeData,
        payload: {
          tokenAddress: polygonUsdc,
          inputPos: 1,
        },
        estimatedGas: "40000",
      },
      {
        callType: SquidCallType.FULL_TOKEN_BALANCE,
        target: portalPolygonCurveAxlUsdc,
        value: "0",
        callData: calldataPortalPolygonCurveAxlUsdcIn,
        payload: {
          tokenAddress: polygonUsdc,
          inputPos: 1,
        },
        estimatedGas: "150000",
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
