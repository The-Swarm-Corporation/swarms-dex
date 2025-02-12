import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { PublicKey } from "@solana/web3.js"
import { deriveCustomizablePermissionlessConstantProductPoolAddress, createProgram } from "@mercurial-finance/dynamic-amm-sdk/dist/cjs/src/amm/utils"
import { parseSwapTransaction } from "@/app/api/solana/meteora/transactions/route"
import { getRPCClient } from "@/lib/rpc/config"

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
const rpcClient = getRPCClient()
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

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

    logger.info("Fetching fresh market data", {
      mintAddress: tokenMint.toString(),
      timestamp: new Date().toISOString()
    })

    try {
      const connection = rpcClient.getConnection()
      
      const poolKey = deriveCustomizablePermissionlessConstantProductPoolAddress(
        tokenMint,
        swarmsMint,
        createProgram(connection).ammProgram.programId,
      )

      logger.info("Derived pool address", {
        mintAddress: tokenMint.toString(),
        poolAddress: poolKey.toString()
      })

      // Get pool info with LOW priority since it's market data
      const poolInfo = await rpcClient.getParsedAccountInfo(poolKey, 'LOW')
      if (!poolInfo.value) {
        logger.info("No pool found", {
          mintAddress: tokenMint.toString(),
          poolAddress: poolKey.toString()
        })
        return null
      }

      // Create Meteora pair with LOW priority since it's market data
      const amm = await rpcClient.createMeteoraPair(poolKey, 'LOW')
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

      // Get total supply for market cap calculation
      const mintInfo = await rpcClient.getParsedAccountInfo(tokenMint, 'LOW')
      const totalSupply = mintInfo.value && 'parsed' in mintInfo.value.data 
        ? Number(mintInfo.value.data.parsed.info.supply) / Math.pow(10, mintInfo.value.data.parsed.info.decimals)
        : 0

      logger.info("Supply info", {
        mintAddress: tokenMint.toString(),
        totalSupply,
        poolLiquidity: tokenBalance,
        decimals: mintInfo.value && 'parsed' in mintInfo.value.data ? mintInfo.value.data.parsed.info.decimals : 0
      })

      // Calculate price in the same format as Meteora's swap price
      // Price = SWARMS amount / token amount (matching transaction price calculation)
      const priceInSwarms = tokenBalance > 0 ? swarmsBalance / tokenBalance : 0 
      const swarmsPrice = await fetchSwarmsPrice() ?? 1 // Fallback to 1 if price fetch fails
      let tokenPrice = priceInSwarms * swarmsPrice // Price in USD

      // Get recent transactions with LOW priority
      const transactions = await getRecentTransactions(
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
          apy,
          totalSupply,
          poolLiquidity: tokenBalance,
          marketCap: totalSupply * tokenPrice // Calculate market cap using total supply
        },
        transactions: transactions // Return raw transaction prices in SWARMS
      }

      logger.info("Market data calculation details", {
        mintAddress: tokenMint.toString(),
        price: tokenPrice,
        totalSupply,
        poolLiquidity: tokenBalance,
        marketCap: totalSupply * tokenPrice,
        calculation: `Market Cap = ${totalSupply} * ${tokenPrice}`
      })

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
    } catch (error) {
      logger.error("Failed to fetch market data", error instanceof Error ? error : new Error('Unknown error'))
      throw error
    }
}

