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

export async function GET(
  req: Request,
  { params }: { params: { mintAddress: string } }
) {
  try {
    const mintAddress = params.mintAddress
    if (!mintAddress || mintAddress === 'undefined') {
      logger.error("Invalid mint address provided", new Error("Invalid mint address"))
      return NextResponse.json({ error: "Valid mint address is required" }, { status: 400 })
    }

    logger.info("Fetching token details", { mintAddress })

    // First check if the token exists
    const { count, error: countError } = await supabase
      .from("web3agents")
      .select('*', { count: 'exact', head: true })
      .eq("mint_address", mintAddress)

    if (countError) {
      logger.error("Error checking token existence", countError)
      return NextResponse.json(
        { error: "Failed to check token", details: countError.message },
        { status: 500 }
      )
    }

    if (count === 0) {
      logger.info("Token not found", { mintAddress })
      return NextResponse.json({ error: "Token not found" }, { status: 404 })
    }

    // Now fetch the full token details
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
      .eq("mint_address", mintAddress)
      .limit(1)
      .single()

    if (dbError) {
      logger.error("Database error while fetching token", dbError)
      return NextResponse.json(
        { error: "Failed to fetch token", details: dbError.message },
        { status: 500 }
      )
    }

    // Process and format the data
    const latestPrice = data.prices?.[0]
    const previousPrice = data.prices?.[1]
    const priceChange =
      latestPrice && previousPrice
        ? ((latestPrice.price - previousPrice.price) / previousPrice.price) * 100
        : 0

    const formattedData = {
      ...data,
      current_price: latestPrice?.price || 0,
      price_change_24h: priceChange,
      volume_24h: latestPrice?.volume_24h || 0,
      market_cap: latestPrice?.market_cap || 0,
    }

    logger.info("Successfully fetched token details", {
      mintAddress,
      tokenId: data.id
    })

    return NextResponse.json(formattedData)
  } catch (error) {
    const err = error as Error
    logger.error("Error in GET /api/tokens/[mintAddress]", err)
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500 }
    )
  }
} 