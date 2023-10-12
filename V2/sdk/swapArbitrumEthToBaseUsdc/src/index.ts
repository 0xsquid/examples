// Import necessary libraries
import { ethers } from 'ethers';
import { Squid } from '@0xsquid/sdk';

// Load environment variables from .env file
import * as dotenv from 'dotenv';
dotenv.config();

const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const arbitrumRpcEndpoint: string = process.env.ARBITRUM_RPC_ENDPOINT!;

// Define chain and token addresses
const arbitrumChainId = '42161'; // Arbitrum
const baseChainId = '8453'; // Base
const nativeToken = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const baseUsdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Define amount to be sent
const amount = '10000000000000000';

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
	const provider = new ethers.providers.JsonRpcProvider(arbitrumRpcEndpoint);
	const signer = new ethers.Wallet(privateKey, provider);

	// Initialize Squid SDK
	const squid = getSDK();
	await squid.init();
	console.log('Initialized Squid SDK');

	// Set up parameters for swapping tokens
	const params = {
		fromAddress: signer.address,
		fromChain: arbitrumChainId,
		fromToken: nativeToken,
		fromAmount: amount,
		toChain: baseChainId,
		toToken: baseUsdc,
		toAddress: signer.address,
		slippage: 1,
		slippageConfig: {
			autoMode: 1,
		},
		enableBoost: true,
		quoteOnly: false,
	};

	console.log('Parameters:', params);

	// Get the swap route using Squid SDK
	const { route, requestId } = await squid.getRoute(params);
	console.log('Calculated route:', route.estimate.toAmount);

	// Execute the swap transaction
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
		fromChainId: arbitrumChainId,
		toChainId: baseChainId,
	};
	const status = await squid.getStatus(getStatusParams);

	// Display the route status
	console.log(`Route status: ${JSON.stringify(status)}`);
})();
