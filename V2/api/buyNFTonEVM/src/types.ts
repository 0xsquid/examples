import { SquidCallType } from "@0xsquid/sdk/dist/types";

export interface FulfillmentRoot {
  fulfillment_data: {
    transaction: {
      input_data: {
        parameters: string;
      };
      to: string;
      value: string;
      data: string;
    };
    orders: Array<{
      parameters: OrderParameters;
      signature: string;
    }>;
  };
}

export interface Order {
  order_hash: string;
  protocol_address: string;
  protocol_data: {
    parameters: OrderParameters;
  };
  current_price: string;
}

interface OrderParameters {
  offerer: string;
  zone: string;
  offer: Array<{
    itemType: number;
    token: string;
    identifierOrCriteria: string;
    startAmount: string;
    endAmount: string;
  }>;
  consideration: Array<{
    itemType: number;
    token: string;
    identifierOrCriteria: string;
    startAmount: string;
    endAmount: string;
    recipient: string;
  }>;
  orderType: number;
  startTime: string;
  endTime: string;
  zoneHash: string;
  salt: string;
  conduitKey: string;
  totalOriginalConsiderationItems: number;
}

export interface BuyableItem {
  name: string;
  description: string;
  price: string;
  image: string;
  contract: string;
  platformName: string;
  tokenId: string;
  collectionAddress: string;
  platformData: Order;
  nbOfItems: number;
  payment: {
    type: number;
    token: {
      symbol: string;
      chainId: number;
      address: string;
      decimals: number;
    };
  };
}

export interface ReservoirToken {
  token: {
    contract: string;
    tokenId: string;
    name?: string;
    image?: string;
  };
  market?: {
    floorAsk?: {
      price?: {
        amount?: {
          decimal?: string;
        };
      };
    };
  };
}

export interface CheckoutConfig {
  item: {
    title: string;
    subTitle?: string;
    imageUrl?: string;
  };
  payment: {
    nbOfItems: number;
    token: {
      chainId: number;
      address: string;
      symbol: string;
    };
    unitPrice: string;
  };
  customContractCalls: Array<{
    callType: SquidCallType;
    target: string;
    value: string;
    callData: string;
    payload: {
      tokenAddress: string;
      inputPos: number;
    };
    estimatedGas: string;
  }>;
}