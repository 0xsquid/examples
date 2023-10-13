// Import necessary libraries
import { ethers } from 'ethers';
import { Squid } from '@0xsquid/sdk';

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

	// Set up parameters for swapping tokens and minting NFT on Polygon
	const params = {
		fromAddress: signer.address,
		fromChain: fromChainId,
		fromToken: nativeToken,
		fromAmount: amount,
		toChain: polygonId,
		toToken: nativeToken,
		toAddress: signer.address,
		slippage: 1,
		slippageConfig: {
			autoMode: 1,
		},
		enableBoost: true,
		quoteOnly: false,
		// Customize contract call for minting NFT on Polygon
		postHooks: [
			{
				callType: 0, // SquidCallType.DEFAULT
				target: nftContractAddress,
				value: '0',
				callData: mintEncodedData,
				payload: {
					tokenAddress: nativeToken,
					inputPos: 1,
				},
				estimatedGas: '50000',
			},
			{
				callType: 1, // SquidCallType.FULL_TOKEN_BALANCE
				target: nativeToken,
				value: '0',
				callData: transferRemainingBalanceEncodeData,
				payload: {
					tokenAddress: nativeToken,
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
