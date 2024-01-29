// Import necessary libraries
import { ethers } from 'ethers';
import { Squid } from '@0xsquid/sdk';
import { Hook, ChainType } from '@0xsquid/squid-types';

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

	// Create a postHook object of type Hook
	// This object customizes the post-hook contract call on the destination chain
	const postHook: Hook = {
		chainType: ChainType.EVM, // Chain type for the Hook - EVM or COSMOS
		fundAmount: amountToSwap, // The amount of tokens that will be used as fund
		fundToken: nativeToken, // The token that will be used as fund
		calls: [
			{
				chainType: ChainType.EVM, // Call chain type - EVM or COSMOS
				callType: 1, // SquidCallType.FULL_TOKEN_BALANCE
				target: stakingContractAddress, // Address of the contract that will be called
				value: '0', // Amount of ETH to be sent with the call
				callData: delegateEncodedData, // Contract function call data
				payload: {
					tokenAddress: nativeToken, // Address of the native token to be used in the payload
					inputPos: 1, // Position of the input token in the route
				},
				estimatedGas: '150000', // Estimated gas to be used for the call
			},
		],
	};

	// Set up parameters for a route between source and destination chains
	// Customize the route to swap tokens on the destination chain
	const params = {
		fromAddress: signer.address, // The address that will initiate the route call
		fromChain: ethereumId, // The ID of the source chain
		fromToken: ethereumUsdc, // The source token address
		fromAmount: amountToSwap, // The amount of the source token to be sent
		toChain: fantomId, // The ID of the destination chain
		toToken: nativeToken, // The destination token address
		toAddress: signer.address, // The address that will receive the swapped tokens in the destination chain
		slippage: 1, // Slippage tolerance in percentage
		slippageConfig: {
			autoMode: 1,
		},
		enableBoost: true, // Enable by default on all chains except Ethereum
		quoteOnly: false, // Set to true for returning the route without executing it
		postHook: postHook, // Attach the previously created post-hook object
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
