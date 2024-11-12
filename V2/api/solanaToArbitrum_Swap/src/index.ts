// First, update the imports at the top of the file:
import { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, Keypair } from "@solana/web3.js";
import { SwapSDK, SwapStatusResponseV2 } from "@chainflip/sdk/swap";
import axios from "axios";
import * as dotenv from "dotenv";
import bs58 from "bs58";
dotenv.config();

// Initialize Chainflip SDK
const swapSDK = new SwapSDK({
  network: 'mainnet',
});

// Load environment variables
const privateKey: string = process.env.SOLANA_PRIVATE_KEY!;
const integratorId: string = process.env.INTEGRATOR_ID!;
const SOLANA_RPC: string = process.env.SOLANA_RPC_ENDPOINT || "https://api.mainnet-beta.solana.com";

// Chain and token config
const fromChainId = "solana-mainnet-beta";
const toChainId = "42161";
const fromToken = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const toToken = "0x912CE59144191C1204E64559FE8253a0e49E6548";

// Solana setup
const connection = new Connection(SOLANA_RPC, "confirmed");
const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));

// Function to get route from Squid
const getRoute = async (params: any) => {
  try {
    const result = await axios.post(
      "https://api.uatsquidrouter.com/v2/route",
      params,
      {
        headers: {
          "x-integrator-id": integratorId,
          "Content-Type": "application/json",
        },
      }
    );
    const requestId = result.headers["x-request-id"];
    return { data: result.data, requestId: requestId };
  } catch (error: any) {
    if (error.response) {
      console.error("API error:", error.response.data);
    }
    console.error("Error with parameters:", params);
    throw error;
  }
};

// Function to get Chainflip status using SDK
const getChainflipStatus = async (chainflipId: string) => {
  try {
    return await swapSDK.getStatusV2({ 
      id: chainflipId
    });
  } catch (error: any) {
    console.error("Chainflip status error:", error);
    throw error;
  }
};

// Function to get Squid status
const getSquidStatus = async (txHash: string, requestId: string) => {
  try {
    const result = await axios.get("https://api.squidrouter.com/v2/status", {
      params: {
        transactionId: txHash,
        requestId: requestId,
        fromChainId: fromChainId,
        toChainId: toChainId,
      },
      headers: {
        "x-integrator-id": integratorId,
      },
    });
    return result.data;
  } catch (error: any) {
    if (error.response) {
      console.error("Squid API error:", error.response.data);
    }
    console.error("Error getting Squid status");
    throw error;
  }
};

