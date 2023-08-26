import { ethers } from "ethers"
import WSTETH_ETH_POOL_ABI from "../abi/wstETHETHPoolAbi"
import erc20Abi from "../abi/erc20Abi"
import * as dotenv from "dotenv"

dotenv.config()

const privateKey = process.env.PRIVATE_KEY
const ARBITRUM_RPC_URL = "https://arbitrum.meowrpc.com"
const WSTETH_ETH_POOL_ADDRESS = "0x9A32549Df3fF3C1fD725F81093c47445218De723"
const USDC_ARBITRUM_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
const amount = ethers.utils.parseUnits("0.4", 6)

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
    const usdcContract = new ethers.Contract(
      USDC_ARBITRUM_ADDRESS,
      erc20Abi,
      wallet
    )

    const approveTx = await usdcContract.approve(
      WSTETH_ETH_POOL_ADDRESS,
      amount,
      {
        gasLimit: 700000,
        gasPrice: ethers.utils.parseUnits("10", "gwei")
      }
    )

    await approveTx.wait()

    console.log({ approveTx })

    // bribe
    const tx = await wstETHETHPoolContract.bribe(
      USDC_ARBITRUM_ADDRESS,
      amount,
      {
        gasLimit: 700000,
        gasPrice: ethers.utils.parseUnits("10", "gwei")
      }
    )

    console.log({ tx })
    await tx.wait()

    console.log({ tx })

    console.log("NFT minted successfully:", tx.hash)
  } catch (error) {
    console.error("Error minting NFT")
    console.log({ error })
  }
}

main()
