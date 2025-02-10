import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { Connection, PublicKey } from "@solana/web3.js"
import { rpcRouter } from "@/lib/rpc/router"
import { deriveCustomizablePermissionlessConstantProductPoolAddress, createProgram } from "@mercurial-finance/dynamic-amm-sdk/dist/cjs/src/amm/utils"
import AmmImpl from "@mercurial-finance/dynamic-amm-sdk"
import { parseSwapTransaction } from "@/app/api/solana/meteora/transactions/route"

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

async function fetchSwarmsPrice() {
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=swarms&vs_currencies=usd',
      { next: { revalidate: 60 } } // Cache for 1 minute
    );
    const data = await response.json();
    return data.swarms.usd;
  } catch (error) {
    logger.error('Failed to fetch SWARMS price from CoinGecko', error as Error);
    return null;
  }
}

async function getMarketData(tokenMint: PublicKey, swarmsMint: PublicKey) {
    // Try to get cached data first
    const { data: cachedData, error: cacheError } = await supabase
      .from('meteora_pool_stats')
      .select('*')
      .eq('mint_address', tokenMint.toString())
      .single()

    logger.info("Cache check result", {
      hasCachedData: !!cachedData,
      cacheError: cacheError?.message,
      cacheAge: cachedData ? `${Math.round((Date.now() - new Date(cachedData.updated_at).getTime()) / 1000)}s` : 'no cache',
      mintAddress: tokenMint.toString()
    })

    if (!cacheError && cachedData) {
      const cacheAge = Date.now() - new Date(cachedData.updated_at).getTime()
      if (cacheAge < 60 * 1000) { // 1 minute cache
        logger.info("Using cached market data", {
          mintAddress: tokenMint.toString(),
          cacheAge: `${Math.round(cacheAge / 1000)}s`,
          stats: cachedData.data.stats,
          poolAddress: cachedData.data.pool.address,
          lastUpdate: new Date(cachedData.updated_at).toISOString()
        })
        return cachedData.data
      }
    }

  return await rpcRouter.withRetry(async (connection) => {
    logger.info("Fetching fresh market data", {
      mintAddress: tokenMint.toString(),
      timestamp: new Date().toISOString()
    })

    const poolKey = deriveCustomizablePermissionlessConstantProductPoolAddress(
      tokenMint,
      swarmsMint,
      createProgram(connection).ammProgram.programId,
    )

    logger.info("Derived pool address", {
      mintAddress: tokenMint.toString(),
      poolAddress: poolKey.toString()
    })

    const poolInfo = await connection.getAccountInfo(poolKey)
    if (!poolInfo) {
      logger.info("No pool found", {
        mintAddress: tokenMint.toString(),
        poolAddress: poolKey.toString()
      })
      return null
    }

    const amm = await AmmImpl.create(connection, poolKey)
    await amm.updateState()
    const pool = amm.poolState

    if (!pool) {
      throw new Error("Failed to get pool state")
    }

    // Determine which vault is which by checking the mint addresses
    const isTokenVaultA = pool.tokenAMint.toString() === tokenMint.toString()
    const tokenDecimals = 6 // Standard Solana token decimals
    const tokenBalance = Number(isTokenVaultA ? pool.aVaultLp : pool.bVaultLp) / Math.pow(10, tokenDecimals)
    const swarmsBalance = Number(isTokenVaultA ? pool.bVaultLp : pool.aVaultLp) / Math.pow(10, tokenDecimals)
    const tokenVaultAddress = isTokenVaultA ? pool.aVault.toString() : pool.bVault.toString()
    const swarmsVaultAddress = isTokenVaultA ? pool.bVault.toString() : pool.aVault.toString()

    logger.info("Pool vaults identified", {
      poolAddress: poolKey.toString(),
      tokenVaultAddress,
      swarmsVaultAddress,
      tokenVaultLp: isTokenVaultA ? pool.aVaultLp.toString() : pool.bVaultLp.toString(),
      swarmsVaultLp: isTokenVaultA ? pool.bVaultLp.toString() : pool.aVaultLp.toString(),
      isTokenVaultA,
      tokenMint: tokenMint.toString(),
      swarmsMint: swarmsMint.toString(),
      poolTokenAMint: pool.tokenAMint.toString(),
      poolTokenBMint: pool.tokenBMint.toString()
    })

    // Calculate price in the same format as Meteora's swap price
    // Price = SWARMS amount / token amount (matching transaction price calculation)
    const priceInSwarms = tokenBalance > 0 ? swarmsBalance / tokenBalance : 0 
    const swarmsPrice = await fetchSwarmsPrice() ?? 1 // Fallback to 1 if price fetch fails
    let tokenPrice = priceInSwarms * swarmsPrice // Price in USD

    // Fetch recent transactions with vault addresses
    const transactions = await getRecentTransactions(
      connection, 
      poolKey, 
      tokenMint, 
      swarmsMint,
      {
        tokenVaultAddress,
        swarmsVaultAddress
      }
    )

    // Validate price against recent transactions
    if (transactions.length > 0) {
      const recentTxPrice = transactions[0].price * swarmsPrice
      logger.info("Price validation", {
        calculatedPrice: tokenPrice,
        recentTxPrice,
        difference: Math.abs(tokenPrice - recentTxPrice),
        percentDiff: Math.abs((tokenPrice - recentTxPrice) / recentTxPrice) * 100,
        calculation: {
          pool: `(${swarmsBalance} / ${tokenBalance}) * ${swarmsPrice}`,
          transaction: `(${transactions[0].price}) * ${swarmsPrice}`
        }
      })

      // If pool price seems off compared to transactions, use tx price
      if (tokenPrice === 0 || Math.abs((tokenPrice - recentTxPrice) / recentTxPrice) > 0.1) { // 10% difference threshold
        tokenPrice = recentTxPrice
        logger.info("Using transaction price instead of pool price", {
          reason: tokenPrice === 0 ? "Pool price is zero" : "Large price difference",
          poolPrice: tokenPrice,
          txPrice: recentTxPrice,
          poolCalculation: `(${swarmsBalance} / ${tokenBalance}) * ${swarmsPrice}`,
          txCalculation: `${transactions[0].price} * ${swarmsPrice}`
        })
      }
    }

    logger.info("Price calculation details", {
      poolBalances: {
        token: tokenBalance,
        swarms: swarmsBalance
      },
      priceCalculation: {
        priceInSwarms,
        swarmsPrice,
        tokenPrice,
        formula: `(${swarmsBalance} / ${tokenBalance}) * ${swarmsPrice}`
      },
      transactions: transactions.slice(0, 3).map(tx => ({
        price: tx.price * swarmsPrice,
        size: tx.size,
        timestamp: new Date(tx.timestamp).toISOString()
      }))
    })

    logger.info("Using SWARMS price from CoinGecko", { swarmsPrice })

    // Calculate 24h volume from transactions
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
    const volume24h = transactions
      .filter(tx => tx.timestamp > oneDayAgo)
      .reduce((sum, tx) => sum + (tx.price * tx.size * swarmsPrice), 0)

    // Calculate APY based on fees and volume
    const tradeFeePercent = Number(pool.fees.tradeFeeNumerator) / 10000
    const dailyFees = volume24h * tradeFeePercent
    const yearlyFeesEstimate = dailyFees * 365
    const apy = volume24h > 0 ? (yearlyFeesEstimate / volume24h) * 100 : 0

    logger.info("Calculated pool stats", {
      mintAddress: tokenMint.toString(),
      poolAddress: poolKey.toString(),
      tokenBalance,
      swarmsBalance,
      priceInSwarms,
      tokenPrice,
      volume24h,
      apy,
      fees: {
        tradeFee: tradeFeePercent,
        ownerTradeFee: Number(pool.fees.protocolTradeFeeNumerator) / 10000,
      }
    })

    const marketData = {
      pool: {
        address: poolKey.toString(),
        tokenMint: tokenMint.toString(),
        swarmsMint: swarmsMint.toString(),
        tokenBalance: tokenBalance.toString(),
        swarmsBalance: swarmsBalance.toString(),
        fees: {
          tradeFee: tradeFeePercent,
          ownerTradeFee: Number(pool.fees.protocolTradeFeeNumerator) / 10000,
        },
      },
      stats: {
        price: tokenPrice,
        priceInSwarms,
        volume24h,
        apy
      },
      transactions: transactions // Return raw transaction prices in SWARMS
    }

    // Update cache
    const cacheUpdate = await supabase
      .from('meteora_pool_stats')
      .upsert({
        mint_address: tokenMint.toString(),
        data: marketData,
        updated_at: new Date().toISOString()
      })

    logger.info("Cache update result", {
      mintAddress: tokenMint.toString(),
      success: !cacheUpdate.error,
      error: cacheUpdate.error?.message,
      timestamp: new Date().toISOString()
    })

    return marketData
  })
}

