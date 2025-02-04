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
    const search = searchParams.get("search") || ""
    const limit = parseInt(searchParams.get("limit") || "50")
    const offset = parseInt(searchParams.get("offset") || "0")
    const orderBy = searchParams.get("orderBy") || "created_at"
    const isSwarm = searchParams.get("isSwarm") === "true"

    logger.info("Fetching tokens list", { limit, offset, search, isSwarm })

    let query = supabase
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

    if (search) {
      query = query.or(`name.ilike.%${search}%,token_symbol.ilike.%${search}%`)
    }

    if (orderBy === "volume") {
      query = query.order("volume_24h", { ascending: false })
    } else if (orderBy === "market_cap") {
      query = query.order("market_cap", { ascending: false })
    } else {
      query = query.order(orderBy, { ascending: false })
    }

    const { data, error: dbError } = await query.range(offset, offset + limit - 1)

    if (dbError) {
      logger.error("Database error while fetching tokens", dbError)
      return NextResponse.json(
        { error: "Failed to fetch tokens", details: dbError.message },
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

    logger.info("Successfully fetched tokens", {
      count: formattedData.length,
      hasSearch: !!search,
    })

    return NextResponse.json(formattedData)
  } catch (error) {
    const err = error as Error
    logger.error("Error in GET /api/tokens/list", err)
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500 }
    )
  }
} 