import { Squid } from "@0xsquid/sdk"
import { ethers } from "ethers"
import erc721DropAbi from "../abi/erc721DropAbi"

// Environment
// add to a file named ".env" to prevent them being uploaded to github
import * as dotenv from "dotenv"
dotenv.config()

const privateKey = process.env.PRIVATE_KEY

// Squid call types for multicall
const SquidCallType = {
  DEFAULT: 0,
  FULL_TOKEN_BALANCE: 1,
  FULL_NATIVE_BALANCE: 2,
  COLLECT_TOKEN_BALANCE: 3
}

// addresses and IDs
const POLYGON_CHAIN_ID = 137
const nativeToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
const BASE_CHAIN_ID = 8453

const amount = ethers.utils.parseUnits("3", 18).toString()
const BASE_RPC_URL = "https://mainnet.base.org"
const POLYGON_RPC_URL = "https://polygon-rpc.com"
const baseDayOneContractAddress = "0x7d5861cfe1c74aaa0999b7e2651bf2ebd2a62d89"
const TOTAL_REWARD_PER_MINT = ethers.utils.parseEther("0.000777")

const getSDK = () => {
  const squid = new Squid({
    baseUrl: "https://api.squidrouter.com"
  })
  return squid
}

;(async () => {
  // set up your RPC provider and signer
  const provider = new ethers.providers.JsonRpcProvider(POLYGON_RPC_URL)
  const signer = new ethers.Wallet(privateKey, provider)

  console.log("Signer address: ", signer.address)

  // instantiate the SDK
  const squid = getSDK()
  // init the SDK
  await squid.init()
  console.log("Squid initialized")

  const baseDayOneInterface = new ethers.utils.Interface(erc721DropAbi)

  const recipient = signer.address // Address to receive the NFT
  const nftsQuantity = 1 // Number of NFTs to mint
  const comment = ""
  const mintReferral = "0x9652721d02b9db43f4311102820158abb4ecc95b" // Mint referral address

  const mintWithRewardsEncodedData = baseDayOneInterface.encodeFunctionData(
    "mintWithRewards",
    [recipient, nftsQuantity, comment, mintReferral]
  )

  const { route } = await squid.getRoute({
    toAddress: signer.address,
    fromChain: POLYGON_CHAIN_ID,
    fromToken: nativeToken,
    fromAmount: amount,
    toChain: BASE_CHAIN_ID,
    toToken: nativeToken,
    slippage: 1,
    customContractCalls: [
      {
        callData: mintWithRewardsEncodedData,
        callType: SquidCallType.DEFAULT,
        estimatedGas: "250000",
        target: baseDayOneContractAddress,
        value: TOTAL_REWARD_PER_MINT.mul(nftsQuantity).toString(),
        payload: {
          inputPos: 0, // unused in call type 0
          tokenAddress: "0x"
        }
      }
    ]
  })

  console.log({ "route.estimate.gasCosts": route.estimate.gasCosts })

  const tx = (await squid.executeRoute({
    signer,
    route
  })) as ethers.providers.TransactionResponse
  const txReceipt = await tx.wait()

  const axelarScanLink =
    "https://axelarscan.io/gmp/" + txReceipt.transactionHash
  console.log(
    "Finished! Please check Axelarscan for more details: ",
    axelarScanLink,
    "\n"
  )

  console.log(
    "Track status via API call to: https://api.squidrouter.com/v1/status?transactionId=" +
      txReceipt.transactionHash,
    "\n"
  )

  // It's best to wait a few seconds before checking the status
  await new Promise(resolve => setTimeout(resolve, 5000))

  const status = await squid.getStatus({
    transactionId: txReceipt.transactionHash
  })

  console.log("Status: ", status)
})()
