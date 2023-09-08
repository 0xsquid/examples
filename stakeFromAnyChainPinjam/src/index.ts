import { Squid } from "@0xsquid/sdk";
import { ethers } from "ethers";

// Environment
// add to a file named ".env" to prevent them being uploaded to github
import * as dotenv from "dotenv";
dotenv.config();
const moonbeamRpcEndpoint = process.env.MOONBEAM_RPC_ENDPOINT;
const privateKey = process.env.PRIVATE_KEY;

// Squid call types for multicall
const SquidCallType = {
  DEFAULT: 0,
  FULL_TOKEN_BALANCE: 1,
  FULL_NATIVE_BALANCE: 2,
  COLLECT_TOKEN_BALANCE: 3,
};

// ABIs
import pinjamStakingPoolAbi from "../abi/pinjamStakingPoolAbi";
import erc20Abi from "../abi/erc20Abi";

// addresses and IDs
const kavaId = 2222;
const moonbeamId = 1284;
const nativeToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const pinjamAxlUsdcPoolAddress = "0x11c3d91259b1c2bd804344355c6a255001f7ba1e"; // same as pAxlUsdcAddress?
const axlUsdcKavaAddress = "0xeb466342c4d449bc9f53a865d5cb90586f405215";
const pAxlUsdcAddress = "0x5c91f5d2b7046a138c7d1775bffea68d5e95d68d"; // not needed, but is the token the user will receive

// amount of GLMR to send (currently 0.01 AVAX)
const amount = "10000000000000000";

const getSDK = () => {
  const squid = new Squid({
    baseUrl: "https://api.squidrouter.com",
  });
  return squid;
};

(async () => {
  // set up your RPC provider and signer
  const provider = new ethers.providers.JsonRpcProvider(moonbeamRpcEndpoint);
  const signer = new ethers.Wallet(privateKey, provider);

  // instantiate the SDK
  const squid = getSDK();
  // init the SDK
  await squid.init();
  console.log("Squid inited");

  // Generate the encoded data for Squid's multicall to stake on Pinjam,
  // crediting deposit to signer's address
  const pinjamStakingPoolInterface = new ethers.utils.Interface(
    pinjamStakingPoolAbi
  );
  const erc20Interface = new ethers.utils.Interface(erc20Abi);

  // calldatas
  const approvePinjamEncodeData = erc20Interface.encodeFunctionData("approve", [
    pinjamAxlUsdcPoolAddress,
    "0",
  ]);

  const depositEncodeData = pinjamStakingPoolInterface.encodeFunctionData(
    "deposit",
    [axlUsdcKavaAddress, "0", signer.address, true]
  );

  // // this step isn't needed for this example,
  // // since paxlUSDC can be minted directly to the signer's account,
  // // no ERC20 transfer to the signer is needed
  // const transferErc20ToSignerEncodeData = erc20Interface.encodeFunctionData(
  //   "transfer",
  //   [signer.address, "0"]
  // );

  const { route } = await squid.getRoute({
    fromAddress: signer.address,
    toAddress: signer.address,
    fromChain: moonbeamId,
    fromToken: nativeToken,
    fromAmount: amount,
    toChain: kavaId,
    toToken: axlUsdcKavaAddress,
    slippage: 1,
    customContractCalls: [
      {
        callType: SquidCallType.FULL_TOKEN_BALANCE,
        target: axlUsdcKavaAddress,
        value: "0", // this will be replaced by the full native balance of the multicall after the swap
        callData: approvePinjamEncodeData,
        payload: {
          tokenAddress: axlUsdcKavaAddress, // unused in callType 2, dummy value
          inputPos: 1, // unused
        },
        estimatedGas: "50000",
      },
      {
        callType: SquidCallType.FULL_TOKEN_BALANCE,
        target: pinjamAxlUsdcPoolAddress,
        value: "0",
        callData: depositEncodeData,
        payload: {
          tokenAddress: axlUsdcKavaAddress,
          inputPos: 1,
        },
        estimatedGas: "250000",
      },
    ],
  });

  console.log("Route: ", route);
  console.log("feeCosts: ", route.estimate.feeCosts);
  console.log("signer address, ", signer.address);
  console.log("signer balance, ", await signer.getBalance());

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
