const rewardRouterABI = [
  {
    type: "constructor",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "_weth", internalType: "address" },
      { type: "address", name: "_klp", internalType: "address" },
      { type: "address", name: "_vault", internalType: "address" },
      { type: "address", name: "_feeKlpTracker", internalType: "address" },
      { type: "address", name: "_klpManager", internalType: "address" }
    ]
  },
  {
    type: "event",
    name: "StakeKlp",
    inputs: [
      {
        type: "address",
        name: "account",
        internalType: "address",
        indexed: true
      },
      {
        type: "uint256",
        name: "amount",
        internalType: "uint256",
        indexed: false
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "StakeMigration",
    inputs: [
      {
        type: "address",
        name: "account",
        internalType: "address",
        indexed: true
      },
      {
        type: "uint256",
        name: "amount",
        internalType: "uint256",
        indexed: false
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "UnstakeKlp",
    inputs: [
      {
        type: "address",
        name: "account",
        internalType: "address",
        indexed: true
      },
      {
        type: "uint256",
        name: "amount",
        internalType: "uint256",
        indexed: false
      }
    ],
    anonymous: false
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    outputs: [],
    name: "acceptTransfer",
    inputs: [{ type: "address", name: "_sender", internalType: "address" }]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    outputs: [],
    name: "claim",
    inputs: [
      { type: "address", name: "_rewardToken", internalType: "address" },
      { type: "bool", name: "_shouldAddIntoKLP", internalType: "bool" },
      { type: "bool", name: "withdrawEth", internalType: "bool" }
    ]
  },
  {
    type: "function",
    stateMutability: "view",
    outputs: [{ type: "address", name: "", internalType: "address" }],
    name: "feeKlpTracker",
    inputs: []
  },
  {
    type: "function",
    stateMutability: "view",
    outputs: [{ type: "address", name: "", internalType: "address" }],
    name: "gov",
    inputs: []
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    outputs: [],
    name: "handleRewards",
    inputs: [
      { type: "bool", name: "_shouldConvertWethToEth", internalType: "bool" },
      { type: "bool", name: "_shouldAddIntoKLP", internalType: "bool" }
    ]
  },
  {
    type: "function",
    stateMutability: "view",
    outputs: [{ type: "address", name: "", internalType: "address" }],
    name: "klp",
    inputs: []
  },
  {
    type: "function",
    stateMutability: "view",
    outputs: [{ type: "address", name: "", internalType: "address" }],
    name: "klpManager",
    inputs: []
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    outputs: [{ type: "uint256", name: "", internalType: "uint256" }],
    name: "mintAndStakeKlp",
    inputs: [
      { type: "address", name: "_token", internalType: "address" },
      { type: "uint256", name: "_amount", internalType: "uint256" },
      { type: "uint256", name: "_minUsdk", internalType: "uint256" },
      { type: "uint256", name: "_minKlp", internalType: "uint256" }
    ]
  },
  {
    type: "function",
    stateMutability: "payable",
    outputs: [{ type: "uint256", name: "", internalType: "uint256" }],
    name: "mintAndStakeKlpETH",
    inputs: [
      { type: "uint256", name: "_minUsdk", internalType: "uint256" },
      { type: "uint256", name: "_minKlp", internalType: "uint256" }
    ]
  },
  {
    type: "function",
    stateMutability: "view",
    outputs: [{ type: "address", name: "", internalType: "address" }],
    name: "pendingReceivers",
    inputs: [{ type: "address", name: "", internalType: "address" }]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    outputs: [],
    name: "setGov",
    inputs: [{ type: "address", name: "_gov", internalType: "address" }]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    outputs: [],
    name: "signalTransfer",
    inputs: [{ type: "address", name: "_receiver", internalType: "address" }]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    outputs: [{ type: "uint256", name: "", internalType: "uint256" }],
    name: "unstakeAndRedeemKlp",
    inputs: [
      { type: "address", name: "_tokenOut", internalType: "address" },
      { type: "uint256", name: "_klpAmount", internalType: "uint256" },
      { type: "uint256", name: "_minOut", internalType: "uint256" },
      { type: "address", name: "_receiver", internalType: "address" }
    ]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    outputs: [{ type: "uint256", name: "", internalType: "uint256" }],
    name: "unstakeAndRedeemKlpETH",
    inputs: [
      { type: "uint256", name: "_klpAmount", internalType: "uint256" },
      { type: "uint256", name: "_minOut", internalType: "uint256" },
      { type: "address", name: "_receiver", internalType: "address payable" }
    ]
  },
  {
    type: "function",
    stateMutability: "view",
    outputs: [{ type: "address", name: "", internalType: "contract IVault" }],
    name: "vault",
    inputs: []
  },
  {
    type: "function",
    stateMutability: "view",
    outputs: [{ type: "address", name: "", internalType: "address" }],
    name: "weth",
    inputs: []
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    outputs: [],
    name: "withdrawToken",
    inputs: [
      { type: "address", name: "_token", internalType: "address" },
      { type: "address", name: "_account", internalType: "address" },
      { type: "uint256", name: "_amount", internalType: "uint256" }
    ]
  },
  { type: "receive", stateMutability: "payable" }
]

export default rewardRouterABI