async function getRecentTransactions(
  poolKey: PublicKey, 
  tokenMint: PublicKey, 
  swarmsMint: PublicKey,
  vaultAddresses: {
    tokenVaultAddress: string,
    swarmsVaultAddress: string
  }
) {
  // First try to get cached transactions from database
  const { data: cachedTransactions, error: cacheError } = await supabase
    .from('meteora_individual_transactions')
    .select('*')
    .eq('mint_address', tokenMint.toString())
    .order('timestamp', { ascending: false })
    .limit(100)

  let existingTransactions: Array<{
    signature: string
    price: number
    size: number
    side: 'buy' | 'sell'
    timestamp: number
  }> = []

  // Create a Set of existing signatures for quick lookup
  const existingSignatures = new Set<string>()

  if (!cacheError && cachedTransactions) {
    existingTransactions = cachedTransactions.map(tx => ({
      signature: tx.signature,
      price: tx.price || 0,
      size: tx.size || 0,
      side: tx.side as 'buy' | 'sell',
      timestamp: tx.timestamp
    })).filter(tx => tx.price && tx.size) // Only include valid transactions

    // Add all existing signatures to the Set
    existingTransactions.forEach(tx => existingSignatures.add(tx.signature))

    if (existingTransactions.length > 0) {
      logger.info("Found cached transactions", {
        count: existingTransactions.length,
        mintAddress: tokenMint.toString(),
        mostRecent: new Date(existingTransactions[0].timestamp).toISOString()
      })
    }
  }

  try {
    // First get total signature count to know if we need to fetch more
    const totalSignatures = await rpcClient.getSignaturesForAddress(
      poolKey,
      { limit: 1 },
      'LOW'
    )

    if (totalSignatures.length === 0) {
      logger.info("No transactions found", {
        mintAddress: tokenMint.toString(),
        poolAddress: poolKey.toString()
      })
      return existingTransactions
    }

    // If the most recent signature matches our cache, we have everything
    if (existingTransactions.length > 0 && totalSignatures[0].signature === existingTransactions[0].signature) {
      logger.info("Already have latest transactions", {
        mintAddress: tokenMint.toString(),
        poolAddress: poolKey.toString(),
        latestSignature: totalSignatures[0].signature
      })
      return existingTransactions
    }

    // Get recent signatures with LOW priority
    const signatures = await rpcClient.getSignaturesForAddress(
      poolKey,
      { limit: 20 },
      'LOW'
    )

    // Filter out signatures we already have
    const newSignatures = signatures.filter(sig => !existingSignatures.has(sig.signature))

    if (newSignatures.length === 0) {
      logger.info("No new transactions to process", {
        mintAddress: tokenMint.toString(),
        poolAddress: poolKey.toString(),
        cachedCount: existingTransactions.length
      })
      return existingTransactions
    }

    logger.info("Found new signatures", {
      count: newSignatures.length,
      poolAddress: poolKey.toString(),
      firstNew: newSignatures[0].signature,
      lastNew: newSignatures[newSignatures.length - 1].signature,
      existingCount: existingTransactions.length
    })

    // Batch fetch parsed transactions with LOW priority
    const parsedTransactions = await rpcClient.getParsedTransactions(
      newSignatures.map(sig => sig.signature),
      {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed'
      },
      'LOW'
    )

    // Process new transactions using the shared parser
    const newTransactions = []
    for (let i = 0; i < parsedTransactions.length; i++) {
      const tx = parsedTransactions[i]
      const sig = newSignatures[i]
      
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
        
        // Save non-swap transaction
        await supabase
          .from('meteora_individual_transactions')
          .upsert({
            mint_address: tokenMint.toString(),
            signature: sig.signature,
            price: null,
            size: null,
            side: null,
            timestamp: sig.blockTime ? sig.blockTime * 1000 : Date.now(),
            is_swap: false,
            updated_at: new Date().toISOString()
          })
        
        continue
      }

      const transaction = {
        ...swapDetails,
        timestamp: sig.blockTime ? sig.blockTime * 1000 : Date.now()
      }

      // Double check we don't already have this transaction
      if (!existingSignatures.has(transaction.signature)) {
        // Save swap transaction
        await supabase
          .from('meteora_individual_transactions')
          .upsert({
            mint_address: tokenMint.toString(),
            signature: transaction.signature,
            price: transaction.price,
            size: transaction.size,
            side: transaction.side,
            timestamp: transaction.timestamp,
            is_swap: true,
            updated_at: new Date().toISOString()
          })

        newTransactions.push(transaction)
        existingSignatures.add(transaction.signature)
      }
    }

    // Merge new transactions with existing ones and sort
    const allTransactions = [...newTransactions, ...existingTransactions]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 100) // Keep only the 100 most recent transactions

    logger.info("Transaction update complete", {
      mintAddress: tokenMint.toString(),
      newTransactions: newTransactions.length,
      totalTransactions: allTransactions.length,
      timestamp: new Date().toISOString()
    })

    return allTransactions
  } catch (error) {
    logger.error("Failed to fetch transactions", error instanceof Error ? error : new Error('Unknown error'))
    throw error
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
          current_supply: marketData.stats.totalSupply,
          market_cap: marketData.stats.marketCap,
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