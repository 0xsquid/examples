// Import necessary libraries
import { ethers } from 'ethers';
import { Squid } from '@0xsquid/sdk';

// Load environment variables from the .env file
import * as dotenv from 'dotenv';
dotenv.config();

const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const rpcEndpoint: string = process.env.RPC_ENDPOINT!;
const radiantLendingPoolAddress = process.env.RADIANT_LENDING_POOL_ADDRESS!;
const usdcArbitrumAddress = process.env.USDC_ARBITRUM_ADDRESS!;

// Define chain and token addresses
const polygonId = '137'; // Polygon
const arbitrumId = '42161'; // Arbitrum
const nativeToken = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'; // Define departing token

// Define amount to be sent
const amount = '10000000000000000';

// Import Radiant lending pool ABI
import radiantLendingPoolAbi from '../abi/radiantLendingPoolAbi';

// Function to get Squid SDK instance
const getSDK = (): Squid => {
	const squid = new Squid({
		baseUrl: 'https://v2.api.squidrouter.com',
		integratorId: integratorId,
	});
	return squid;
};

// Main function
(async () => {
	// Set up JSON RPC provider and signer for source chain (Ethereum)
	const provider = new ethers.providers.JsonRpcProvider(rpcEndpoint);
	const signer = new ethers.Wallet(privateKey, provider);

	// Initialize Squid SDK
	const squid = getSDK();
	await squid.init();
	console.log('Initialized Squid SDK');

	// Create contract interface and encode deposit function for Radiant lending pool
	const radiantLendingPoolInterface = new ethers.utils.Interface(radiantLendingPoolAbi);
	const depositEncodedData = radiantLendingPoolInterface.encodeFunctionData('deposit', [
		usdcArbitrumAddress,
		'0', // Placeholder for dynamic balance
		signer.address,
		0,
	]);

	// Set up parameters for swapping tokens and depositing into Radiant lending pool
	const params = {
		fromAddress: signer.address,
		fromChain: polygonId,
		fromToken: nativeToken,
		fromAmount: amount,
		toChain: arbitrumId,
		toToken: usdcArbitrumAddress,
		toAddress: signer.address,
		slippage: 1,
		slippageConfig: {
			autoMode: 1,
		},
		enableBoost: true,
		quoteOnly: false,
		// Customize contract call for depositing on Arbitrum
		postHooks: [
			{
				callType: 1, // SquidCallType.FULL_TOKEN_BALANCE
				target: radiantLendingPoolAddress,
				value: '0',
				callData: depositEncodedData,
				payload: {
					tokenAddress: usdcArbitrumAddress,
					inputPos: 1,
				},
				estimatedGas: '50000',
			},
		],
	};

	console.log('Parameters:', params);

	// Get the swap route using Squid SDK
	const { route, requestId } = await squid.getRoute(params);
	console.log('Calculated route:', route.estimate.toAmount);

	// Execute the swap and deposit transaction
	const tx = (await squid.executeRoute({ signer, route })) as unknown as ethers.providers.TransactionResponse;
	const txReceipt = await tx.wait();

	// Show the transaction receipt with Axelarscan link
	const axelarScanLink = 'https://axelarscan.io/gmp/' + txReceipt.transactionHash;
	console.log(`Finished! Check Axelarscan for details: ${axelarScanLink}`);

	// Display the API call link to track transaction status
	console.log(
		`Track status via API call: https://api.squidrouter.com/v1/status?transactionId=${txReceipt.transactionHash}`
	);

	// Wait a few seconds before checking the status
	await new Promise((resolve) => setTimeout(resolve, 5000));

	// Retrieve the transaction's route status
	const getStatusParams = {
		transactionId: txReceipt.transactionHash,
		requestId: requestId,
		fromChainId: polygonId,
		toChainId: arbitrumId,
	};
	const status = await squid.getStatus(getStatusParams);

	// Display the route status
	console.log(`Route status: ${JSON.stringify(status)}`);
})();
