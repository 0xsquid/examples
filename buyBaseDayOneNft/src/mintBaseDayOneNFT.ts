import { ethers } from "ethers"
import baseDayOneContractAbi from "../abi/erc721DropAbi"
import * as dotenv from "dotenv"

dotenv.config()

const privateKey = process.env.PRIVATE_KEY
const BASE_RPC_URL = "https://mainnet.base.org"
const baseDayOneContractAddress = "0x7d5861cfe1c74aaa0999b7e2651bf2ebd2a62d89"

async function mintNFT() {
  const provider = new ethers.providers.JsonRpcProvider(BASE_RPC_URL)

  const wallet = new ethers.Wallet(privateKey, provider)

  const baseDayOneContract = new ethers.Contract(
    baseDayOneContractAddress,
    baseDayOneContractAbi,
    wallet
  )

  const recipient = wallet.address // Address to receive the NFT
  const nftsQuantity = 1 // Number of NFTs to mint
  const comment = ""
  const mintReferral = "0x9652721d02b9db43f4311102820158abb4ecc95b" // Mint referral address

  try {
    const tx = await baseDayOneContract.mintWithRewards(
      recipient,
      nftsQuantity,
      comment,
      mintReferral,
      {
        gasLimit: 100000,
        gasPrice: ethers.utils.parseUnits("10", "gwei")
      }
    )

    await tx.wait()

    console.log({ tx })
    console.log("NFT minted successfully:", tx.hash)
  } catch (error) {
    console.error("Error minting NFT")
    console.log({ error })
  }
}

mintNFT()