async function getRecentTransactions(
  connection: Connection, 
  poolKey: PublicKey, 
  tokenMint: PublicKey, 
  swarmsMint: PublicKey,
  vaultAddresses: {
    tokenVaultAddress: string,
    swarmsVaultAddress: string
  }
) {
  // Get recent signatures with retries
  const signatures = await rpcRouter.withRetry(async () => {
    return await connection.getSignaturesForAddress(
      poolKey,
      { limit: 10 },
      'confirmed'
    )
  })

  logger.info("Found recent signatures", {
    count: signatures.length,
    poolAddress: poolKey.toString()
  })

  // Batch fetch parsed transactions
  const parsedTransactions = await rpcRouter.withRetry(async () => {
    return await connection.getParsedTransactions(
      signatures.map(sig => sig.signature),
      {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed'
      }
    )
  })

  // Process transactions using the shared parser
  const transactions = []
  for (let i = 0; i < parsedTransactions.length; i++) {
    const tx = parsedTransactions[i]
    const sig = signatures[i]
    
    if (!tx) {
      logger.info("Skipping transaction - not found", { signature: sig.signature })
      continue
    }

    // Use the shared transaction parser
    const swapDetails = parseSwapTransaction(tx, tokenMint, swarmsMint, {
      tokenVault: vaultAddresses.tokenVaultAddress,
      swarmsVault: vaultAddresses.swarmsVaultAddress
    })

    if (!swapDetails) {
      logger.info("Skipping transaction - not a valid swap", { signature: sig.signature })
      continue
    }

    transactions.push({
      ...swapDetails,
      timestamp: sig.blockTime ? sig.blockTime * 1000 : Date.now()
    })
  }

  return transactions.sort((a, b) => b.timestamp - a.timestamp)
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
    const { data: agent, error: dbError } = await supabase
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

    // Get market data
    const tokenMint = new PublicKey(mintAddress)
    const swarmsMint = new PublicKey(process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS!)
    const marketData = await getMarketData(tokenMint, swarmsMint)

    if (marketData) {
      agent.market = marketData
      // Update agent with latest price data
      const agentUpdate = await supabase
        .from('web3agents')
        .update({
          current_price: marketData.stats.price,
          market_cap: marketData.stats.volume24h,
          volume_24h: marketData.stats.volume24h,
          pool_address: marketData.pool.address,
          updated_at: new Date().toISOString()
        })
        .eq('mint_address', mintAddress)

      logger.info("Agent update result", {
        mintAddress,
        success: !agentUpdate.error,
        error: agentUpdate.error?.message,
        newPrice: marketData.stats.price,
        newVolume: marketData.stats.volume24h,
        timestamp: new Date().toISOString()
      })
    }

    logger.info("Successfully fetched agent details", {
      mintAddress,
      tokenId: agent.id
    })

    // Add cache headers
    const headers = new Headers()
    headers.set('Cache-Control', 'public, s-maxage=60')
    headers.set('CDN-Cache-Control', 'public, s-maxage=60')
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=60')

    return NextResponse.json(agent, { headers })
  } catch (error) {
    const err = error as Error
    logger.error("Error in GET /api/agent/[walletaddress]", err)
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500 }
    )
  }
} 