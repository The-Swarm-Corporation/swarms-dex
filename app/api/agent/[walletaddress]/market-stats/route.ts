import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { rpcRouter } from "@/lib/rpc/router"
import { Connection, PublicKey } from "@solana/web3.js"

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables")
}

if (!process.env.RPC_URL) {
  throw new Error("Missing RPC_URL environment variable")
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// In-memory cache with token data and timestamps
const tokenCache = new Map<string, {
  data: any,
  timestamp: number
}>();

// Cache duration in milliseconds (1 second)
const CACHE_DURATION = 1000;

export async function GET(
  req: Request,
  { params }: { params: { walletaddress: string } }
) {
  try {
    const mintAddress = params.walletaddress
    if (!mintAddress) {
      return NextResponse.json({ error: "Mint address is required" }, { status: 400 })
    }

    // Check in-memory cache first
    const now = Date.now();
    const cachedEntry = tokenCache.get(mintAddress);
    if (cachedEntry && (now - cachedEntry.timestamp) < CACHE_DURATION) {
      logger.info("Returning cached token data", {
        mintAddress,
        cacheAge: `${now - cachedEntry.timestamp}ms`
      });
      return NextResponse.json(cachedEntry.data);
    }

    // If not in cache or cache expired, get from database
    const { data: cachedData, error: cacheError } = await supabase
      .from('meteora_pool_stats')
      .select('data')
      .eq('mint_address', mintAddress)
      .single()

    // Get the agent data for price change
    const { data: agent, error: agentError } = await supabase
      .from('web3agents')
      .select('current_price, market_cap, volume_24h')
      .eq('mint_address', mintAddress)
      .single()

    let responseData;
    if (!cacheError && cachedData?.data) {
      const { stats } = cachedData.data
      if (stats) {
        responseData = {
          price: stats.price,
          volume24h: stats.volume24h,
          market_cap: agent?.market_cap || stats.volume24h, // Use agent's market cap if available
          price_change_24h: stats.price_change_24h || 0
        };
      }
    } else if (agent) {
      // Fallback to agent data if no pool stats
      responseData = {
        price: agent.current_price || 0,
        volume24h: agent.volume_24h || 0,
        market_cap: agent.market_cap || 0,
        price_change_24h: 0
      };
    } else {
      responseData = {
        price: 0,
        volume24h: 0,
        market_cap: 0,
        price_change_24h: 0
      };
    }

    // Update in-memory cache
    tokenCache.set(mintAddress, {
      data: responseData,
      timestamp: now
    });

    // Clean up old cache entries periodically
    if (Math.random() < 0.1) { // 10% chance to clean up on each request
      const cleanupTime = now - CACHE_DURATION;
      Array.from(tokenCache.entries()).forEach(([key, value]) => {
        if (value.timestamp < cleanupTime) {
          tokenCache.delete(key);
        }
      });
    }

    return NextResponse.json(responseData);

  } catch (error) {
    logger.error("Error in market-stats endpoint", error as Error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
} 