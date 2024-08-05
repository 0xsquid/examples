// File: openseaService.ts

import axios from 'axios';
import { ethers } from 'ethers';
import { ReservoirToken, Order, FulfillmentRoot } from './types';

const RESERVOIR_API_KEY = process.env.RESERVOIR_API_KEY || "bd4f6241-b568-5982-9015-a2f80c0feacb";
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY!;

export async function fetchNFTData(nftAddress: string, tokenId: string): Promise<ReservoirToken> {
  const chainName = "arbitrum"; // Adjust this if you're using a different chain
  const reservoirUrl = `https://api-${chainName}.reservoir.tools/tokens/v6?tokens=${nftAddress}:${tokenId}&includeAttributes=false&includeLastSale=false`;
  
  try {
    const response = await axios.get(reservoirUrl, {
      headers: { "x-api-key": RESERVOIR_API_KEY }
    });
    
    if (response.data.tokens && response.data.tokens.length > 0) {
      return response.data.tokens[0];
    } else {
      throw new Error("NFT data not found");
    }
  } catch (error) {
    console.error("Error fetching NFT data:", error);
    throw error;
  }
}

export async function fetchOpenSeaData(nftAddress: string, tokenId: string): Promise<{ order: Order; fulfillment: FulfillmentRoot }> {
  const chainName = "arbitrum"; // Adjust this if you're using a different chain
  const openseaOrderUrl = `https://api.opensea.io/v2/orders/${chainName}/seaport/listings?asset_contract_address=${nftAddress}&token_ids=${tokenId}&order_by=eth_price&order_direction=asc&limit=1`;
  
  try {
    const orderResponse = await axios.get(openseaOrderUrl, {
      headers: { "X-API-KEY": OPENSEA_API_KEY }
    });

    if (!orderResponse.data.orders || orderResponse.data.orders.length === 0) {
      throw new Error("No orders found for this NFT");
    }

    const order: Order = orderResponse.data.orders[0];

    const fulfillmentResponse = await axios.post(
      `https://api.opensea.io/v2/listings/fulfillment_data`,
      {
        listing: {
          hash: order.order_hash,
          chain: chainName,
          protocol_address: order.protocol_address,
        },
        fulfiller: {
          address: ethers.constants.AddressZero, // This will be replaced by the actual buyer address
        },
      },
      {
        headers: {
          "X-API-KEY": OPENSEA_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const fulfillment: FulfillmentRoot = fulfillmentResponse.data;

    return { order, fulfillment };
  } catch (error) {
    console.error("Error fetching OpenSea data:", error);
    throw error;
  }
}