import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";
import { getAccount } from "@solana/spl-token";
import { TokenTrading } from "@/lib/solana/trading";
import { logger } from "@/lib/logger";

const RPC_URL = process.env.RPC_URL as string;
const DAO_TREASURY_ADDRESS = new PublicKey(process.env.NEXT_PUBLIC_DAO_TREASURY_ADDRESS as string);
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const SWARMS_TOKEN_ADDRESS = new PublicKey(process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS as string);
const GRADUATION_FEE_SWARMS = 6_000; // 6000 SWARMS to graduate

export async function POST(req: Request) {
  try {
    const { tokenMint, userPublicKey } = await req.json();
    if (!tokenMint || !userPublicKey) {
      return new Response(JSON.stringify({ error: "Invalid request - missing tokenMint or userPublicKey" }), { status: 400 });
    }

    logger.info("Processing graduation request", {
      token: tokenMint,
      user: userPublicKey
    });

    // Fetch Token Data
    const { data: tokenData } = await supabase
      .from("ai_tokens")
      .select("bonding_curve_address, swarms_reserve, graduated")
      .eq("mint_address", tokenMint)
      .single();

    if (!tokenData) {
      return new Response(JSON.stringify({ error: "Token not found" }), { status: 404 });
    }

    if (tokenData.graduated) {
      return new Response(JSON.stringify({ error: "Token already graduated" }), { status: 400 });
    }

    const connection = new Connection(RPC_URL, "confirmed");
    const trading = new TokenTrading(connection);
    
    try {
      // Get current token balance and price
      const bondingCurveAccount = await getAccount(
        connection,
        new PublicKey(tokenData.bonding_curve_address)
      );

      const currentPrice = await trading.getCurrentPrice(tokenMint);
      
      // Calculate graduation requirements
      const swarmsAfterFees = tokenData.swarms_reserve - GRADUATION_FEE_SWARMS;
      if (swarmsAfterFees <= 0) {
        return new Response(JSON.stringify({ 
          error: "Insufficient SWARMS for graduation",
          required: GRADUATION_FEE_SWARMS,
          current: tokenData.swarms_reserve
        }), { status: 400 });
      }

      // Create graduation transaction
      const transaction = new Transaction();

      // Add DAO fee transfer
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(userPublicKey),
          toPubkey: DAO_TREASURY_ADDRESS,
          lamports: GRADUATION_FEE_SWARMS * LAMPORTS_PER_SOL
        })
      );

      // Get blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.lastValidBlockHeight = lastValidBlockHeight;

      logger.info("Graduation transaction prepared", {
        token: tokenMint,
        fee: GRADUATION_FEE_SWARMS,
        currentPrice,
        swarmsReserve: swarmsAfterFees
      });

      // Update DB status - will be committed after transaction confirmation
      await supabase.from("ai_tokens")
        .update({ 
          graduated: true,
          swarms_reserve: swarmsAfterFees,
          graduation_price: currentPrice,
          graduated_at: new Date()
        })
        .eq("mint_address", tokenMint);

      return new Response(JSON.stringify({ 
        success: true,
        transaction: transaction.serialize({ requireAllSignatures: false }).toString("base64"),
        graduationPrice: currentPrice,
        graduationFee: GRADUATION_FEE_SWARMS
      }), { status: 200 });

    } catch (error) {
      logger.error("Error processing graduation", error as Error);
      return new Response(JSON.stringify({ 
        error: error instanceof Error ? error.message : "Graduation processing failed" 
      }), { status: 400 });
    }

  } catch (error) {
    logger.error("Graduation route error", error as Error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
}
