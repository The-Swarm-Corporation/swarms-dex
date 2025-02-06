import { Connection, PublicKey, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import { createClient } from '@supabase/supabase-js';
import { TokenTrading } from '@/lib/solana/trading';
import { logger } from '@/lib/logger';
import AmmImpl from "@mercurial-finance/dynamic-amm-sdk";
import { BN } from "@project-serum/anchor";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";

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

    // Check token balance before proceeding
    try {
      const tokenToCheck = action === "buy" ? SWARMS_TOKEN_ADDRESS : tokenMint;
      const tokenMintPubkey = new PublicKey(tokenToCheck);
      const tokenAccount = await getAssociatedTokenAddress(tokenMintPubkey, buyerPubkey);
      
      try {
        const accountInfo = await getAccount(connection, tokenAccount);
        const balance = BigInt(accountInfo.amount.toString());
        
        if (balance < amountBigInt) {
          return new Response(JSON.stringify({ 
            error: "Insufficient balance",
            details: {
              required: amount,
              balance: balance.toString(),
              token: action === "buy" ? "SWARMS" : tokenMint
            }
          }), { status: 400 });
        }
      } catch (error) {
        // If account doesn't exist or has no balance
        return new Response(JSON.stringify({ 
          error: "No token balance found",
          details: {
            required: amount,
            balance: "0",
            token: action === "buy" ? "SWARMS" : tokenMint
          }
        }), { status: 400 });
      }
    } catch (error) {
      logger.error("Failed to check token balance", error as Error);
      return new Response(JSON.stringify({ error: "Failed to check token balance" }), { status: 400 });
    }

    // Fetch token details from Supabase
    const { data: tokenData } = await supabase
      .from("web3agents")
      .select("pool_address, name")
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

        // For buy: input is SWARMS token, output is agent token
        // For sell: input is agent token, output is SWARMS token
        const inputTokenMint = action === "buy" ? swarmsMintPubkey : tokenMintPubkey;
        const inputAmount = new BN(amountBigInt.toString());

        // Get swap quote
        const { minSwapOutAmount, swapOutAmount } = meteoraPool.getSwapQuote(
          inputTokenMint,
          inputAmount,
          0.01 // 1% slippage
        );

        // Create swap transaction
        const transaction = new Transaction();
        const swapIx = await meteoraPool.swap(
          buyerPubkey,
          inputTokenMint,
          inputAmount,
          minSwapOutAmount
        );
        transaction.add(swapIx);

        // Get latest blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.lastValidBlockHeight = lastValidBlockHeight;
        transaction.feePayer = buyerPubkey;

        // Calculate effective price
        const price = action === "buy" 
          ? Number(inputAmount) / Number(swapOutAmount)
          : Number(swapOutAmount) / Number(inputAmount);

        result = {
          transaction,
          price,
          inputAmount: inputAmount.toString(),
          expectedOutputAmount: swapOutAmount.toString(),
          minimumOutputAmount: minSwapOutAmount.toString(),
          inputToken: action === "buy" ? "SWARMS" : "Agent Token",
          outputToken: action === "buy" ? "Agent Token" : "SWARMS"
        };

      } else {
        // Use bonding curve for non-graduated tokens
        const trading = new TokenTrading(connection);
        
        if (action === "buy") {
          const bondingCurveResult = await trading.buyTokens(
            tokenMint,
            buyerPubkey,
            amountBigInt,
            maxPrice || Number.MAX_VALUE
          );

          result = {
            transaction: bondingCurveResult.transaction,
            price: bondingCurveResult.price,
            inputAmount: amount.toString(),
            expectedOutputAmount: amountBigInt.toString(),
            minimumOutputAmount: amountBigInt.toString(),
            inputToken: "SWARMS",
            outputToken: tokenData.name
          };
        } else {
          const bondingCurveResult = await trading.sellTokens(
            tokenMint,
            buyerPubkey,
            amountBigInt,
            minPrice || 0
          );

          result = {
            transaction: bondingCurveResult.transaction,
            price: bondingCurveResult.price,
            inputAmount: amount.toString(),
            expectedOutputAmount: (amountBigInt * BigInt(bondingCurveResult.price)).toString(),
            minimumOutputAmount: (amountBigInt * BigInt(bondingCurveResult.price)).toString(),
            inputToken: tokenData.name,
            outputToken: "SWARMS"
          };
        }

      }

      logger.info(`${action} order processed`, {
        user: userPublicKey,
        token: tokenMint,
        amount: amount.toString(),
        price: result.price,
        expectedOutput: result.expectedOutputAmount,
        minimumOutput: result.minimumOutputAmount
      });

      return new Response(JSON.stringify({
        success: true,
        transaction: result.transaction.serialize({ requireAllSignatures: false }).toString("base64"),
        price: result.price,
        inputAmount: result.inputAmount,
        expectedOutputAmount: result.expectedOutputAmount,
        minimumOutputAmount: result.minimumOutputAmount,
        inputToken: result.inputToken,
        outputToken: result.outputToken
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
  