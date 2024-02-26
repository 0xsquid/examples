import { Squid } from "@0xsquid/sdk";
import { ethers } from "ethers";

// Environment
// add to a file named ".env" to prevent them being uploaded to github
import * as dotenv from "dotenv";
dotenv.config();
const avaxRpcEndpoint = process.env.AVAX_RPC_ENDPOINT;
const privateKey = process.env.PRIVATE_KEY;

// ABIs
import erc1155Abi from "../abi/erc1155Abi";
import erc20Abi from "../abi/erc20Abi";
import treasureMarketplaceAbi from "../abi/treasureMarketplaceAbi";

// Squid call types for multicall
const SquidCallType = {
  DEFAULT: 0,
  FULL_TOKEN_BALANCE: 1,
  FULL_NATIVE_BALANCE: 2,
  COLLECT_TOKEN_BALANCE: 3,
};

// addresses and IDs
const avalancheId = 43114;
const arbitrumId = 42161;
const nativeToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const squidMulticall = "0xd9b7849d3a49e287c8E448cea0aAe852861C4545";
const magicToken = "0x539bdE0d7Dbd336b79148AA742883198BBF60342";
const treasureAddress = "0x09986b4e255b3c548041a30a2ee312fe176731c2"; // treasure contract
const moonrockNftAddress = "0xc5295c6a183f29b7c962df076819d44e0076860e";
const moonrockOwner = "0xa5c53eb116EC0CE355D8be38b0EB424ce520A4db";

// amount of AVAX to send (currently 0.05 AVAX)
const amount = "30000000000000000";

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
  console.log("Signer address: ", signer.address);

  // instantiate the SDK
  const squid = getSDK();
  // init the SDK
  await squid.init();
  console.log("Squid inited");

  // Generate the encoded data to approve the Treasure contract to spend Magic
  const erc20ContractInterface = new ethers.utils.Interface(erc20Abi);
  const approveEncodeData = erc20ContractInterface.encodeFunctionData(
    "approve",
    [treasureAddress, "0"]
  );

  // Generate the encoded data to buy the NFT on Treasure
  // This example buys a MoonRock NFT on Treasure on mainnet
  // https://trove.treasure.lol/collection/smol-treasures/1
  const treasureMarketplaceInterface = new ethers.utils.Interface(
    treasureMarketplaceAbi
  );
  const _buyItemParams = {
    nftAddress: moonrockNftAddress,
    tokenId: 1,
    owner: moonrockOwner,
    quantity: 1,
    maxPricePerItem: "990000000000000000",
    paymentToken: magicToken,
    usinEth: false,
  };
  const buyMoonRockNftEncodeData =
    treasureMarketplaceInterface.encodeFunctionData("buyItems", [
      [_buyItemParams],
    ]);

  // Generate the encoded data to transfer the NFT to signer's address
  const erc1155Interface = new ethers.utils.Interface(erc1155Abi);
  const transferNftEncodeData = erc1155Interface.encodeFunctionData(
    "safeTransferFrom",
    [squidMulticall, signer.address, 1, 1, 0x00]
  );

  // Generate the encoded data to send any remaining Magic back to signer's address
  const transferMagicEncodeData = erc20ContractInterface.encodeFunctionData(
    "transfer",
    [signer.address, "0"]
  );

  const { route } = await squid.getRoute({
    toAddress: signer.address,
    fromChain: avalancheId,
    fromToken: nativeToken,
    fromAmount: amount,
    toChain: arbitrumId,
    toToken: magicToken,
    slippage: 1,
    // enableExpress: false, // default is true on all chains except Ethereum
    customContractCalls: [
      {
        callType: SquidCallType.FULL_TOKEN_BALANCE,
        target: magicToken,
        value: "0",
        callData: approveEncodeData,
        payload: {
          tokenAddress: magicToken,
          inputPos: 1,
        },
        estimatedGas: "50000",
      },
      {
        callType: SquidCallType.DEFAULT,
        target: treasureAddress,
        value: "0",
        callData: buyMoonRockNftEncodeData,
        payload: {
          tokenAddress: "1",
          inputPos: 1,
        },
        estimatedGas: "80000",
      },
      {
        callType: SquidCallType.DEFAULT,
        target: moonrockNftAddress,
        value: "0",
        callData: transferNftEncodeData,
        payload: {
          tokenAddress: "0x",
          inputPos: 1,
        },
        estimatedGas: "50000",
      },
      {
        callType: SquidCallType.FULL_TOKEN_BALANCE, // transfer any remaining MAGIC to the user's account
        target: magicToken,
        value: "0",
        callData: transferMagicEncodeData,
        payload: {
          tokenAddress: magicToken,
          inputPos: 1,
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
