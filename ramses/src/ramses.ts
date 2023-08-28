import { ethers } from "ethers"
import WSTETH_ETH_POOL_ABI from "../abi/wstETHETHPoolAbi"
import erc20Abi from "../abi/erc20Abi"
import * as dotenv from "dotenv"

dotenv.config()

const privateKey = process.env.PRIVATE_KEY
const ARBITRUM_RPC_URL = "https://arbitrum.meowrpc.com"
const WSTETH_ETH_POOL_ADDRESS = "0x9A32549Df3fF3C1fD725F81093c47445218De723"
const amount = ethers.utils.parseUnits("100", 18) // 100 RAM = ~1 USD
const RAM_TOKEN_ADDRESS = "0xAAA6C1E32C55A7Bfa8066A6FAE9b42650F262418"

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(ARBITRUM_RPC_URL)

  const wallet = new ethers.Wallet(privateKey, provider)

  const wstETHETHPoolContract = new ethers.Contract(
    WSTETH_ETH_POOL_ADDRESS,
    WSTETH_ETH_POOL_ABI,
    wallet
  )

  try {
    // approve
    const ramContract = new ethers.Contract(RAM_TOKEN_ADDRESS, erc20Abi, wallet)

    const approveTx = await ramContract.approve(
      WSTETH_ETH_POOL_ADDRESS,
      amount,
      {
        gasLimit: 1100_000,
        gasPrice: ethers.utils.parseUnits("10", "gwei")
      }
    )

    await approveTx.wait()

    console.log({ approveTx })

    // bribe
    const tx = await wstETHETHPoolContract.bribe(RAM_TOKEN_ADDRESS, amount, {
      gasLimit: 1100_000,
      gasPrice: ethers.utils.parseUnits("10", "gwei")
    })

    await tx.wait()

    console.log({ tx })

    console.log(`Success! https://arbiscan.io/tx/${tx.hash}`)
  } catch (error) {
    console.log({ error })
  }
}

main()
