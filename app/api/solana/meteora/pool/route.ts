import { NextResponse } from "next/server"
import { Connection, PublicKey } from "@solana/web3.js"
import { MeteoraService } from "@/lib/meteora/service"
import { logger } from "@/lib/logger"
import { createClient } from "@supabase/supabase-js"
import AmmImpl from "@mercurial-finance/dynamic-amm-sdk"
import { deriveCustomizablePermissionlessConstantProductPoolAddress, createProgram } from "@mercurial-finance/dynamic-amm-sdk/dist/cjs/src/amm/utils"

if (!process.env.RPC_URL) {
  throw new Error("Missing RPC_URL environment variable")
}

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables")
}

if (!process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS) {
  throw new Error("Missing NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS environment variable")
}

const connection = new Connection(process.env.RPC_URL)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

// Utility function to safely create PublicKey
function createPublicKey(value: string): PublicKey | null {
  try {
    return new PublicKey(value)
  } catch (error) {
    return null
  }
}

export async function GET(
  req: Request
) {
  try {
    const { searchParams } = new URL(req.url)
    const mintAddress = searchParams.get('mintAddress')
    const swarmsAddress = process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS

    if (!mintAddress) {
      return NextResponse.json({ error: "Missing mintAddress parameter" }, { status: 400 })
    }

    if (!swarmsAddress) {
      return NextResponse.json({ error: "Missing SWARMS token configuration" }, { status: 500 })
    }

    // Try to get cached data first
    const { data: cachedData, error: cacheError } = await supabase
      .from('meteora_pool_stats')
      .select('*')
      .eq('mint_address', mintAddress)
      .single()

    if (!cacheError && cachedData) {
      const cacheAge = Date.now() - new Date(cachedData.updated_at).getTime()
      if (cacheAge < 60 * 1000) { // 1 minute cache
        logger.info("Returning cached Meteora pool data", { mintAddress })
        return NextResponse.json(cachedData.data)
      }
    }

    logger.info("Fetching fresh Meteora pool data", { mintAddress })

    // Validate mint addresses
    const tokenMint = createPublicKey(mintAddress)
    const swarmsMint = createPublicKey(swarmsAddress)

    if (!tokenMint || !swarmsMint) {
      const error = new Error("Invalid public key provided")
      logger.error(error.message, error)
      return NextResponse.json({ error: "Invalid mint address" }, { status: 400 })
    }

    const meteoraService = new MeteoraService(connection)
    
    // Derive the expected pool address first
    const poolKey = deriveCustomizablePermissionlessConstantProductPoolAddress(
      tokenMint,
      swarmsMint,
      createProgram(connection).ammProgram.programId,
    );

    // Get pool account info
    const poolInfo = await connection.getAccountInfo(poolKey);
    
    if (!poolInfo) {
      logger.info("No pool found for token", { mintAddress })
      return NextResponse.json({ error: "Pool not found" }, { status: 404 })
    }

    // Create AMM instance with the derived pool address
    const amm = await AmmImpl.create(connection, poolKey)

    // Get pool state
    await amm.updateState()

    // Access pool state directly from amm instance
    const pool = amm.poolState
    if (!pool) {
      throw new Error("Failed to get pool state")
    }

    const tokenABalance = Number(pool.aVaultLp)
    const tokenBBalance = Number(pool.bVaultLp)
    const priceInSwarms = tokenBBalance > 0 ? tokenABalance / tokenBBalance : 0

    // TODO: Get SWARMS price in USD from another source to calculate USD values
    const swarmsPrice = 1 // Placeholder: 1 SWARMS = $1 USD
    const price = priceInSwarms * swarmsPrice

    // Calculate basic stats
    const tvl = price * tokenABalance * 2 // multiply by 2 since it's both sides of the pool
    const volume24h = tvl * 0.1 // estimate as 10% of TVL for now
    const apy = amm.isStablePool ? 10 : 5 // higher APY for stable pools

    const stats = {
      volume24h,
      tvl,
      apy
    }

    // Prepare response data
    const responseData = {
      pool: {
        address: poolKey.toString(),
        tokenAMint: pool.tokenAMint.toString(),
        tokenBMint: pool.tokenBMint.toString(),
        tokenABalance: tokenABalance.toString(),
        tokenBBalance: tokenBBalance.toString(),
        fees: {
          tradeFee: Number(pool.fees.tradeFeeNumerator),
          ownerTradeFee: Number(pool.fees.protocolTradeFeeNumerator),
          ownerWithdrawFee: 0
        },
      },
      stats,
      price
    }

    // Update cache in database
    const { error: upsertError } = await supabase
      .from('meteora_pool_stats')
      .upsert({
        mint_address: mintAddress,
        data: responseData,
        updated_at: new Date().toISOString()
      })

    if (upsertError) {
      logger.error("Failed to update pool stats cache", upsertError)
    }

    return NextResponse.json(responseData)

  } catch (error) {
    logger.error("Error in Meteora pool endpoint", error as Error)
    return NextResponse.json(
      { error: "Failed to fetch pool data", details: (error as Error).message },
      { status: 500 }
    )
  }
} 