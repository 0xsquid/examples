import { Squid } from "@0xsquid/sdk"
import { ethers } from "ethers"

// Environment
// add to a file named ".env" to prevent them being uploaded to github
import * as dotenv from "dotenv"
dotenv.config()
const avaxRpcEndpoint = "https://avax.meowrpc.com"
const privateKey = process.env.PRIVATE_KEY

import rewardRouterAbi from "../abi/reward-router-abi"

// Squid call types for multicall
const SquidCallType = {
  DEFAULT: 0,
  FULL_TOKEN_BALANCE: 1,
  FULL_NATIVE_BALANCE: 2,
  COLLECT_TOKEN_BALANCE: 3
}

const AVALANCHE_CHAIN_ID = 43114
const KAVA_CHAIN_ID = 2222
const NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
const REWARD_ROUTER_ADDRESS = "0x69bDEEc7d36BBB5Ac08c82eeCa7EfC94275F4D46"

// amount of AVAX to send (currently 0.05 AVAX)
const amount = ethers.utils.parseEther("0.1").toString()

const getSDK = () => {
  const squid = new Squid({
    baseUrl: "https://api.squidrouter.com"
  })
  return squid
}

;(async () => {
  // set up your RPC provider and signer
  const provider = new ethers.providers.JsonRpcProvider(avaxRpcEndpoint)
  const signer = new ethers.Wallet(privateKey, provider)
  console.log("Signer address: ", signer.address)

  // instantiate the SDK
  const squid = getSDK()
  // init the SDK
  await squid.init()
  console.log("Squid inited")

  // Generate the encoded data to approve the Treasure contract to spend Magic
  const rewardRouterContractInterface = new ethers.utils.Interface(
    rewardRouterAbi
  )

  const mintAndStakeEncodedCallData =
    rewardRouterContractInterface.encodeFunctionData("mintAndStakeKlpETH", [
      "0", // minUsdk,
      "622042345987456681" // minKlp
    ])

  const { route } = await squid.getRoute({
    fromAddress: signer.address,
    toAddress: signer.address,

    fromAmount: amount,
    fromChain: AVALANCHE_CHAIN_ID,
    fromToken: NATIVE_TOKEN_ADDRESS,

    toToken: NATIVE_TOKEN_ADDRESS,
    toChain: KAVA_CHAIN_ID,

    slippage: 1,
    customContractCalls: [
      {
        target: REWARD_ROUTER_ADDRESS,
        callData: mintAndStakeEncodedCallData,
        callType: SquidCallType.FULL_NATIVE_BALANCE,
        estimatedGas: "1600000",
        // payload unused in call type 2
        payload: {
          inputPos: 0,
          tokenAddress: "0x"
        },
        value: ethers.utils.parseEther("1").toString()
      }
    ]
  })

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
