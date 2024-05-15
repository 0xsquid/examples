import { Squid } from "@0xsquid/sdk";
import { ethers } from "ethers";

// Environment
// add to a file named ".env" to prevent them being uploaded to github
import * as dotenv from "dotenv";
dotenv.config();
const bnbRpcEndpoint = process.env.BNB_RPC_ENDPOINT;
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
import sommAbi from "../abi/sommAbi";

// addresses and IDs
const bnbId = 56;
const arbitrumChainId = 42161;
const nativeToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const usdcArbitrum = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const sommVaultAddress = "0x392b1e6905bb8449d26af701cdea6ff47bf6e5a8";

// amount of BNB to send (currently 0.0001 BNB)
const amount = "100000000000000";

const getSDK = () => {
  const squid = new Squid({
    baseUrl: "https://api.squidrouter.com",
  });
  return squid;
};

(async () => {
  // set up your RPC provider and signer
  const provider = new ethers.providers.JsonRpcProvider(bnbRpcEndpoint);
  const signer = new ethers.Wallet(privateKey, provider);

  // instantiate the SDK
  const squid = getSDK();
  // init the SDK
  await squid.init();
  console.log("Squid inited");

  // Generate calldatas for postHooks
  const erc20Interface = new ethers.utils.Interface(erc20Abi);
  const approveSommEncodeData = erc20Interface.encodeFunctionData("approve", [
    sommVaultAddress,
    "0", // will be overridden by the full token balance of the multicall after the swap
  ]);

  // Generate the encoded data for Squid's multicall to stake on Pinjam,
  // crediting deposit to signer's address
  const sommInterface = new ethers.utils.Interface(sommAbi);
  const depositEncodeData = sommInterface.encodeFunctionData("deposit", [
    "0", // will be overridden by the full token balance of the multicall after the swap
    signer.address,
  ]);

  // // this step isn't needed for this example,
  // // since RYUSD can be minted directly to the signer's account,
  // // no ERC20 transfer to the signer is needed
  // const transferErc20ToSignerEncodeData = erc20Interface.encodeFunctionData(
  //   "transfer",
  //   [signer.address, "0"]
  // );

  const { route } = await squid.getRoute({
    toAddress: signer.address,
    fromChain: bnbId,
    fromToken: nativeToken,
    fromAmount: amount,
    toChain: arbitrumChainId,
    toToken: usdcArbitrum,
    slippage: 1,
    customContractCalls: [
      {
        callType: SquidCallType.FULL_TOKEN_BALANCE,
        target: usdcArbitrum,
        value: "0",
        callData: approveSommEncodeData,
        payload: {
          tokenAddress: usdcArbitrum,
          inputPos: 1, // the position of the "amount" parameter in the approve function
        },
        estimatedGas: "150000",
      },
      {
        callType: SquidCallType.FULL_TOKEN_BALANCE,
        target: sommVaultAddress,
        value: "0",
        callData: depositEncodeData,
        payload: {
          tokenAddress: usdcArbitrum,
          inputPos: 0, // the position of the "assets" parameter in the deposit function
        },
        estimatedGas: "2000000", // overestimate, can be reduced to optimise
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
})();
