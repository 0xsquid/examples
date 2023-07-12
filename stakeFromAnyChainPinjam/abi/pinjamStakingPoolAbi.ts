const pinjamStakingPoolAbi = [
  {
    inputs: [
      {
        internalType: "address",
        name: "_underlyingAsset",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "_to",
        type: "address",
      },
      {
        internalType: "bool",
        name: "_depositToVault",
        type: "bool",
      },
    ],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_underlyingAsset",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "_to",
        type: "address",
      },
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_underlyingAsset",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "_onBehalfOf",
        type: "address",
      },
    ],
    name: "borrow",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_underlyingAsset",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "_to",
        type: "address",
      },
    ],
    name: "repay",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_user",
        type: "address",
      },
    ],
    name: "getUserData",
    outputs: [
      {
        internalType: "uint256",
        name: "healthFactor",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "totalCollateralInBaseCurrency",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "totalDebtInBaseCurrency",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "avgLtv",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "avgLiquiditationThreshold",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

export default pinjamStakingPoolAbi;
