// Import necessary libraries
import { ethers } from 'ethers';
import axios from 'axios';

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

// Set up JSON RPC provider and signer
const provider = new ethers.providers.JsonRpcProvider(ethereumRpcEndpoint);
const signer = new ethers.Wallet(privateKey, provider);

const getRoute = async (params: any) => {
	try {
		const result = await axios.post('https://v2.api.squidrouter.com/v2/route', params, {
			headers: {
				'x-integrator-id': integratorId,
				'Content-Type': 'application/json',
			},
		});
		const requestId = result.headers['x-request-id'];
		return { data: result.data, requestId: requestId };
	} catch (error) {
		// Log the error response if it's available.
		if (error.response) {
			console.error('API error:', error.response.data);
		}
		console.error('Error with parameters:', params);
		throw error;
	}
};

const getStatus = async (params: any) => {
	try {
		const result = await axios.get('https://api.squidrouter.com/v1/status', {
			params: {
				transactionId: params.transactionId,
				requestId: params.requestId,
				fromChainId: params.fromChainId,
				toChainId: params.toChainId,
			},
			headers: {
				'x-integrator-id': integratorId,
			},
		});
		return result.data;
	} catch (error) {
		if (error.response) {
			console.error('API error:', error.response.data);
		}
		console.error('Error with parameters:', params);
		throw error;
	}
};

// Create contract interface and encode delegate (Fantom staking) function
const stakingContractInterface = new ethers.utils.Interface(stakingContractAbi);
const delegateEncodedData = stakingContractInterface.encodeFunctionData('delegate', [amountToSwap]);

(async () => {
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

	// Get the swap route using Squid API
	const routeResult = await getRoute(params);
	const route = routeResult.data.route;
	const requestId = routeResult.requestId;
	console.log('Calculated route:', route);
	console.log('requestId:', requestId);
	console.log('Calculated fee costs:', route.estimate.feeCosts);

	const transactionRequest = route.transactionRequest;

	// Execute the swap and staking transaction
	const contract = new ethers.Contract(transactionRequest.targetAddress, stakingContractAbi, signer);
	const tx = await contract.send(transactionRequest.data, {
		value: transactionRequest.value,
		gasPrice: transactionRequest.gasPrice,
		gasLimit: transactionRequest.gasLimit,
	});
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
	const status = await getStatus(getStatusParams);

	// Display the route status
	console.log(`Route status: ${JSON.stringify(status)}`);
})();
