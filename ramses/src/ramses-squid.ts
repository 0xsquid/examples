import { Squid } from "@0xsquid/sdk"
import { ethers } from "ethers"
import WSTETH_ETH_POOL_ABI from "../abi/wstETHETHPoolAbi"

// Environment
// add to a file named ".env" to prevent them being uploaded to github
import * as dotenv from "dotenv"
import erc20Abi from "../abi/erc20Abi"
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
const ARBITRUM_CHAIN_ID = 42161
const AVALANCHE_CHAIN_ID = 43114

const fromAmount = ethers.utils.parseUnits("0.1", 18).toString()

const AVALANCHE_RPC_URL = "https://avalanche-c-chain.publicnode.com"
const WSTETH_ETH_POOL_ADDRESS = "0x9A32549Df3fF3C1fD725F81093c47445218De723"
const RAM_TOKEN_ADDRESS = "0xAAA6C1E32C55A7Bfa8066A6FAE9b42650F262418"
const NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"

const getSDK = () => {
  const squid = new Squid({
    baseUrl: "https://api.squidrouter.com"
  })
  return squid
}

;(async () => {
  // set up your RPC provider and signer
  const provider = new ethers.providers.JsonRpcProvider(AVALANCHE_RPC_URL)
  const signer = new ethers.Wallet(privateKey, provider)

  console.log("Signer address: ", signer.address)

  // instantiate the SDK
  const squid = getSDK()
  // init the SDK
  await squid.init()
  console.log("Squid initialized")

  const ramContractInterface = new ethers.utils.Interface(erc20Abi)

  const approveEncodedData = ramContractInterface.encodeFunctionData(
    "approve",
    [WSTETH_ETH_POOL_ADDRESS, "0"]
  )

  const wstETHETHPoolContractInterface = new ethers.utils.Interface(
    WSTETH_ETH_POOL_ABI
  )

  const bribeEncodedData = wstETHETHPoolContractInterface.encodeFunctionData(
    "bribe",
    [RAM_TOKEN_ADDRESS, 0]
  )

  const { route } = await squid.getRoute({
    toAddress: signer.address,
    fromChain: AVALANCHE_CHAIN_ID,
    fromToken: NATIVE_TOKEN_ADDRESS,
    fromAmount,
    toChain: ARBITRUM_CHAIN_ID,
    toToken: RAM_TOKEN_ADDRESS,
    slippage: 1,
    customContractCalls: [
      {
        callData: approveEncodedData,
        callType: SquidCallType.FULL_TOKEN_BALANCE,
        estimatedGas: "1000000",
        target: RAM_TOKEN_ADDRESS,
        payload: {
          inputPos: 1,
          tokenAddress: RAM_TOKEN_ADDRESS
        },
        value: "0"
      },
      {
        callData: bribeEncodedData,
        callType: SquidCallType.FULL_TOKEN_BALANCE,
        estimatedGas: "1000000",
        target: WSTETH_ETH_POOL_ADDRESS,
        value: "0",
        payload: {
          inputPos: 1,
          tokenAddress: RAM_TOKEN_ADDRESS
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
