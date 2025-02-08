import { NextResponse } from "next/server"
import { PublicKey } from "@solana/web3.js"
import { MeteoraService } from "@/lib/meteora/service"
import { logger } from "@/lib/logger"
import { createClient } from "@supabase/supabase-js"
import { deriveCustomizablePermissionlessConstantProductPoolAddress, createProgram } from "@mercurial-finance/dynamic-amm-sdk/dist/cjs/src/amm/utils"
import AmmImpl from "@mercurial-finance/dynamic-amm-sdk"
import { rpcRouter } from "@/lib/rpc/router"

if (!process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS) {
  throw new Error("Missing NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS environment variable")
}

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables")
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const tokenMintAddress = searchParams.get('mintAddress')
    const swarmsAddress = process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS

    if (!tokenMintAddress || !swarmsAddress) {
      return NextResponse.json({ error: "Missing required addresses" }, { status: 400 })
    }

    // Add cache headers to prevent duplicate requests
    const headers = new Headers()
    headers.set('Cache-Control', 'public, s-maxage=60') // Cache for 60 seconds
    headers.set('CDN-Cache-Control', 'public, s-maxage=60')
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=60')

    // Try to get cached data first
    const { data: cachedData, error: cacheError } = await supabase
      .from('meteora_pool_stats')
      .select('*')
      .eq('mint_address', tokenMintAddress)
      .single()

    if (!cacheError && cachedData) {
      const cacheAge = Date.now() - new Date(cachedData.updated_at).getTime()
      if (cacheAge < 60 * 1000) { // 1 minute cache
        logger.info("Returning cached Meteora market data", { tokenMintAddress })
        return NextResponse.json(cachedData.data, { headers })
      }
    }

    // Initialize PublicKeys
    const tokenMint = new PublicKey(tokenMintAddress)
    const swarmsMint = new PublicKey(swarmsAddress)

    return await rpcRouter.withRetry(async (connection) => {
      // Get pool address
      const poolKey = deriveCustomizablePermissionlessConstantProductPoolAddress(
        tokenMint,
        swarmsMint,
        createProgram(connection).ammProgram.programId,
      )

      // Get pool account info
      const poolInfo = await connection.getAccountInfo(poolKey)
      
      if (!poolInfo) {
        logger.info("No pool found for token", { tokenMintAddress })
        return NextResponse.json({ error: "Pool not found" }, { status: 404 })
      }

      // Create AMM instance and get pool state
      const amm = await AmmImpl.create(connection, poolKey)
      await amm.updateState()
      const pool = amm.poolState

      if (!pool) {
        throw new Error("Failed to get pool state")
      }

      // Get pool balances and calculate price
      const tokenBalance = Number(pool.aVaultLp)
      const swarmsBalance = Number(pool.bVaultLp)
      const priceInSwarms = swarmsBalance > 0 ? tokenBalance / swarmsBalance : 0
      const swarmsPrice = 1 // TODO: Get actual SWARMS price in USD
      const tokenPrice = priceInSwarms * swarmsPrice

      // Calculate pool stats
      const tvl = tokenPrice * tokenBalance * 2 // multiply by 2 since it's both sides
      const volume24h = tvl * 0.1 // TODO: Calculate actual 24h volume from transactions
      const apy = amm.isStablePool ? 10 : 5 // TODO: Calculate actual APY

      // Get recent transactions
      const signatures = await connection.getSignaturesForAddress(
        poolKey,
        { limit: 10 },
        'confirmed'
      )

      const transactions = await Promise.all(
        signatures.map(async (sig) => {
          const tx = await connection.getParsedTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0
          })
          
          if (!tx?.meta?.postTokenBalances || !tx?.meta?.preTokenBalances) {
            return null
          }

          // Find token balances for both sides of the swap
          const preTokenBalance = tx.meta.preTokenBalances.find(b => b.mint === tokenMintAddress)
          const postTokenBalance = tx.meta.postTokenBalances.find(b => b.mint === tokenMintAddress)
          const preSwarmsBalance = tx.meta.preTokenBalances.find(b => b.mint === swarmsAddress)
          const postSwarmsBalance = tx.meta.postTokenBalances.find(b => b.mint === swarmsAddress)

          if (!preTokenBalance?.uiTokenAmount || !postTokenBalance?.uiTokenAmount || 
              !preSwarmsBalance?.uiTokenAmount || !postSwarmsBalance?.uiTokenAmount) {
            return null
          }

          // Calculate changes in balances
          const tokenChange = (postTokenBalance.uiTokenAmount.uiAmount || 0) - (preTokenBalance.uiTokenAmount.uiAmount || 0)
          const swarmsChange = (postSwarmsBalance.uiTokenAmount.uiAmount || 0) - (preSwarmsBalance.uiTokenAmount.uiAmount || 0)

          // Skip if no significant changes
          if (Math.abs(tokenChange) < 0.000001 || Math.abs(swarmsChange) < 0.000001) {
            return null
          }

          // Determine trade direction and calculate price
          const isBuy = tokenChange > 0 // Buying token with SWARMS
          const tokenAmount = Math.abs(tokenChange)
          const swarmsAmount = Math.abs(swarmsChange)
          const price = swarmsAmount / tokenAmount // Price in SWARMS per token

          logger.info("Parsed trade", {
            side: isBuy ? 'buy' : 'sell',
            tokenAmount,
            swarmsAmount,
            price,
            signature: sig.signature
          })

          return {
            signature: sig.signature,
            price,
            size: tokenAmount,
            side: isBuy ? 'buy' : 'sell',
            swarmsAmount,
            timestamp: sig.blockTime ? sig.blockTime * 1000 : Date.now()
          }
        })
      )

      const validTransactions = transactions.filter(tx => tx !== null)

      // Prepare response data
      const marketData = {
        pool: {
          address: poolKey.toString(),
          tokenMint: tokenMintAddress,
          swarmsMint: swarmsAddress,
          tokenBalance: tokenBalance.toString(),
          swarmsBalance: swarmsBalance.toString(),
          fees: {
            tradeFee: Number(pool.fees.tradeFeeNumerator) / 10000, // Convert to percentage
            ownerTradeFee: Number(pool.fees.protocolTradeFeeNumerator) / 10000,
          },
        },
        stats: {
          price: tokenPrice,
          priceInSwarms,
          volume24h,
          tvl,
          apy
        },
        transactions: validTransactions
      }

      // Update cache
      await supabase
        .from('meteora_pool_stats')
        .upsert({
          mint_address: tokenMintAddress,
          data: marketData,
          updated_at: new Date().toISOString()
        })

      return NextResponse.json(marketData, { headers })
    })

  } catch (error) {
    logger.error("Error in market endpoint", error as Error)
    return NextResponse.json(
      { error: "Internal server error", details: (error as Error).message },
      { status: 500 }
    )
  }
} 