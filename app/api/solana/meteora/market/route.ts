import { NextResponse } from "next/server"
import { Connection, PublicKey } from "@solana/web3.js"
import { MeteoraService } from "@/lib/meteora/service"
import { logger } from "@/lib/logger"
import { createClient } from "@supabase/supabase-js"
import { deriveCustomizablePermissionlessConstantProductPoolAddress, createProgram } from "@mercurial-finance/dynamic-amm-sdk/dist/cjs/src/amm/utils"
import AmmImpl from "@mercurial-finance/dynamic-amm-sdk"

if (!process.env.RPC_URL) {
  throw new Error("Missing RPC_URL environment variable")
}

if (!process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS) {
  throw new Error("Missing NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS environment variable")
}

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables")
}

const connection = new Connection(process.env.RPC_URL)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const mintAddress = searchParams.get('mintAddress')
    const swarmsAddress = process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS

    if (!mintAddress || !swarmsAddress) {
      return NextResponse.json({ error: "Missing required addresses" }, { status: 400 })
    }

    // Try to get cached data first
    const [poolCache, txCache] = await Promise.all([
      supabase
        .from('meteora_pool_stats')
        .select('*')
        .eq('mint_address', mintAddress)
        .single(),
      supabase
        .from('meteora_transactions')
        .select('*')
        .eq('mint_address', mintAddress)
        .single()
    ])

    const now = Date.now()
    const cacheAge = 60 * 1000 // 1 minute cache

    // Check if we have valid cached data
    if (!poolCache.error && !txCache.error) {
      const poolCacheAge = now - new Date(poolCache.data.updated_at).getTime()
      const txCacheAge = now - new Date(txCache.data.updated_at).getTime()
      
      if (poolCacheAge < cacheAge && txCacheAge < cacheAge) {
        logger.info("Returning cached Meteora market data", { mintAddress })
        return NextResponse.json({
          pool: poolCache.data.data,
          transactions: txCache.data.data
        })
      }
    }

    // If we need fresh data, fetch everything
    const tokenMint = new PublicKey(mintAddress)
    const swarmsMint = new PublicKey(swarmsAddress)

    // Get pool data
    const meteoraService = new MeteoraService(connection)
    const poolKey = deriveCustomizablePermissionlessConstantProductPoolAddress(
      tokenMint,
      swarmsMint,
      createProgram(connection).ammProgram.programId,
    )

    // Get pool account info
    const poolInfo = await connection.getAccountInfo(poolKey)
    
    if (!poolInfo) {
      logger.info("No pool found for token", { mintAddress })
      return NextResponse.json({ error: "Pool not found" }, { status: 404 })
    }

    // Create AMM instance and get pool state
    const amm = await AmmImpl.create(connection, poolKey)
    await amm.updateState()
    const pool = amm.poolState

    if (!pool) {
      throw new Error("Failed to get pool state")
    }

    const tokenABalance = Number(pool.aVaultLp)
    const tokenBBalance = Number(pool.bVaultLp)
    const priceInSwarms = tokenBBalance > 0 ? tokenABalance / tokenBBalance : 0
    const swarmsPrice = 1 // Placeholder: 1 SWARMS = $1 USD
    const price = priceInSwarms * swarmsPrice
    const tvl = price * tokenABalance * 2
    const volume24h = tvl * 0.1
    const apy = amm.isStablePool ? 10 : 5

    const poolData = {
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
      stats: {
        volume24h,
        tvl,
        apy
      },
      price
    }

    // Get recent transactions
    const signatures = await connection.getSignaturesForAddress(
      poolKey,
      { limit: 5 },
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

        // Find relevant token balances
        const preTokenBalance = tx.meta.preTokenBalances.find(b => b.mint === tokenMint.toString())
        const postTokenBalance = tx.meta.postTokenBalances.find(b => b.mint === tokenMint.toString())
        const preSwarmsBalance = tx.meta.preTokenBalances.find(b => b.mint === swarmsMint.toString())
        const postSwarmsBalance = tx.meta.postTokenBalances.find(b => b.mint === swarmsMint.toString())

        if (!preTokenBalance?.uiTokenAmount || !postTokenBalance?.uiTokenAmount || 
            !preSwarmsBalance?.uiTokenAmount || !postSwarmsBalance?.uiTokenAmount) {
          return null
        }

        const tokenChange = (postTokenBalance.uiTokenAmount.uiAmount || 0) - (preTokenBalance.uiTokenAmount.uiAmount || 0)
        const swarmsChange = (postSwarmsBalance.uiTokenAmount.uiAmount || 0) - (preSwarmsBalance.uiTokenAmount.uiAmount || 0)

        logger.info("Checking swap", {
          tokenChange,
          swarmsChange,
          preToken: preTokenBalance.uiTokenAmount.uiAmount,
          postToken: postTokenBalance.uiTokenAmount.uiAmount,
          preSwarms: preSwarmsBalance.uiTokenAmount.uiAmount,
          postSwarms: postSwarmsBalance.uiTokenAmount.uiAmount
        })

        // Determine if it's a buy or sell based on token changes
        const isBuy = tokenChange > 0
        const isSell = tokenChange < 0

        // Skip if neither buy nor sell
        if (!isBuy && !isSell) {
          logger.info("Not a buy or sell transaction", { tokenChange, swarmsChange })
          return null
        }

        // Get the actual amounts using uiAmount which is already decimal adjusted
        const tokenAmount = Math.abs(tokenChange)
        const swarmsAmount = Math.abs(swarmsChange)

        // Calculate price: swarmsAmount/tokenAmount gives price in SWARMS per token
        const price = swarmsAmount / tokenAmount

        logger.info("Parsed swap", {
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
          timestamp: sig.blockTime ? sig.blockTime * 1000 : Date.now()
        }
      })
    )

    const validTransactions = transactions.filter(tx => tx !== null)

    // Update cache
    await Promise.all([
      supabase
        .from('meteora_pool_stats')
        .upsert({
          mint_address: mintAddress,
          data: poolData,
          updated_at: new Date().toISOString()
        }),
      supabase
        .from('meteora_transactions')
        .upsert({
          mint_address: mintAddress,
          data: validTransactions,
          updated_at: new Date().toISOString()
        })
    ])

    return NextResponse.json({
      pool: poolData,
      transactions: validTransactions
    })

  } catch (error) {
    logger.error("Error in market endpoint", error as Error)
    return NextResponse.json(
      { error: "Internal server error", details: (error as Error).message },
      { status: 500 }
    )
  }
} 