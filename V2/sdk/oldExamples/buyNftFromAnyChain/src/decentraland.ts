import { Squid } from "@0xsquid/sdk";
import { ChainType, SquidCallType } from "@0xsquid/sdk/dist/types";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import decentralandBuyAbi from "../abi/decentralandAbi";
import erc20Abi from "../abi/erc20Abi";
import { erc721Abi } from "../abi/erc721Abi";
dotenv.config();

const config = {
  polygonChainId: "137",
  MANAPolygon: "0xa1c57f48f0deb89f569dfbe6e2b7f46d33606fd4", // ERC20 to buy NFTs with
  decentralandBuyAddress: "0x480a0f4e360E8964e68858Dd231c2922f1df45Ef", // Decentraland contract to buy NFTs (listing, not minting)
  squidMulticall: "0xd9b7849d3a49e287c8E448cea0aAe852861C4545", // Squid calling contract
  avalancheId: "43114",
  nativeToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",

  // Here you need to set the amount of AVAX you want to spend for the transaction
  // We suggest to send a bit more than the amount expected
  // The last step of customContractCalls is sending the remaining MANA token back to the user on destination chain anyway
  // This is to prevent the transaction from failing due to insufficient funds
  fromAmount: "1428590000000000",

  // You can get the token infos here:
  // https://market.decentraland.org/contracts/0x26ea2f6a7273a2f28b410406d1c13ff7d4c9a162/tokens/105312291668557186697918027683670432318895095400549111254310978010
  item: {
    price: "40000000000000000", // The NFT Price in wei
    collectionAddress: "0x26EA2F6a7273A2F28b410406D1C13FF7d4c9A162",
    tokenId:
      "105312291668557186697918027683670432318895095400549111254310978136",
  },

  // Ethers Interfaces
  erc20ContractInterface: new ethers.Interface(erc20Abi),
  erc721Interface: new ethers.Interface(erc721Abi),
  decentralandBuyInterface: new ethers.Interface(decentralandBuyAbi),
};

let squid: Squid;

const getSquidSDK = async () => {
  const squid = new Squid({
    baseUrl: "https://api.squidrouter.com",
    integratorId: process.env.INTEGRATOR_ID!,
  });
  await squid.init();
  return squid;
};

const getRoute = async (userAddress: string) => {
  return squid.getRoute({
    fromAmount: config.fromAmount,
    fromToken: config.nativeToken,
    fromChain: config.avalancheId,
    toToken: config.MANAPolygon,
    toChain: config.polygonChainId,
    toAddress: config.decentralandBuyAddress,
    postHook: {
      chainType: ChainType.EVM,
      fundAmount: "0",
      fundToken: "0x",
      calls: [
        // ===================================
        // Approve MANA to be spent by Decentraland contract
        // ===================================
        {
          chainType: ChainType.EVM,
          callType: SquidCallType.FULL_TOKEN_BALANCE,
          target: config.MANAPolygon,
          value: "0",
          callData: config.erc20ContractInterface.encodeFunctionData(
            "approve",
            [config.decentralandBuyAddress, config.item.price]
          ),
          payload: {
            tokenAddress: config.MANAPolygon,
            inputPos: 1,
          },
          estimatedGas: "50000",
        },
        // ===================================
        // EXECUTE ORDER
        // ===================================
        {
          chainType: ChainType.EVM,
          callType: SquidCallType.DEFAULT,
          target: config.decentralandBuyAddress,
          value: "0",
          callData: config.decentralandBuyInterface.encodeFunctionData(
            "executeOrder",
            [
              config.item.collectionAddress,
              config.item.tokenId,
              config.item.price,
            ]
          ),

          payload: {
            tokenAddress: "0x",
            inputPos: 0,
          },
          estimatedGas: "300000",
        },
        // ===================================
        // Transfer NFT to buyer
        // ===================================
        {
          chainType: ChainType.EVM,
          callType: SquidCallType.DEFAULT,
          target: config.item.collectionAddress,
          value: "0",
          callData: config.erc721Interface.encodeFunctionData(
            "safeTransferFrom(address, address, uint256)",
            [config.squidMulticall, userAddress, config.item.tokenId]
          ),
          payload: {
            tokenAddress: "0x",
            inputPos: 1,
          },
          estimatedGas: "50000",
        },
        // ===================================
        // Transfer remaining MANA to buyer
        // ===================================
        {
          chainType: ChainType.EVM,
          callType: SquidCallType.FULL_TOKEN_BALANCE,
          target: config.MANAPolygon,
          value: "0",
          callData: config.erc20ContractInterface.encodeFunctionData(
            "transfer",
            [userAddress, "0"]
          ),
          payload: {
            tokenAddress: config.MANAPolygon,

            // This will replace the parameter at index 1 in the encoded Function,
            //  with FULL_TOKEN_BALANCE (instead of "0")
            inputPos: 1,
          },
          estimatedGas: "50000",
        },
      ],
    },
  });
};

/**
 * Classic getting signer using Ethers and private key
 * Used by the Squid SDK to sign transactions
 * @returns
 */
const getSigner = () => {
  // set up your RPC provider and signer
  const provider = new ethers.JsonRpcProvider(process.env.AVAX_RPC_ENDPOINT);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  return signer;
};

const init = async () => {
  // Step 1: Init Squid SDK
  console.log("Initializing Squid SDK...");
  squid = await getSquidSDK();

  // Step 2: Get Signer
  console.log("Getting signer...");
  const signer = getSigner();

  // Step 3: Get Route
  console.log("Getting route...");
  const { route, requestId } = await getRoute(signer.address);

  // Execute the swap transaction
  const tx = (await squid.executeRoute({
    signer,
    route,
  })) as unknown as ethers.TransactionResponse;
  const txReceipt = await tx.wait();

  // Step 5: With hash, you can check the transaction on the blockchain & Axelarscan
  const axelarScanUrl = `https://axelarscan.io/gmp/${tx.transactionHash}`;
  console.log("Follow your transaction here: ", axelarScanUrl);

  // Show the transaction receipt with Axelarscan link
  const axelarScanLink = "https://axelarscan.io/gmp/" + txReceipt.hash;
  console.log(`Finished! Check Axelarscan for details: ${axelarScanLink}`);

  // Wait a few seconds before checking the status
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Retrieve the transaction's route status
  const getStatusParams = {
    transactionId: txReceipt.hash,
    requestId: requestId,
    fromChainId: config.avalancheId,
    toChainId: config.polygonChainId,
  };
  const status = await squid.getStatus(getStatusParams);

  // Display the route status
  console.log(`Route status: ${status.squidTransactionStatus}`);
};

init();
