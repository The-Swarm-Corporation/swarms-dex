import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { Connection, PublicKey } from "@solana/web3.js"
import { MeteoraService } from "@/lib/meteora/service"

// Check if required environment variables are set
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable")
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable")
}
if (!process.env.RPC_URL) {
  throw new Error("Missing RPC_URL environment variable")
}
if (!process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS) {
  throw new Error("Missing NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS environment variable")
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const connection = new Connection(process.env.RPC_URL)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

// Utility function to safely create PublicKey
function createPublicKey(value: string): PublicKey | null {
  try {
    return new PublicKey(value)
  } catch (error) {
    return null
  }
}

export async function GET(
  req: Request,
  { params }: { params: { walletaddress: string } }
) {
  try {
    const mintAddress = params.walletaddress
    if (!mintAddress || mintAddress === 'undefined') {
      logger.error("Invalid mint address provided", new Error("Invalid mint address"))
      return NextResponse.json({ error: "Valid mint address is required" }, { status: 400 })
    }

    logger.info("Fetching agent details", { mintAddress })

    // First check if the token exists
    const { count, error: countError } = await supabase
      .from("web3agents")
      .select('*', { count: 'exact', head: true })
      .eq("mint_address", mintAddress)

    if (countError) {
      logger.error("Error checking agent existence", countError)
      return NextResponse.json(
        { error: "Failed to check agent", details: countError.message },
        { status: 500 }
      )
    }

    if (count === 0) {
      logger.info("Agent not found", { mintAddress })
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }

    // Now fetch the full agent details
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
      logger.error("Database error while fetching agent", dbError)
      return NextResponse.json(
        { error: "Failed to fetch agent", details: dbError.message },
        { status: 500 }
      )
    }

    // Fetch Meteora pool data
    try {
      const meteoraService = new MeteoraService(connection)
      const tokenMint = createPublicKey(mintAddress)
      const swarmsMint = createPublicKey(process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS!)

      if (!tokenMint || !swarmsMint) {
        throw new Error("Invalid mint address")
      }

      const pool = await meteoraService.getPoolByTokens(tokenMint, swarmsMint) ||
                  await meteoraService.getPoolByTokens(swarmsMint, tokenMint)

      if (pool) {
        // Calculate price from pool reserves (token price in SWARMS)
        const tokenABalance = Number(pool.tokenABalance)
        const tokenBBalance = Number(pool.tokenBBalance)
        const priceInSwarms = tokenBBalance > 0 ? tokenABalance / tokenBBalance : 0

        // TODO: Get SWARMS price in USD from another source to calculate USD values
        const swarmsPrice = 1 // Placeholder: 1 SWARMS = $1 USD
        const price = priceInSwarms * swarmsPrice

        // Calculate basic stats
        const tvl = price * tokenABalance * 2 // multiply by 2 since it's both sides of the pool
        const volume24h = tvl * 0.1 // estimate as 10% of TVL for now

        // Update token price in web3agents table
        const { error: updateError } = await supabase
          .from('web3agents')
          .update({
            current_price: price,
            market_cap: tvl,
            volume_24h: volume24h,
            pool_address: pool.address.toString(),
            updated_at: new Date().toISOString()
          })
          .eq('mint_address', mintAddress)

        if (updateError) {
          logger.error("Failed to update agent with pool data", updateError)
        }

        // Add pool data to response
        data.current_price = price
        data.market_cap = tvl
        data.volume_24h = volume24h
        data.pool_address = pool.address.toString()
        data.price_change_24h = 0 // We'll need to implement this with historical data
      }
    } catch (error) {
      logger.error("Error fetching Meteora data", error as Error)
      // Continue with the response even if Meteora data fetch fails
    }

    logger.info("Successfully fetched agent details", {
      mintAddress,
      tokenId: data.id
    })

    return NextResponse.json(data)
  } catch (error) {
    const err = error as Error
    logger.error("Error in GET /api/agent/[walletaddress]", err)
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500 }
    )
  }
} 