// Import required libraries and types
import { ethers } from "ethers";
import axios from "axios";
import * as dotenv from "dotenv";
import { Seaport__factory } from "./Seaport__factory";
import { SquidCallType } from "@0xsquid/sdk/dist/types";

// Load environment variables from .env file
dotenv.config();

// Load sensitive data from environment variables
const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const BASE_RPC_ENDPOINT: string = process.env.BASE_RPC_ENDPOINT!;

// Rarible API configuration
const RARIBLE_API_KEY: string = "a8c97705-cab8-473e-a3cb-aff5d43a090f";
const RARIBLE_API_URL: string = "https://api.rarible.org/v0.1";

// Define chain and token addresses
const fromChainId = "8453"; // Base chain ID
const toChainId = "8453"; // Base chain ID (same as fromChainId for same-chain swap)
const fromToken = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
const toToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"; // Native ETH on Base

// Seaport contract address on Base
const seaportAddress = "0x0000000000000068F116a894984e2DB1123eB395";

// Set up JSON RPC provider and signer
const provider = new ethers.providers.JsonRpcProvider(BASE_RPC_ENDPOINT);
const signer = new ethers.Wallet(privateKey, provider);

// Connect to the Seaport contract
const seaportContract = Seaport__factory.connect(seaportAddress, signer);

/**
 * Approves token spending for a given address
 * @param transactionRequestTarget Address to approve spending for
 * @param fromToken Token address to spend
 * @param fromAmount Amount to approve
 */
const approveSpending = async (transactionRequestTarget: string, fromToken: string, fromAmount: string) => {
  const erc20Abi = [
    "function approve(address spender, uint256 amount) public returns (bool)"
  ];
  const tokenContract = new ethers.Contract(fromToken, erc20Abi, signer);
  try {
    const tx = await tokenContract.approve(transactionRequestTarget, fromAmount);
    await tx.wait();
    console.log(`Approved ${fromAmount} tokens for ${transactionRequestTarget}`);
  } catch (error) {
    console.error('Approval failed:', error);
    throw error;
  }
};

/*
 * Gets route from Squid API
 * @param params Route parameters
 * @returns Route data and request ID
 */
const getRoute = async (params: any) => {
  try {
    const result = await axios.post(
      "https://apiplus.squidrouter.com/v2/route",
      params,
      {
        headers: {
          "x-integrator-id": integratorId,
          "Content-Type": "application/json",
        },
      }
    );
    const requestId = result.headers["x-request-id"];
    return { data: result.data, requestId: requestId };
  } catch (error) {
    console.error("API error:", error.response?.data);
    console.error("Error with parameters:", params);
    throw error;
  }
};

/*
 * Gets status of a transaction from Squid API
 * @param params Status request parameters
 * @returns Transaction status
 */
const getStatus = async (params: any) => {
  try {
    const result = await axios.get("https://apiplus.squidrouter.com/v2/status", {
      params: {
        transactionId: params.transactionId,
        requestId: params.requestId,
        fromChainId: params.fromChainId,
        toChainId: params.toChainId,
      },
      headers: {
        "x-integrator-id": integratorId,
      },
    });
    return result.data;
  } catch (error) {
    console.error("API error:", error.response?.data);
    console.error("Error with parameters:", params);
    throw error;
  }
};

/*
 * Fetches NFT data from Rarible API
 * @param itemId NFT item ID
 * @returns NFT data
 */
const fetchNFTData = async (itemId: string) => {
  try {
    const response = await axios.get(`${RARIBLE_API_URL}/items/${itemId}`, {
      headers: { "X-API-KEY": RARIBLE_API_KEY }
    });
    return response.data;
  } catch (error) {
    console.error("Error fetching NFT data:", error);
    throw error;
  }
};

/*
 * Gets and formats the best sell order for an NFT
 * @param nftData NFT data from Rarible
 * @returns Formatted sell order
 */
