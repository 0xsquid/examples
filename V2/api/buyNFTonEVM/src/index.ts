import { ethers } from "ethers";
import axios from "axios";
import * as dotenv from "dotenv";
import { Seaport__factory } from "./Seaport__factory";
import { SquidCallType } from "@0xsquid/sdk/dist/types";

// Load environment variables
dotenv.config();

// Environment variables
const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const BASE_RPC_ENDPOINT: string = process.env.BASE_RPC_ENDPOINT!;
const OPENSEA_API_KEY: string = process.env.OPENSEA_API_KEY!;

// Configuration constants
const fromChainId = "8453"; // Base chain ID
const toChainId = "8453"; // Base chain ID (same as fromChainId for same-chain swap)
const fromToken = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
const toToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"; // Native ETH on Base
const nftAddress = "0x42cfd17866eb1c94789d18c6538aaca25a7c95b5"; // NFT contract address
const tokenId = "4039"; // NFT token ID

const seaportAddress = "0x0000000000000068F116a894984e2DB1123eB395";

// Set up provider and signer
const provider = new ethers.providers.JsonRpcProvider(BASE_RPC_ENDPOINT);
const signer = new ethers.Wallet(privateKey, provider);

// Connect to Seaport contract
const seaportContract = Seaport__factory.connect(seaportAddress, signer);

// Function to approve token spending
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

// Function to get route from Squid API
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

// Function to get transaction status from Squid API
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

// Function to get token information from Squid API
const getTokens = async () => {
  try {
    const result = await axios.get('https://apiplus.squidrouter.com/v2/sdk-info', {
      headers: {
        'x-integrator-id': integratorId,
      },
    });
    return result.data.tokens;
  } catch (error) {
    console.error("Error fetching token data:", error);
    return [];
  }
};

// Function to find a specific token in the token list
function findToken(tokens: any[], address: string, chainId: string) {
  if (!Array.isArray(tokens)) {
    console.error("Invalid tokens data structure");
    return null;
  }
  
  return tokens.find(t => 
    t.address.toLowerCase() === address.toLowerCase() && 
    t.chainId === chainId
  );
}

// Function to print token information
function printTokenInfo(token: any) {
  if (token) {
    console.log(`Token on chain ${token.chainId}:`);
    console.log(`  Symbol: ${token.symbol}`);
    console.log(`  Name: ${token.name}`);
    console.log(`  Address: ${token.address}`);
    console.log(`  Decimals: ${token.decimals}`);
  } else {
    console.log(`Token not found`);
  }
}

// Function to calculate the amount of fromToken needed
function calculateFromAmount(openseaValue: string, fromToken: any, toToken: any): string {
  const fromTokenDecimals = fromToken.decimals;
  const toTokenDecimals = toToken.decimals;
  const fromTokenUsdPrice = fromToken.usdPrice;
  const toTokenUsdPrice = toToken.usdPrice;

  const openseaValueBigInt = BigInt(openseaValue);
  const ethToUsdcRate = toTokenUsdPrice / fromTokenUsdPrice;
  const usdcAmount = Number(openseaValueBigInt) / (10 ** toTokenDecimals) * ethToUsdcRate;
  const usdcAmountWithOverestimate = usdcAmount * 1.015;
  const fromAmount = Math.ceil(usdcAmountWithOverestimate * (10 ** fromTokenDecimals)).toString();

  return fromAmount;
}

// Function to get OpenSea fulfillment data
async function getOpenseaFulfillmentData(tokenId: string, collectionAddress: string) {
  const baseUri = "https://api.opensea.io/v2/";
  const chain = 'base';

  try {
    // Get orders from OpenSea API
    const ordersResponse = await axios.get(
      `${baseUri}orders/${chain}/seaport/listings?asset_contract_address=${collectionAddress}&limit=1&token_ids=${tokenId}&order_by=eth_price&order_direction=asc`,
      {
        headers: {
          'X-API-KEY': OPENSEA_API_KEY,
        },
      }
    );

    const orders = ordersResponse.data.orders;
    if (!orders || orders.length === 0) {
      throw new Error("No order found");
    }

    const order = orders[0];

    // Get fulfillment data from OpenSea API
    const fulfillmentResponse = await axios.post(
      `${baseUri}listings/fulfillment_data`,
      {
        listing: {
          hash: order.order_hash,
          chain: chain,
          protocol_address: order.protocol_address,
        },
        fulfiller: {
          address: signer.address,
        },
      },
      {
        headers: {
          'X-API-KEY': OPENSEA_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    const fulfillmentData = fulfillmentResponse.data;
    console.log("OpenSea API Raw Response:", JSON.stringify(fulfillmentData, null, 2));

    // Format the order data
    const openseaOrder = fulfillmentData.fulfillment_data.orders[0];
    const formattedOrder = {
      parameters: {
        ...openseaOrder.parameters,
        offer: openseaOrder.parameters.offer.map(item => ({
          ...item,
          startAmount: item.startAmount.toString(),
          endAmount: item.endAmount.toString()
        })),
        consideration: openseaOrder.parameters.consideration.map(item => ({
          ...item,
          startAmount: item.startAmount.toString(),
          endAmount: item.endAmount.toString()
        }))
      },
      signature: openseaOrder.signature,
      numerator: 1,
      denominator: 1,
      extraData: '0x'
    };

    return {
      formattedOrder,
      value: fulfillmentData.fulfillment_data.transaction.value.toString()
    };
  } catch (error) {
    console.error("Error fetching OpenSea data:", error);
    throw error;
  }
}

// Main execution function
(async () => {
  try {
    console.log("Selected NFT:", `${nftAddress}:${tokenId}`);

    // Fetch token information
    const tokens = await getTokens();

    if (!Array.isArray(tokens)) {
      throw new Error("Unexpected token data structure");
    }

    const fromTokenInfo = findToken(tokens, fromToken, fromChainId);
    const toTokenInfo = findToken(tokens, toToken, toChainId);

    if (!fromTokenInfo || !toTokenInfo) {
      throw new Error("Unable to find token information");
    }

    console.log("From Token:");
    printTokenInfo(fromTokenInfo);

    console.log("\nTo Token:");
    printTokenInfo(toTokenInfo);

    // Fetch OpenSea data
    console.log("Fetching OpenSea data...");
    const openseaData = await getOpenseaFulfillmentData(tokenId, nftAddress);

    const bestSellOrder = openseaData.formattedOrder;
    const openseaValue = openseaData.value;

    console.log("Best sell order formatted:", JSON.stringify(bestSellOrder, null, 2));
    console.log("OpenSea Value:", openseaValue);

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
        bestSellOrder.parameters.conduitKey,
        signer.address // recipient
      ]
    );
    console.log("fulfillAdvancedOrder calldata:", fulfillAdvancedOrderCalldata);

    // Calculate the amount of fromToken needed
    const calculatedFromAmount = calculateFromAmount(openseaValue, fromTokenInfo, toTokenInfo);

    // Prepare parameters for the Squid API route request
    const params = {
      fromAddress: signer.address,
      fromChain: fromChainId,
      fromToken: fromToken,
      fromAmount: calculatedFromAmount,
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
            value: openseaValue,
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

    console.log("Calculated fromAmount:", calculatedFromAmount);
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