import { Connection, PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { MeteoraService } from "@/lib/meteora/service";
import { BN } from "@project-serum/anchor";

const RPC_URL = process.env.RPC_URL as string;
const TOKEN_DECIMALS = 6;

export async function POST(req: Request) {
  try {
    const {
      walletAddress,
      amount,
      action,
      tokenMint,
      poolAddress,
      slippage = 1, // Default to 1% slippage
      priorityFee = 50000 // Default to 50k microlamports
    } = await req.json();

    if (!walletAddress || !amount || !action || !tokenMint || !poolAddress) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    const connection = new Connection(RPC_URL, {
      commitment: 'confirmed'
    });

    // Initialize Meteora service
    const meteoraService = new MeteoraService(connection);

    // Get pool info
    const pool = await meteoraService.getPool(new PublicKey(poolAddress));
    if (!pool) {
      throw new Error("Pool not found");
    }

    // Convert amount to proper decimals
    const amountInBigInt = BigInt(Math.floor(Number(amount) * Math.pow(10, TOKEN_DECIMALS)));
    const minAmountOut = BigInt(Math.floor(Number(amount) * Math.pow(10, TOKEN_DECIMALS) * (100 - slippage) / 100));

    // Create swap transaction
    const swapTx = await meteoraService.swap({
      poolAddress: new PublicKey(poolAddress),
      tokenInMint: action === "buy" ? pool.tokenBMint : pool.tokenAMint,
      tokenOutMint: action === "buy" ? pool.tokenAMint : pool.tokenBMint,
      amountIn: amountInBigInt,
      minAmountOut: minAmountOut,
      userWallet: new PublicKey(walletAddress)
    });

    // Add compute budget instructions
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ 
      microLamports: priorityFee 
    });
    swapTx.instructions = [modifyComputeUnits, addPriorityFee, ...swapTx.instructions];

    // Set fee payer
    swapTx.feePayer = new PublicKey(walletAddress);

    // Get latest blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
    swapTx.recentBlockhash = blockhash;
    swapTx.lastValidBlockHeight = lastValidBlockHeight + 150;

    // Simulate transaction to check for errors
    const simulation = await connection.simulateTransaction(swapTx);

    if (simulation.value.err) {
      // Check for specific error types
      const logs = simulation.value.logs || [];
      const isInsufficientFunds = logs.some(log => 
        log.includes('Insufficient funds') || 
        log.includes('insufficient lamports')
      );

      if (isInsufficientFunds) {
        // Extract balance info from logs
        const balanceLog = logs.find(log => log.includes('balance:'));
        const requiredLog = logs.find(log => log.includes('required:'));

        return new Response(JSON.stringify({
          error: "Insufficient balance",
          details: {
            balance: balanceLog ? parseInt(balanceLog.split('balance:')[1].trim()) : 0,
            required: requiredLog ? parseInt(requiredLog.split('required:')[1].trim()) : 0,
            token: action === "buy" ? "SWARMS" : tokenMint,
            decimals: TOKEN_DECIMALS
          }
        }), { status: 400 });
      }

      throw new Error(`Swap simulation failed: ${JSON.stringify(simulation.value.err)}`);
    }

    // Return serialized transaction
    return new Response(JSON.stringify({
      transaction: swapTx.serialize({ requireAllSignatures: false }).toString('base64')
    }), { status: 200 });

  } catch (error) {
    console.error('Error creating swap transaction:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Failed to create swap transaction" 
    }), { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { signedTransaction } = await req.json();

    if (!signedTransaction) {
      return new Response(JSON.stringify({ error: "Missing signed transaction" }), { status: 400 });
    }

    const connection = new Connection(RPC_URL, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000
    });

    // Send signed transaction
    const tx = Transaction.from(Buffer.from(signedTransaction, 'base64'));
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 5
    });

    return new Response(JSON.stringify({ signature }), { status: 200 });

  } catch (error) {
    console.error('Error submitting swap transaction:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Failed to submit swap transaction" 
    }), { status: 500 });
  }
}
  