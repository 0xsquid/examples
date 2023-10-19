// Import necessary libraries
import { ethers } from 'ethers';
import { Squid } from '@0xsquid/sdk';
import { Hook, ChainType } from '@0xsquid/squid-types';

// Load environment variables from the .env file
import * as dotenv from 'dotenv';
dotenv.config();

const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const rpcEndpoint: string = process.env.RPC_ENDPOINT!;
const nftContractAddress: string = process.env.NFT_CONTRACT_ADDRESS!;

// Define chain and token addresses
const fromChainId = '1'; // Define departing chain, set to Ethereum by default
const polygonId = '137'; // Polygon
const nativeToken = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'; // Define departing token

// Define amount to be sent
const amount = '10000000000000000';

// Import necessary ABI's
import nftContractAbi from '../abi/squidEasterEggNftAbi';
import erc20Abi from '../abi/erc20Abi';

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

	// Create contract interfaces and encode calldata
	const nftContractInterface = new ethers.utils.Interface(nftContractAbi);
	const mintEncodedData = nftContractInterface.encodeFunctionData('mint', [signer.address]);

	const erc20ContractInterface = new ethers.utils.Interface(erc20Abi);
	const transferRemainingBalanceEncodeData = erc20ContractInterface.encodeFunctionData('transfer', [
		signer.address,
		'0',
	]);

	// Create a postHook object of type Hook
	// This object customizes the post-hook contract call on the destination chain
	const postHook: Hook = {
		chainType: ChainType.EVM, // Chain type for the Hook - EVM or COSMOS
		fundAmount: amount, // The amount of tokens that will be used as fund
		fundToken: nativeToken, // The token that will be used as fund
		calls: [
			{
				chainType: ChainType.EVM, // Call chain type - EVM or COSMOS
				callType: 0, // SquidCallType.DEFAULT
				target: nftContractAddress, // Address of the contract that will be called
				value: '0', // Amount of ETH to be sent with the call
				callData: mintEncodedData, // Contract function call data
				payload: {
					tokenAddress: nativeToken, // Address of the native token to be used in the payload
					inputPos: 1, // Position of the input token in the route
				},
				estimatedGas: '150000', // Estimated gas to be used for the call
			},
			{
				chainType: ChainType.EVM, // Call chain type - EVM or COSMOS
				callType: 1, // SquidCallType.FULL_TOKEN_BALANCE
				target: nativeToken, // Address of the contract that will be called
				value: '0', // Amount of ETH to be sent with the call
				callData: transferRemainingBalanceEncodeData, // Contract function call data
				payload: {
					tokenAddress: nativeToken, // Address of the native token to be used in the payload
					inputPos: 1, // Position of the input token in the route
				},
				estimatedGas: '50000', // Estimated gas to be used for the call
			},
		],
	};

	// Set up parameters for a route between source and destination chains
	// Customize the route to swap tokens on the destination chain
	const params = {
		fromAddress: signer.address, // The address that will initiate the route call
		fromChain: fromChainId, // The ID of the source chain
		fromToken: nativeToken, // The source token address
		fromAmount: amount, // The amount of the source token to be sent
		toChain: polygonId, // The ID of the destination chain
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

	// Execute the swap and minting transaction
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
		fromChainId: fromChainId,
		toChainId: polygonId,
	};
	const status = await squid.getStatus(getStatusParams);

	// Display the route status
	console.log(`Route status: ${JSON.stringify(status)}`);
})();
