// Import necessary libraries
import { ethers } from 'ethers';
import { Squid } from '@0xsquid/sdk';

// Load environment variables from .env file
import * as dotenv from 'dotenv';
dotenv.config();

const privateKey: string = process.env.PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const ethereumRpcEndpoint: string = process.env.ETHEREUM_RPC_ENDPOINT!;
const aavePoolAddress: string = process.env.AAVE_POOL_ADDRESS!;
const binanceAddress: string = process.env.BINANCE_ADDRESS!;

// Define chain and token addresses
const ethereumId = '1'; // Ethereum
const binanceSmartChainId = '56'; // Binance Smart Chain
const nativeToken = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// Define asset, amount, interest rate mode, and address
const repayAsset = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'; // The address of the borrowed underlying asset previously borrowed
const repayAmount = '10000000000000000'; // The amount to repay - Send the value type(uint256).max in order to repay the whole debt for `asset` on the specific `debtMode`
const repayInterestRateMode = 1; // The interest rate mode at of the debt the user wants to repay: 1 for Stable, 2 for Variable
const repayOnBehalfOf = '0x0000000000000000000000000000000000000000'; // The address of the user who will get their debt reduced/removed. Should be the address of the user calling the function if they want to reduce/remove their own debt, or the address of any other other borrower whose debt should be removed

// Import Aave lending pool ABI
import aavePoolAbi from '../abi/aavePoolAbi';

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

	// Create contract interface and encode repay function for Aave
	const aaveLendingPoolInterface = new ethers.utils.Interface(aavePoolAbi);
	const repayEncodedData = aaveLendingPoolInterface.encodeFunctionData('repay', [
		repayAsset,
		repayAmount,
		repayInterestRateMode,
		repayOnBehalfOf,
	]);

	// Set up parameters for repaying the loan, swapping tokens, and withdrawing
	const params = {
		fromAddress: signer.address,
		fromChain: ethereumId,
		fromToken: repayAsset,
		fromAmount: repayAmount,
		toChain: binanceSmartChainId,
		toToken: nativeToken,
		toAddress: binanceAddress,
		slippage: 1,
		slippageConfig: {
			autoMode: 1,
		},
		enableBoost: true,
		quoteOnly: false,
		// Customize pre-hooks for repaying the loan
		preHooks: [
			{
				callType: 0, // SquidCallType.DEFAULT
				target: aavePoolAddress,
				value: '0',
				callData: repayEncodedData,
				estimatedGas: '50000',
				payload: {
					tokenAddress: repayAsset,
					inputPos: 1,
				},
			},
		],
	};

	console.log('Parameters:', params);

	// Get the swap route using Squid SDK
	const { route, requestId } = await squid.getRoute(params);
	console.log('Calculated route: ', route.estimate.toAmount);
	console.log('Calculated fee costs: ', route.estimate.feeCosts);

	// Execute the repayment, swap, and withdrawal transaction
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
		toChainId: binanceSmartChainId,
	};
	const status = await squid.getStatus(getStatusParams);

	// Display the route status
	console.log(`Route status: ${JSON.stringify(status)}`);
})();
