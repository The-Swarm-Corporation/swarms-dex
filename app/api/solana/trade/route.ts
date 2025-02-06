import { Connection, PublicKey, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import { createClient } from '@supabase/supabase-js';
import { TokenTrading } from '@/lib/solana/trading';
import { logger } from '@/lib/logger';
import AmmImpl from "@mercurial-finance/dynamic-amm-sdk";
import { BN } from "@project-serum/anchor";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const RPC_URL = process.env.RPC_URL as string;
const SWARMS_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS!;

export async function POST(req: Request) {
  try {
    const { userPublicKey, tokenMint, amount, action, maxPrice, minPrice } = await req.json();
    
    if (!userPublicKey || !tokenMint || !amount || !["buy", "sell"].includes(action)) {
      return new Response(JSON.stringify({ error: "Invalid Request" }), { status: 400 });
    }

    const connection = new Connection(RPC_URL, "confirmed");
    const buyerPubkey = new PublicKey(userPublicKey);
    const amountBigInt = BigInt(amount);

    // Fetch token details from Supabase
    const { data: tokenData } = await supabase
      .from("web3agents")
      .select("pool_address")
      .eq("mint_address", tokenMint)
      .single();

    if (!tokenData) {
      return new Response(JSON.stringify({ error: "Token not found" }), { status: 404 });
    }

    try {
      let result;
      
      if (tokenData.pool_address) {
        // Use Meteora SDK for graduated tokens
        const poolPublicKey = new PublicKey(tokenData.pool_address);
        const tokenMintPubkey = new PublicKey(tokenMint);
        const swarmsMintPubkey = new PublicKey(SWARMS_TOKEN_ADDRESS);

        // Initialize Meteora pool
        const meteoraPool = await AmmImpl.create(connection, poolPublicKey);
        if (!meteoraPool) {
          throw new Error("Failed to initialize Meteora pool");
        }

        // Determine token order (A = SWARMS, B = Agent Token)
        const isTokenAInput = action === "buy";
        
        // Get swap quote
        const { swapOutAmount, minSwapOutAmount } = meteoraPool.getSwapQuote(
          new BN(amountBigInt.toString()),
          isTokenAInput,
          0.01 // 1% slippage
        );

        // Create swap transaction
        const transaction = new Transaction();
        const swapIx = await meteoraPool.swap(
          buyerPubkey,
          new BN(amountBigInt.toString()),
          minSwapOutAmount,
          isTokenAInput
        );
        transaction.add(swapIx);

        // Get latest blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.lastValidBlockHeight = lastValidBlockHeight;
        transaction.feePayer = buyerPubkey;

        result = {
          transaction,
          price: Number(swapOutAmount) / Number(amountBigInt)
        };

      } else {
        // Use bonding curve for non-graduated tokens
        const trading = new TokenTrading(connection);
        
        if (action === "buy") {
          result = await trading.buyTokens(
            tokenMint,
            buyerPubkey,
            amountBigInt,
            maxPrice || Number.MAX_VALUE
          );
        } else {
          result = await trading.sellTokens(
            tokenMint,
            buyerPubkey,
            amountBigInt,
            minPrice || 0
          );
        }
      }

      logger.info(`${action} order processed`, {
        user: userPublicKey,
        token: tokenMint,
        amount: amount.toString(),
        price: result.price
      });

      return new Response(JSON.stringify({
        success: true,
        transaction: result.transaction.serialize({ requireAllSignatures: false }).toString("base64"),
        price: result.price
      }), { status: 200 });

    } catch (error) {
      logger.error(`${action} order failed`, error as Error);
      return new Response(JSON.stringify({ 
        error: error instanceof Error ? error.message : "Trade execution failed" 
      }), { status: 400 });
    }

  } catch (error) {
    logger.error("Trade route error", error as Error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { signedTransaction, tokenMint, action } = await req.json();
    
    if (!signedTransaction || !tokenMint || !action) {
      return new Response(JSON.stringify({ error: "Invalid Request" }), { status: 400 });
    }

    const connection = new Connection(RPC_URL, "confirmed");

    try {
      // Deserialize the signed transaction
      const transaction = Transaction.from(Buffer.from(signedTransaction, 'base64'));

      // Send the transaction
      const signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3
      });

      logger.info(`${action} transaction sent`, {
        token: tokenMint,
        signature,
      });

      return new Response(JSON.stringify({
        success: true,
        signature
      }), { status: 200 });

    } catch (error) {
      logger.error(`Failed to submit ${action} transaction`, error as Error);
      return new Response(JSON.stringify({ 
        error: error instanceof Error ? error.message : "Transaction submission failed" 
      }), { status: 400 });
    }

  } catch (error) {
    logger.error("Trade submission error", error as Error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
}
  