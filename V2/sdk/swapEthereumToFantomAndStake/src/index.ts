// Import necessary libraries
import { ethers } from 'ethers';
import { Squid } from '@0xsquid/sdk';

// Load environment variables from .env file
import * as dotenv from 'dotenv';
dotenv.config();

const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const ethereumRpcEndpoint: string = process.env.ETHEREUM_RPC_ENDPOINT!;
const stakingContractAddress: string = process.env.STAKING_CONTRACT_ADDRESS!;

// Define chain and token addresses
const ethereumId = '1'; // Ethereum
const fantomId = '250'; // Fantom
const nativeToken = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const ethereumUsdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

// Define amount to swap and stake
const amountToSwap = '10000000000000000';

// Import staking contract ABI
import stakingContractAbi from '../abi/fantomSFC';

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
	// Set up JSON RPC provider and signer
	const provider = new ethers.providers.JsonRpcProvider(ethereumRpcEndpoint);
	const signer = new ethers.Wallet(privateKey, provider);

	// Initialize Squid SDK
	const squid = getSDK();
	await squid.init();
	console.log('Initialized Squid SDK');

	// Create contract interface and encode delegate (Fantom staking) function
	const stakingContractInterface = new ethers.utils.Interface(stakingContractAbi);
	const delegateEncodedData = stakingContractInterface.encodeFunctionData('delegate', [amountToSwap]);

	// Set up parameters for swapping tokens and staking
	const params = {
		fromAddress: signer.address,
		fromChain: ethereumId,
		fromToken: ethereumUsdc,
		fromAmount: amountToSwap,
		toChain: fantomId,
		toToken: nativeToken,
		toAddress: signer.address,
		slippage: 1,
		slippageConfig: {
			autoMode: 1,
		},
		enableBoost: true,
		quoteOnly: false,
		// Customize contract call for staking on Fantom
		postHooks: [
			{
				callType: 1, // SquidCallType.FULL_TOKEN_BALANCE
				target: stakingContractAddress,
				value: '0',
				callData: delegateEncodedData,
				payload: {
					tokenAddress: ethereumUsdc,
					inputPos: 0,
				},
				estimatedGas: '50000',
			},
		],
	};

	console.log('Parameters:', params);

	// Get the swap route using Squid SDK
	const { route, requestId } = await squid.getRoute(params);
	console.log('Calculated route:', route.estimate.toAmount);
	console.log('Calculated fee costs: ', route.estimate.feeCosts);

	// Execute the swap and staking transaction
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
		fromChainId: ethereumId,
		toChainId: fantomId,
	};
	const status = await squid.getStatus(getStatusParams);

	// Display the route status
	console.log(`Route status: ${JSON.stringify(status)}`);
})();
