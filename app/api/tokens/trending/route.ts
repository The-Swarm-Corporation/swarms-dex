import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"

// Check if required environment variables are set
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable")
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable")
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const limit = parseInt(searchParams.get("limit") || "3")

    logger.info("Fetching trending tokens", { limit })

    // First get the agent IDs ordered by latest volume
    const { data: trendingIds, error: volumeError } = await supabase
      .from('agent_prices')
      .select('agent_id, volume_24h')
      .order('volume_24h', { ascending: false })
      .limit(limit)

    if (volumeError) {
      logger.error("Database error while fetching trending volumes", volumeError)
      return NextResponse.json(
        { error: "Failed to fetch trending volumes", details: volumeError.message },
        { status: 500 }
      )
    }

    if (!trendingIds?.length) {
      return NextResponse.json([])
    }

    // Then fetch the full agent details for these IDs
    const { data, error: dbError } = await supabase
      .from("web3agents")
      .select(`
        *,
        creator:creator_id(wallet_address),
        prices:agent_prices(
          price,
          volume_24h,
          market_cap,
          timestamp
        )
      `)
      .in('id', trendingIds.map(t => t.agent_id))

    if (dbError) {
      logger.error("Database error while fetching trending tokens", dbError)
      return NextResponse.json(
        { error: "Failed to fetch trending tokens", details: dbError.message },
        { status: 500 }
      )
    }

    if (!data) {
      return NextResponse.json({ error: "No data returned from database" }, { status: 404 })
    }

    // Process and format the data
    const formattedData = data.map((agent) => {
      const latestPrice = agent.prices?.[0]
      const previousPrice = agent.prices?.[1]
      const priceChange =
        latestPrice && previousPrice
          ? ((latestPrice.price - previousPrice.price) / previousPrice.price) * 100
          : 0

      return {
        ...agent,
        current_price: latestPrice?.price || 0,
        price_change_24h: priceChange,
        volume_24h: latestPrice?.volume_24h || 0,
        market_cap: latestPrice?.market_cap || 0,
      }
    })

    // Sort the formatted data to match the original volume ordering
    const orderedData = formattedData.sort((a, b) => b.volume_24h - a.volume_24h)

    logger.info("Successfully fetched trending tokens", {
      count: orderedData.length
    })

    return NextResponse.json(orderedData)
  } catch (error) {
    const err = error as Error
    logger.error("Error in GET /api/tokens/trending", err)
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500 }
    )
  }
} 