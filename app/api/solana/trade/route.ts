import { Connection, PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { BN } from "@project-serum/anchor";
import AmmImpl from "@mercurial-finance/dynamic-amm-sdk";
import { logger } from "@/lib/logger";

const RPC_URL = process.env.RPC_URL as string;
const TOKEN_DECIMALS = 6;
const SWARMS_TOKEN = process.env.NEXT_PUBLIC_SWARMS_TOKEN_MINT as string;

export async function POST(req: Request) {
  try {
    const {
      walletAddress,
      amount,
      action,
      tokenMint,
      swapsTokenAddress,
      poolAddress,
      slippage = 1, // Default to 1% slippage
      priorityFee = 500000 // Default to 500k microlamports
    } = await req.json();

    if (!walletAddress || !amount || !action || !tokenMint || !poolAddress || !swapsTokenAddress) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    const connection = new Connection(RPC_URL, {
      commitment: 'confirmed'
    });

    // Initialize Meteora pool
    const meteoraPool = await AmmImpl.create(connection, new PublicKey(poolAddress));

    // Convert amount to proper decimals
    const amountInBN = new BN(Math.floor(Number(amount) * Math.pow(10, TOKEN_DECIMALS)));

    // When buying: SWARMS -> Token (isAtoB = false)
    // When selling: Token -> SWARMS (isAtoB = true)
    const inTokenMint = new PublicKey(action === "buy" ? swapsTokenAddress : tokenMint);

    logger.info("Creating swap instruction", {
      data: {
        pool: poolAddress,
        tokenIn: inTokenMint.toString(),
        amountIn: amountInBN.toString(),
        action
      }
    });

    // Get swap quote
    const quote = meteoraPool.getSwapQuote(
      inTokenMint,
      amountInBN,
      slippage
    );

    // Create swap transaction
    const swapTx = await meteoraPool.swap(
      new PublicKey(walletAddress),
      inTokenMint,
      amountInBN,
      quote.minSwapOutAmount
    );

    // Add compute budget instructions
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ 
      microLamports: priorityFee 
    });
    swapTx.instructions = [modifyComputeUnits, addPriorityFee, ...swapTx.instructions];

    // Set fee payer
    swapTx.feePayer = new PublicKey(walletAddress);

    // Get latest blockhash right before sending to user
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

    logger.info("Swap transaction prepared", {
      data: {
        pool: poolAddress,
        tokenIn: inTokenMint.toString(),
        amountIn: amountInBN.toString(),
        expectedOut: quote.swapOutAmount.toString(),
        minOut: quote.minSwapOutAmount.toString(),
        priceImpact: quote.priceImpact.toString(),
        fee: quote.fee.toString(),
        blockhash,
        lastValidBlockHeight
      }
    });

    // Return serialized transaction with blockhash info
    return new Response(JSON.stringify({
      transaction: swapTx.serialize({ requireAllSignatures: false }).toString('base64'),
      blockhash,
      lastValidBlockHeight
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
      commitment: 'confirmed'
    });

    // Send signed transaction immediately
    const tx = Transaction.from(Buffer.from(signedTransaction, 'base64'));
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 5
    });

    logger.info("Transaction sent", { data: { signature } });

    try {
      // Try to get quick confirmation
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      const confirmation = await connection.confirmTransaction({
        signature,
        ...latestBlockhash
      }, 'confirmed');

      if (confirmation.value.err) {
        const error = new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        logger.error("Transaction failed", error, { data: { signature } });
        throw error;
      }

      logger.info("Transaction confirmed quickly", { data: { signature } });
      return new Response(JSON.stringify({ 
        signature,
        confirmed: true 
      }), { status: 200 });

    } catch (confirmError) {
      // If quick confirmation fails, check transaction status
      try {
        const txInfo = await connection.getTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        });

        if (txInfo?.meta?.err) {
          const error = new Error(`Transaction failed: ${JSON.stringify(txInfo.meta.err)}`);
          logger.error("Transaction failed", error, { data: { signature } });
          throw error;
        }

        // If we found the transaction and it has no errors, it succeeded
        if (txInfo) {
          logger.info("Transaction found and successful", { data: { signature } });
          return new Response(JSON.stringify({ 
            signature,
            confirmed: true 
          }), { status: 200 });
        }
      } catch (txCheckError) {
        logger.warn("Failed to check transaction status", {
          error: txCheckError,
          context: { signature }
        });
      }

      // If we couldn't confirm but the transaction was submitted, return partial success
      logger.info("Transaction submitted but confirmation pending", { data: { signature } });
      return new Response(JSON.stringify({ 
        signature,
        confirmed: false,
        status: 'submitted',
        message: 'Transaction submitted but confirmation is still pending. Please check the transaction status on Solscan.'
      }), { status: 202 });
    }

  } catch (error) {
    console.error('Error submitting swap transaction:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Failed to submit/confirm transaction" 
    }), { status: 500 });
  }
}
  