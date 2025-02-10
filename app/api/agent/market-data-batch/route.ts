import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables")
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// In-memory cache with token data and timestamps
const batchCache = new Map<string, {
  data: any,
  timestamp: number
}>();

// Cache duration in milliseconds (1 second)
const CACHE_DURATION = 1000;

export async function POST(req: Request) {
  try {
    const { mintAddresses } = await req.json()
    
    if (!Array.isArray(mintAddresses) || mintAddresses.length === 0) {
      return NextResponse.json({ error: "Invalid mint addresses" }, { status: 400 })
    }

    // Create cache key from sorted addresses
    const cacheKey = mintAddresses.sort().join(',')
    
    // Check cache first
    const now = Date.now()
    const cachedEntry = batchCache.get(cacheKey)
    if (cachedEntry && (now - cachedEntry.timestamp) < CACHE_DURATION) {
      logger.info("Returning cached batch data", {
        addressCount: mintAddresses.length,
        cacheAge: `${now - cachedEntry.timestamp}ms`
      })
      return NextResponse.json(cachedEntry.data)
    }

    // Fetch both pool stats and agent data in parallel
    const [poolStats, agentData] = await Promise.all([
      supabase
        .from('meteora_pool_stats')
        .select('mint_address, data')
        .in('mint_address', mintAddresses),
      supabase
        .from('web3agents')
        .select('mint_address, current_price, market_cap, volume_24h')
        .in('mint_address', mintAddresses)
    ])

    // Create a map for quick lookups
    const poolStatsMap = new Map(
      poolStats.data?.map(stat => [stat.mint_address, stat.data]) || []
    )
    const agentDataMap = new Map(
      agentData.data?.map(agent => [agent.mint_address, agent]) || []
    )

    // Combine data for each mint address
    const results: Record<string, any> = {}
    for (const mintAddress of mintAddresses) {
      const poolStat = poolStatsMap.get(mintAddress)
      const agent = agentDataMap.get(mintAddress)

      // First try to get data from pool stats
      if (poolStat?.data?.stats) {
        results[mintAddress] = {
          market: {
            stats: {
              price: poolStat.data.stats.price,
              volume24h: poolStat.data.stats.volume24h,
              apy: poolStat.data.stats.apy || 0
            }
          },
          price_change_24h: poolStat.data.stats.price_change_24h || 0,
          current_price: poolStat.data.stats.price,
          volume_24h: poolStat.data.stats.volume24h,
          market_cap: agent?.market_cap || poolStat.data.stats.volume24h
        }
      } 
      // If no pool stats but we have agent data
      else if (agent) {
        results[mintAddress] = {
          market: {
            stats: {
              price: agent.current_price || 0,
              volume24h: agent.volume_24h || 0,
              apy: 0
            }
          },
          price_change_24h: 0,
          current_price: agent.current_price || 0,
          volume_24h: agent.volume_24h || 0,
          market_cap: agent.market_cap || 0
        }
      }
      // If neither pool stats nor agent data, provide zeros
      else {
        results[mintAddress] = {
          market: {
            stats: {
              price: 0,
              volume24h: 0,
              apy: 0
            }
          },
          price_change_24h: 0,
          current_price: 0,
          volume_24h: 0,
          market_cap: 0
        }
      }

      // Log what data source we're using for debugging
      logger.info(`Market data for ${mintAddress}`, {
        source: poolStat?.data?.stats ? 'pool_stats' : agent ? 'agent_data' : 'default_zeros',
        price: results[mintAddress].market.stats.price,
        volume24h: results[mintAddress].market.stats.volume24h,
        market_cap: results[mintAddress].market_cap
      })
    }

    // Update cache
    batchCache.set(cacheKey, {
      data: results,
      timestamp: now
    })

    // Clean up old cache entries periodically
    if (Math.random() < 0.1) {
      const cleanupTime = now - CACHE_DURATION
      Array.from(batchCache.entries()).forEach(([key, value]) => {
        if (value.timestamp < cleanupTime) {
          batchCache.delete(key)
        }
      })
    }

    return NextResponse.json(results)

  } catch (error) {
    logger.error("Error in market-data-batch endpoint", error as Error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
} 