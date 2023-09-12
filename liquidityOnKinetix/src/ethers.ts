import { ethers } from "ethers"
import rewardRouterAbi from "../abi/reward-router-abi"
import * as dotenv from "dotenv"

dotenv.config()
// add your private key to `.env.local`
const privateKey = process.env.PRIVATE_KEY

const REWARD_ROUTER_ADDRESS = "0x69bDEEc7d36BBB5Ac08c82eeCa7EfC94275F4D46"
const KAVA_RPC_URL = "https://kava-evm.publicnode.com"

async function mintAndStake() {
  const provider = new ethers.providers.JsonRpcProvider(KAVA_RPC_URL)
  const wallet = new ethers.Wallet(privateKey, provider)
  const rewardRouterInterface = new ethers.utils.Interface(rewardRouterAbi)
  const rewardRouterContract = new ethers.Contract(
    REWARD_ROUTER_ADDRESS,
    rewardRouterInterface,
    wallet
  )

  const weiAmount = ethers.utils.parseEther("1")

  try {
    const tx = await rewardRouterContract.mintAndStakeKlpETH(
      "0",
      "622042345987456681",
      {
        gasLimit: 1_600_000,
        value: weiAmount
      }
    )

    await tx.wait()

    console.log({ tx })
    console.log(`Success! Tx hash: ${tx.hash}`)
  } catch (error) {
    console.error("There was an error :(")
    console.log({ error })
  }
}

mintAndStake()
