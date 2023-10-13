require('dotenv').config();
require('@nomiclabs/hardhat-ethers');
require('@nomiclabs/hardhat-web3');
require('@nomiclabs/hardhat-etherscan');
require('hardhat-contract-sizer');

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const API_KEY = process.env.API_KEY;
const RPC_KEY = process.env.RPC_KEY;

module.exports = {
	networks: {
		localhost: {
			url: 'http://127.0.0.1:8545',
		},
		testnet: {
			url: `https://polygon-mumbai.infura.io/v3/${RPC_KEY}`,
			chainId: 80001,
			accounts: [`0x${PRIVATE_KEY}`],
		},
	},
	etherscan: {
		apiKey: {
			polygonMumbai: API_KEY,
		},
	},
	contractSizer: {
		runOnCompile: true,
	},
	mocha: {},
	abiExporter: {
		path: './build/contracts',
		clear: true,
		flat: true,
		spacing: 2,
	},
	solidity: {
		version: '0.8.17',
		settings: {
			optimizer: {
				enabled: true,
				runs: 200,
			},
		},
	},
	gasReporter: {
		currency: 'USD',
		enabled: true,
		gasPrice: 50,
	},
};