const getBestSellOrder = async (nftData: any) => {
  if (nftData.bestSellOrder) {
    console.log("Best sell order:", JSON.stringify(nftData.bestSellOrder, null, 2));
    const order = nftData.bestSellOrder;

    // Helper function to convert itemType string to number
    const getItemType = (type: string) => {
      switch (type) {
        case "NATIVE":
        case "ETH":
          return 0;
        case "ERC20":
          return 1;
        case "ERC721":
          return 2;
        case "ERC1155":
          return 3;
        default:
          throw new Error(`Unknown item type: ${type}`);
      }
    };

    // Helper function to convert orderType string to number
    const getOrderType = (type: string) => {
      switch (type) {
        case "FULL_OPEN":
          return 0;
        case "PARTIAL_OPEN":
          return 1;
        case "FULL_RESTRICTED":
          return 2;
        case "PARTIAL_RESTRICTED":
          return 3;
        default:
          return 0; // Default to FULL_OPEN if unknown
      }
    };

    // Format offer and consideration arrays
    const formatItem = (item: any, isConsideration = false) => {
      console.log("Formatting item:", JSON.stringify(item, null, 2));
      
      if (!item || typeof item !== 'object') {
        throw new Error(`Invalid item: ${JSON.stringify(item)}`);
      }

      const itemType = isConsideration ? item.itemType : (item.type && item.type['@type']);
      if (!itemType) {
        throw new Error(`Missing itemType for item: ${JSON.stringify(item)}`);
      }

      return {
        itemType: getItemType(itemType),
        token: (item.token || item.type?.contract || '').split(':').pop() || ethers.constants.AddressZero,
        identifierOrCriteria: item.identifierOrCriteria || item.type?.tokenId || '0',
        startAmount: item.startAmount || item.value || '0',
        endAmount: item.endAmount || item.value || '0',
        ...(isConsideration && { recipient: (item.recipient || '').split(':').pop() || ethers.constants.AddressZero })
      };
    };

    const offer = order.make ? [formatItem(order.make)] : [];
    const consideration = (order.data.consideration || []).map((item: any) => formatItem(item, true));

    console.log("Formatted offer:", JSON.stringify(offer, null, 2));
    console.log("Formatted consideration:", JSON.stringify(consideration, null, 2));

    // Handle signature (can be blank for some order types)
    let signature = order.signature || '0x';
    if (signature === '0x' && order.data && order.data.signature) {
      signature = order.data.signature;
    }

    // Handle conduitKey (use the one provided in the order if available)
    const conduitKey = order.data.conduitKey || ethers.constants.HashZero;

    const formattedOrder = {
      parameters: {
        offerer: order.maker.split(':').pop() || ethers.constants.AddressZero,
        zone: (order.data.zone || '').split(':').pop() || ethers.constants.AddressZero,
        offer: offer,
        consideration: consideration,
        orderType: getOrderType(order.data.orderType),
        startTime: Math.floor(new Date(order.startedAt).getTime() / 1000),
        endTime: Math.floor(new Date(order.endedAt).getTime() / 1000),
        zoneHash: order.data.zoneHash || ethers.constants.HashZero,
        salt: order.salt,
        conduitKey: conduitKey,
        totalOriginalConsiderationItems: consideration.length,
      },
      numerator: 1,
      denominator: 1,
      signature: signature,
      extraData: '0x'
    };

    console.log("Formatted order:", JSON.stringify(formattedOrder, null, 2));
    return formattedOrder;
  } else {
    throw new Error("No active sell orders found for this item");
  }
};

