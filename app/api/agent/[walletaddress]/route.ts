import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { Connection, PublicKey } from "@solana/web3.js"
import { rpcRouter } from "@/lib/rpc/router"
import { deriveCustomizablePermissionlessConstantProductPoolAddress, createProgram } from "@mercurial-finance/dynamic-amm-sdk/dist/cjs/src/amm/utils"
import AmmImpl from "@mercurial-finance/dynamic-amm-sdk"

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

    if (!cacheError && cachedData) {
      const cacheAge = Date.now() - new Date(cachedData.updated_at).getTime()
      if (cacheAge < 60 * 1000) { // 1 minute cache
        logger.info("Using cached market data", {
          mintAddress: tokenMint.toString(),
          cacheAge: `${Math.round(cacheAge / 1000)}s`,
          stats: cachedData.data.stats,
          poolAddress: cachedData.data.pool.address
        })
        return cachedData.data
      }
    }

  return await rpcRouter.withRetry(async (connection) => {
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

    // Get vault addresses from pool state
    const tokenVaultAddress = pool.aVault.toString()
    const swarmsVaultAddress = pool.bVault.toString()

    logger.info("Pool vaults identified", {
      poolAddress: poolKey.toString(),
      tokenVaultAddress,
      swarmsVaultAddress,
      tokenVaultLp: pool.aVaultLp.toString(),
      swarmsVaultLp: pool.bVaultLp.toString()
    })

    const tokenBalance = Number(pool.aVaultLp)
    const swarmsBalance = Number(pool.bVaultLp)
    const priceInSwarms = swarmsBalance > 0 ? tokenBalance / swarmsBalance : 0
    const swarmsPrice = await fetchSwarmsPrice() ?? 1 // Fallback to 1 if price fetch fails
    const tokenPrice = priceInSwarms * swarmsPrice

    logger.info("Using SWARMS price from CoinGecko", { swarmsPrice })

    const tvl = tokenPrice * tokenBalance * 2
    const volume24h = tvl * 0.1 // TODO: Calculate actual 24h volume
    const apy = amm.isStablePool ? 10 : 5 // TODO: Calculate actual APY

    logger.info("Calculated pool stats", {
      mintAddress: tokenMint.toString(),
      poolAddress: poolKey.toString(),
      tokenBalance,
      swarmsBalance,
      priceInSwarms,
      tokenPrice,
      tvl,
      volume24h,
      apy,
      fees: {
        tradeFee: Number(pool.fees.tradeFeeNumerator) / 10000,
        ownerTradeFee: Number(pool.fees.protocolTradeFeeNumerator) / 10000,
      }
    })

    // Fetch recent transactions with vault addresses
    const transactions = await getRecentTransactions(
      connection, 
      poolKey, 
      tokenMint, 
      swarmsMint,
      {
        tokenVaultAddress: pool.aVault.toString(),
        swarmsVaultAddress: pool.bVault.toString()
      }
    )

    logger.info("Found recent signatures", {
      mintAddress: tokenMint.toString(),
      poolAddress: poolKey.toString(),
      count: transactions.length,
      transactions: transactions.map(tx => ({
        signature: tx.signature,
        blockTime: tx.timestamp ? new Date(tx.timestamp * 1000).toISOString() : 'unknown'
      }))
    })

    const marketData = {
      pool: {
        address: poolKey.toString(),
        tokenMint: tokenMint.toString(),
        swarmsMint: swarmsMint.toString(),
      tokenBalance: tokenBalance.toString(),
      swarmsBalance: swarmsBalance.toString(),
        fees: {
        tradeFee: Number(pool.fees.tradeFeeNumerator) / 10000,
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
    transactions: transactions
    }

    // Update cache
    await supabase
      .from('meteora_pool_stats')
      .upsert({
        mint_address: tokenMint.toString(),
        data: marketData,
        updated_at: new Date().toISOString()
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
  const { tokenVaultAddress, swarmsVaultAddress } = vaultAddresses
  // Get token decimals first
  const [tokenMintInfo, swarmsMintInfo] = await Promise.all([
    connection.getParsedAccountInfo(tokenMint),
    connection.getParsedAccountInfo(swarmsMint)
  ])

  if (!tokenMintInfo.value?.data || !swarmsMintInfo.value?.data) {
    throw new Error('Failed to fetch mint info')
  }

  const tokenDecimals = (tokenMintInfo.value.data as any).parsed.info.decimals
  const swarmsDecimals = (swarmsMintInfo.value.data as any).parsed.info.decimals

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

  // Process transactions
  const transactions = []
  for (let i = 0; i < parsedTransactions.length; i++) {
    const tx = parsedTransactions[i]
    const sig = signatures[i]
    
    if (!tx?.meta?.postTokenBalances || !tx?.meta?.preTokenBalances) {
      logger.info("Skipping transaction - no token balances", { 
        signature: sig.signature,
        rawTransaction: JSON.stringify(tx, null, 2)
      })
      continue
    }

    // Log raw transaction data for debugging
    logger.info("Raw transaction data", {
      signature: sig.signature,
      version: tx.version,
      signatures: tx.transaction.signatures,
      message: tx.transaction.message,
      accountKeys: tx.transaction.message.accountKeys,
      instructions: tx.transaction.message.instructions,
      recentBlockhash: tx.transaction.message.recentBlockhash,
      meta: {
        err: tx.meta.err,
        fee: tx.meta.fee,
        preBalances: tx.meta.preBalances,
        postBalances: tx.meta.postBalances,
        logMessages: tx.meta.logMessages,
        preTokenBalances: tx.meta.preTokenBalances,
        postTokenBalances: tx.meta.postTokenBalances,
      }
    })

    // Check if this is a swap transaction by looking for the swap instruction
    const isSwap = tx.meta.logMessages?.some(log => 
      log.includes('Program log: Instruction: Swap') || 
      log.includes('Program log: Instruction: SwapExactInput') ||
      log.includes('Program log: Instruction: SwapExactOutput')
    )

    if (!isSwap) {
      logger.info("Skipping transaction - not a swap", { 
        signature: sig.signature,
        logs: tx.meta.logMessages
      })
      continue
    }

    // Find token balances for both sides of the swap
    const preTokenBalance = tx.meta.preTokenBalances.find(b => b.mint === tokenMint.toString())
    const postTokenBalance = tx.meta.postTokenBalances.find(b => b.mint === tokenMint.toString())
    const preSwarmsBalance = tx.meta.preTokenBalances.find(b => b.mint === swarmsMint.toString())
    const postSwarmsBalance = tx.meta.postTokenBalances.find(b => b.mint === swarmsMint.toString())

    if (!preTokenBalance?.uiTokenAmount?.uiAmount || !postTokenBalance?.uiTokenAmount?.uiAmount || 
        !preSwarmsBalance?.uiTokenAmount?.uiAmount || !postSwarmsBalance?.uiTokenAmount?.uiAmount) {
      logger.info("Skipping transaction - missing balance data", {
        signature: sig.signature,
        hasPreToken: !!preTokenBalance?.uiTokenAmount?.uiAmount,
        hasPostToken: !!postTokenBalance?.uiTokenAmount?.uiAmount,
        hasPreSwarms: !!preSwarmsBalance?.uiTokenAmount?.uiAmount,
        hasPostSwarms: !!postSwarmsBalance?.uiTokenAmount?.uiAmount,
        preTokenBalance,
        postTokenBalance,
        preSwarmsBalance,
        postSwarmsBalance
      })
      continue
    }

    // Calculate changes in balances
    const tokenChange = postTokenBalance.uiTokenAmount.uiAmount - preTokenBalance.uiTokenAmount.uiAmount
    const swarmsChange = postSwarmsBalance.uiTokenAmount.uiAmount - preSwarmsBalance.uiTokenAmount.uiAmount

    // Skip if no significant changes
    if (Math.abs(tokenChange) < 0.000001 || Math.abs(swarmsChange) < 0.000001) {
      logger.info("Skipping transaction - insignificant changes", {
        signature: sig.signature,
        tokenChange,
        swarmsChange
      })
      continue
    }

    // First identify which account is the pool
    const poolAddress = poolKey.toString()
    
    // Check if this is a pool account by looking at the specific vault addresses
    const tokenVaultAccount = tx.meta.preTokenBalances.find(b => 
      b.mint === tokenMint.toString() && 
      b.owner === tokenVaultAddress
    )
    const swarmsVaultAccount = tx.meta.preTokenBalances.find(b => 
      b.mint === swarmsMint.toString() && 
      b.owner === swarmsVaultAddress
    )

    if (!tokenVaultAccount || !swarmsVaultAccount) {
      logger.info("Skipping transaction - couldn't identify pool vaults", {
        signature: sig.signature,
        poolAddress,
        foundTokenVault: !!tokenVaultAccount,
        foundSwarmsVault: !!swarmsVaultAccount,
        expectedTokenVault: tokenVaultAddress,
        expectedSwarmsVault: swarmsVaultAddress,
        actualTokenVaultOwner: tokenVaultAccount?.owner,
        actualSwarmsVaultOwner: swarmsVaultAccount?.owner
      })
      continue
    }

    // Find the swapper's accounts (non-vault accounts)
    const swapperTokenAccount = tx.meta.preTokenBalances.find(b => 
      b.mint === tokenMint.toString() && 
      b.owner !== tokenVaultAddress
    )
    const swapperSwarmsAccount = tx.meta.preTokenBalances.find(b => 
      b.mint === swarmsMint.toString() && 
      b.owner !== swarmsVaultAddress
    )

    if (!swapperTokenAccount && !swapperSwarmsAccount) {
      logger.info("Skipping transaction - couldn't identify swapper accounts", {
        signature: sig.signature
      })
      continue
    }

    // If token vault balance increased, it's a sell (swapper sold tokens to pool)
    // If token vault balance decreased, it's a buy (swapper bought tokens from pool)
    const vaultPreAmount = tokenVaultAccount?.uiTokenAmount?.uiAmount ?? 0
    const vaultPostAmount = tx.meta.postTokenBalances.find(b => 
      b.accountIndex === tokenVaultAccount?.accountIndex
    )?.uiTokenAmount?.uiAmount ?? 0
    const vaultTokenChange = vaultPostAmount - vaultPreAmount

    const isBuy = vaultTokenChange < 0  // If vault balance decreased, it's a buy

    // For buys: token amount is what left the vault
    // For sells: token amount is what entered the vault
    const tokenAmount = Math.abs(vaultTokenChange)
    const swarmsAmount = Math.abs(swarmsChange)
    
    // Calculate price in SWARMS per token
    const price = swarmsAmount / tokenAmount

    // Get the swapper's wallet address
    const swapperAddress = swapperTokenAccount?.owner || swapperSwarmsAccount?.owner

    logger.info("Valid swap transaction found", {
      signature: sig.signature,
      side: isBuy ? 'buy' : 'sell',
      tokenAmount,
      swarmsAmount,
      price,
      swapper: swapperAddress,
      signers: tx.transaction.message.accountKeys
        .filter(key => key.signer)
        .map(key => key.pubkey),
      timestamp: sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : new Date().toISOString(),
      preTokenBalance: preTokenBalance.uiTokenAmount.uiAmount,
      postTokenBalance: postTokenBalance.uiTokenAmount.uiAmount,
      preSwarmsBalance: preSwarmsBalance.uiTokenAmount.uiAmount,
      postSwarmsBalance: postSwarmsBalance.uiTokenAmount.uiAmount,
      tokenDecimals: preTokenBalance.uiTokenAmount.decimals,
      swarmsDecimals: preSwarmsBalance.uiTokenAmount.decimals,
      poolAddress,
      swapperTokenAccountIndex: swapperTokenAccount?.accountIndex,
      swapperSwarmsAccountIndex: swapperSwarmsAccount?.accountIndex,
      instructions: tx.transaction.message.instructions,
      logs: tx.meta.logMessages
    })

    transactions.push({
      signature: sig.signature,
      price,
      size: tokenAmount,
      side: isBuy ? 'buy' : 'sell',
      swapper: swapperAddress,
      signers: tx.transaction.message.accountKeys
        .filter(key => key.signer)
        .map(key => key.pubkey),
      timestamp: sig.blockTime ? sig.blockTime * 1000 : Date.now(),
      tokenDecimals,
      swarmsDecimals,
      swarmsAmount
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
      await supabase
        .from('web3agents')
        .update({
          current_price: marketData.stats.price,
          market_cap: marketData.stats.tvl,
          volume_24h: marketData.stats.volume24h,
          pool_address: marketData.pool.address,
          updated_at: new Date().toISOString()
        })
        .eq('mint_address', mintAddress)
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