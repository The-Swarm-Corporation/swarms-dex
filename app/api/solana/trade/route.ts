import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createClient } from '@supabase/supabase-js';
import { TokenTrading } from '@/lib/solana/trading';
import { logger } from '@/lib/logger';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const RPC_URL = process.env.RPC_URL as string;

export async function POST(req: Request) {
  try {
    const { userPublicKey, tokenMint, amount, action, maxPrice, minPrice, transactionSignature } = await req.json();
    
    if (!userPublicKey || !tokenMint || !amount || !["buy", "sell"].includes(action)) {
      return new Response(JSON.stringify({ error: "Invalid Request" }), { status: 400 });
    }

    const connection = new Connection(RPC_URL, "confirmed");
    const trading = new TokenTrading(connection);
    const buyerPubkey = new PublicKey(userPublicKey);
    const amountBigInt = BigInt(amount);

    // Fetch token details from Supabase
    const { data: tokenData } = await supabase
      .from("ai_tokens")
      .select("graduated")
      .eq("mint_address", tokenMint)
      .single();

    if (!tokenData) {
      return new Response(JSON.stringify({ error: "Token not found" }), { status: 404 });
    }

    if (tokenData.graduated) {
        // Token is on Meteora, redirect trade
        return await fetch("https://api.meteora.example.com/v1/swap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tokenMint, swarmsAmount: amountBigInt, action }),
        });
    }

    try {
      let result;
      
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

      logger.info(`${action} order processed`, {
        user: userPublicKey,
        token: tokenMint,
        amount: amount.toString(),
        price: result.price
      });

      return new Response(JSON.stringify({
        success: true,
        signature: result.signature,
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
  