// Function to monitor swap status
const monitorSwapStatus = async (params: { 
  txHash: string, 
  requestId: string, 
  chainflipId: string 
}) => {
  const { txHash, requestId, chainflipId } = params;
  console.log("\nInitiating Cross-Chain Swap Monitoring:");
  console.log("=====================================");
  console.log(`Solana TX: ${txHash}`);
  console.log(`Chainflip ID: ${chainflipId}`);
  console.log(`Request ID: ${requestId}`);
  console.log(`Solana Explorer: https://solscan.io/tx/${txHash}`);

  let retryCount = 0;
  const maxRetries = 30;
  let isCompleted = false;

  do {
    try {
      console.log("\nFetching status updates...");
      
      // Get both statuses in parallel
      const [chainflipStatus, squidStatus] = await Promise.all([
        getChainflipStatus(chainflipId).catch(error => ({
          state: "ERROR",
          error: error.message
        })),
        getSquidStatus(txHash, requestId).catch(error => ({
          state: "ERROR",
          error: error.message
        }))
      ]);

      console.log("\nStatus Update at", new Date().toISOString());
      console.log("----------------------------------------");

      // Log Chainflip Status
      if (chainflipStatus.state !== "ERROR") {
        console.log("\n🔗 Chainflip Status:", chainflipStatus.state);
        
        switch (chainflipStatus.state) {
          case "WAITING":
            if ('depositChannel' in chainflipStatus) {
              console.log("Deposit Channel:", chainflipStatus.depositChannel.depositAddress);
              console.log("Expires:", new Date(chainflipStatus.depositChannel.estimatedExpiryTime).toLocaleString());
            }
            break;
          
          case "RECEIVING":
            if ('deposit' in chainflipStatus) {
              console.log("Amount:", chainflipStatus.deposit.amount);
              console.log("Confirmations:", chainflipStatus.deposit.txConfirmations || 0);
            }
            break;
          
          case "SWAPPING":
            if ('swap' in chainflipStatus) {
              console.log("Input Amount:", chainflipStatus.swap.swappedInputAmount);
              console.log("Expected Output:", chainflipStatus.swap.swappedOutputAmount);
            }
            break;
          
          case "SENDING":
          case "SENT":
          case "COMPLETED":
            if ('swapEgress' in chainflipStatus && chainflipStatus.swapEgress) {
              console.log("Amount:", chainflipStatus.swapEgress.amount);
              if (chainflipStatus.swapEgress.txRef) {
                console.log(`Arbitrum TX: ${chainflipStatus.swapEgress.txRef}`);
                console.log(`Arbitrum Explorer: https://arbiscan.io/tx/${chainflipStatus.swapEgress.txRef}`);
              }
            }
            break;
        }

        // Log estimated duration if available
        if ('estimatedDurationsSeconds' in chainflipStatus && 
            chainflipStatus.estimatedDurationsSeconds) {
          console.log("\nEstimated Durations:");
          const durations = chainflipStatus.estimatedDurationsSeconds as {
            deposit?: number;
            swap?: number;
            egress?: number;
          };

          if (durations.deposit !== undefined) {
            console.log(`Deposit: ${durations.deposit}s`);
          }
          if (durations.swap !== undefined) {
            console.log(`Swap: ${durations.swap}s`);
          }
          if (durations.egress !== undefined) {
            console.log(`Egress: ${durations.egress}s`);
          }
        }
      }

      // Log Squid Status
      if (squidStatus.state !== "ERROR") {
        console.log("\n🦑 Squid Status:", squidStatus.state);
        
        if (squidStatus.route?.estimate) {
          console.log("\nEstimated:");
          console.log(`From: ${squidStatus.route.estimate.fromAmount} SOL ($${squidStatus.route.estimate.fromAmountUSD})`);
          console.log(`To: ${squidStatus.route.estimate.toAmount} ARB ($${squidStatus.route.estimate.toAmountUSD})`);
        }

        if (squidStatus.fees) {
          console.log("\nFees:");
          squidStatus.fees.forEach((fee: any) => {
            console.log(`- ${fee.type}: ${fee.amount} ${fee.asset} (${fee.chain})`);
          });
        }
      }

      // Check completion
      if ((chainflipStatus.state === "COMPLETED" || chainflipStatus.state === "SENT") && 
          (squidStatus.state === "COMPLETED" || squidStatus.state === "SUCCESS")) {
        console.log("\n✨ Swap completed successfully!");
        console.log("\nTransaction Summary:");
        console.log(`Source: Solana (${txHash})`);
        if ('swapEgress' in chainflipStatus && chainflipStatus.swapEgress?.txRef) {
          console.log(`Destination: Arbitrum (${chainflipStatus.swapEgress.txRef})`);
        }
        isCompleted = true;
        break;
      }

      // Check failures
      if (chainflipStatus.state === "FAILED" || squidStatus.state === "FAILED") {
        console.error("\n❌ Swap failed!");
        if ('deposit' in chainflipStatus && chainflipStatus.deposit?.failure) {
          console.error("Chainflip failure:", chainflipStatus.deposit.failure);
        }
        if (squidStatus.error) {
          console.error("Squid error:", squidStatus.error);
        }
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 10000));

    } catch (error) {
      console.error("\nStatus check error:", error);
      retryCount++;
      if (retryCount >= maxRetries) break;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } while (!isCompleted && retryCount < maxRetries);
};

// Execute swap function
const executeSwap = async () => {
  const params = {
    fromAddress: wallet.publicKey.toString(),
    fromChain: fromChainId,
    fromToken: fromToken,
    fromAmount: "100000000", // Amount in lamports
    toChain: toChainId,
    toToken: toToken,
    toAddress: "0xC601C9100f8420417A94F6D63e5712C21029525e",
    quoteOnly: false,
    enableBoost: true
  };

  console.log("Parameters:", params);

  const routeResult = await getRoute(params);
  const route = routeResult.data.route;
  const chainflipId = route.transactionRequest.chainflipId;
  const requestId = routeResult.requestId;
  
  console.log("Route calculated successfully:");
  console.log(`- Chainflip ID: ${chainflipId}`);
  console.log(`- Request ID: ${requestId}`);

  const transactionRequest = route.transactionRequest;

  // Create Solana transaction
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey(transactionRequest.target),
      lamports: parseInt(transactionRequest.value),
    })
  );

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet]
    );
    console.log("\nTransaction broadcast successfully:");
    console.log(`Solana Transaction: ${signature}`);
    console.log(`Solscan: https://solscan.io/tx/${signature}`);

    // Monitor the cross-chain transfer
    await monitorSwapStatus({
      txHash: signature,
      requestId,
      chainflipId
    });

  } catch (error) {
    console.error("Error executing transaction:", error);
    throw error;
  }
};
executeSwap().catch(console.error);