// Main function to set up and execute the NFT purchase
(async () => {
  try {
    // Define NFT details
    const nftAddress = "0x206571b68c66e1d112b74d65695043ad2b5f95d5";
    const tokenId = "8";
    const itemId = `BASE:${nftAddress}:${tokenId}`;

    console.log("Selected NFT:", itemId);

    // Fetch NFT data from Rarible
    const nftData = await fetchNFTData(itemId);
    console.log("NFT data:", JSON.stringify(nftData, null, 2));

    // Get the best sell order for the NFT
    const bestSellOrder = await getBestSellOrder(nftData);
    console.log("Best sell order formatted:", JSON.stringify(bestSellOrder, null, 2));

    // Encode the fulfillAdvancedOrder function call
    const fulfillAdvancedOrderCalldata = seaportContract.interface.encodeFunctionData(
      "fulfillAdvancedOrder",
      [
        {
          parameters: bestSellOrder.parameters,
          numerator: bestSellOrder.numerator,
          denominator: bestSellOrder.denominator,
          signature: bestSellOrder.signature,
          extraData: bestSellOrder.extraData,
        },
        [], // criteriaResolvers (empty for basic orders)
        bestSellOrder.parameters.conduitKey, // Use the conduitKey from the order
        signer.address // recipient
      ]
    );
    console.log("fulfillAdvancedOrder calldata:", fulfillAdvancedOrderCalldata);

    // Calculate the total consideration amount
    const totalConsiderationAmount = bestSellOrder.parameters.consideration.reduce((total, item) => {
      return total.add(ethers.BigNumber.from(item.startAmount));
    }, ethers.BigNumber.from(0));

    // Prepare parameters for the Squid API route
    const params = {
      fromAddress: signer.address,
      fromChain: fromChainId,
      fromToken: fromToken,
      fromAmount: '240000', // TODO: Use totalConsiderationAmount.toString() in production
      toChain: toChainId,
      toToken: toToken,
      toAddress: signer.address,
      enableExpress: true,
      postHook: {
        chainType: "evm",
        calls: [
          {
            callType: SquidCallType.DEFAULT,
            target: seaportAddress,
            value: '56000000000000', // TODO: Use totalConsiderationAmount.toString() in production
            callData: fulfillAdvancedOrderCalldata,
            payload: {
              tokenAddress: toToken,
              inputPos: 1
            },
            estimatedGas: "2000000",
            chainType: "evm",
          },
        ],
        provider: "OpenSea",
        description: "Purchase NFT on Base via OpenSea",
        logoURI: "https://opensea.io/static/images/logos/opensea.svg",
      },
    };

    console.log("Parameters:", params);
    console.log("PostHook:", JSON.stringify(params.postHook, null, 2));

    // Get the swap route using Squid API
    const routeResult = await getRoute(params);
    const route = routeResult.data.route;
    const requestId = routeResult.requestId;
    console.log("Calculated route:", route);
    console.log("requestId:", requestId);

    const transactionRequest = route.transactionRequest;

    // Approve the transactionRequest.target to spend fromAmount of fromToken
    await approveSpending(transactionRequest.target, fromToken, params.fromAmount);

    // Execute the swap and NFT purchase transaction
    const tx = await signer.sendTransaction({
      to: transactionRequest.target,
      data: transactionRequest.data,
      value: transactionRequest.value,    
      gasPrice: await provider.getGasPrice(),
      gasLimit: ethers.BigNumber.from(transactionRequest.gasLimit).mul(15).div(10), // Increase gas limit by 50%
    });

    const txReceipt = await tx.wait();
    console.log("Transaction Hash: ", txReceipt.transactionHash);

    // Show the transaction receipt with Basescan link
    const basescanLink = "https://basescan.org/tx/" + txReceipt.transactionHash;
    console.log(`Finished! Check Basescan for details: ${basescanLink}`);

    // Function to check and update transaction status
    const updateTransactionStatus = async (txHash: string, requestId: string) => {
      const getStatusParams = {
        transactionId: txHash,
        requestId: requestId,
        fromChainId: fromChainId,
        toChainId: toChainId,
        gasPrice: transactionRequest.gasPrice,
      };

      let status;
      const completedStatuses = ["success", "partial_success", "needs_gas", "not_found"];
      const maxRetries = 15;
      let retryCount = 0;

      do {
        try {
          status = await getStatus(getStatusParams);
          console.log(`Route status: ${status.squidTransactionStatus}`);
        } catch (error) {
          if (error.response && error.response.status === 404) {
            retryCount++;
            if (retryCount >= maxRetries) {
              console.error("Max retries reached. Transaction not found.");
              break;
            }
            console.log("Transaction not found. Retrying...");
            await new Promise((resolve) => setTimeout(resolve, 20000));
            continue;
          } else {
            throw error;
          }
        }

        if (!completedStatuses.includes(status.squidTransactionStatus)) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      } while (!completedStatuses.includes(status.squidTransactionStatus));
    };

    // Update transaction status until it completes
    await updateTransactionStatus(txReceipt.transactionHash, requestId);
  } catch (error) {
    console.error("An error occurred:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
  }
})();