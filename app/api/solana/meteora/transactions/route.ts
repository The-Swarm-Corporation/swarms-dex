import { NextResponse } from "next/server"
import { Connection, PublicKey, ParsedTransactionWithMeta } from "@solana/web3.js"
import { logger } from "@/lib/logger"
import { deriveCustomizablePermissionlessConstantProductPoolAddress, createProgram } from "@mercurial-finance/dynamic-amm-sdk/dist/cjs/src/amm/utils"
import { createClient } from "@supabase/supabase-js"

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

// Helper function to calculate balance change for a token
function getBalanceChange(pre: Map<string, any>, post: Map<string, any>, mint: string): number | null {
  const preBalance = pre.get(mint)
  const postBalance = post.get(mint)
  
  if (!preBalance || !postBalance) {
    logger.info("Missing balance info", { mint, hasPreBalance: !!preBalance, hasPostBalance: !!postBalance })
    return null
  }

  // Log full balance objects to see their structure
  logger.info("Full balance objects", {
    pre: JSON.stringify(preBalance),
    post: JSON.stringify(postBalance)
  })
  
  // Check if we have the required properties
  if (!preBalance.uiTokenAmount || !postBalance.uiTokenAmount) {
    logger.info("Missing uiTokenAmount", {
      preHasUI: !!preBalance.uiTokenAmount,
      postHasUI: !!postBalance.uiTokenAmount
    })
    return null
  }

  const preAmount = Number(preBalance.uiTokenAmount.amount)
  const postAmount = Number(postBalance.uiTokenAmount.amount)
  
  logger.info("Balance amounts", { preAmount, postAmount })
  
  return postAmount - preAmount
}

// Helper function to determine swap direction and amounts
function parseSwapTransaction(tx: ParsedTransactionWithMeta, tokenMint: PublicKey, swarmsMint: PublicKey) {
  if (!tx.meta?.postTokenBalances || !tx.meta?.preTokenBalances) {
    logger.info("Missing token balances in transaction")
    return null
  }

  // Log full transaction data for debugging
  logger.info("Full transaction balances", {
    pre: JSON.stringify(tx.meta.preTokenBalances),
    post: JSON.stringify(tx.meta.postTokenBalances)
  })

  // Check if this is a pool creation transaction by looking for multiple token accounts
  const tokenAccounts = tx.meta.postTokenBalances.filter(b => b.mint === tokenMint.toString())
  const swarmsAccounts = tx.meta.postTokenBalances.filter(b => b.mint === swarmsMint.toString())
  
  if (tokenAccounts.length > 2 || swarmsAccounts.length > 2) {
    logger.info("Pool creation transaction detected - skipping", {
      tokenAccounts: tokenAccounts.length,
      swarmsAccounts: swarmsAccounts.length
    })
    return null
  }

  // Find the token balances for both tokens
  const preTokenBalance = tx.meta.preTokenBalances.find(b => b.mint === tokenMint.toString())
  const postTokenBalance = tx.meta.postTokenBalances.find(b => b.mint === tokenMint.toString())
  const preSwarmsBalance = tx.meta.preTokenBalances.find(b => b.mint === swarmsMint.toString())
  const postSwarmsBalance = tx.meta.postTokenBalances.find(b => b.mint === swarmsMint.toString())

  if (!preTokenBalance?.uiTokenAmount || !postTokenBalance?.uiTokenAmount || 
      !preSwarmsBalance?.uiTokenAmount || !postSwarmsBalance?.uiTokenAmount) {
    logger.info("Missing token balance information")
    return null
  }

  // Calculate changes using uiAmount values
  const tokenChange = (postTokenBalance.uiTokenAmount.uiAmount || 0) - (preTokenBalance.uiTokenAmount.uiAmount || 0)
  const swarmsChange = (postSwarmsBalance.uiTokenAmount.uiAmount || 0) - (preSwarmsBalance.uiTokenAmount.uiAmount || 0)

  // For a valid swap, one token should decrease while the other increases
  const isValidSwap = (tokenChange < 0 && swarmsChange > 0) || (tokenChange > 0 && swarmsChange < 0)
  if (!isValidSwap) {
    logger.info("Not a valid swap transaction", { tokenChange, swarmsChange })
    return null
  }

  // If token balance decreased and SWARMS increased, it's a sell
  // If token balance increased and SWARMS decreased, it's a buy
  const isSell = tokenChange < 0 && swarmsChange > 0

  const tokenAmount = Math.abs(tokenChange)
  const swarmsAmount = Math.abs(swarmsChange)

  const swapDetails = {
    side: isSell ? 'sell' : 'buy',
    tokenAmount,
    swarmsAmount,
    price: swarmsAmount / tokenAmount
  }

  logger.info("Parsed swap details", swapDetails)
  return swapDetails
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const mintAddress = searchParams.get('mintAddress')
    const swarmsAddress = process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS

    if (!mintAddress || !swarmsAddress) {
      return NextResponse.json({ error: "Missing required addresses" }, { status: 400 })
    }

    // Add cache headers to prevent duplicate requests
    const headers = new Headers()
    headers.set('Cache-Control', 'public, s-maxage=60') // Cache for 60 seconds
    headers.set('CDN-Cache-Control', 'public, s-maxage=60')
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=60')

    // Try to get cached data first
    const { data: cachedData, error: cacheError } = await supabase
      .from('meteora_transactions')
      .select('*')
      .eq('mint_address', mintAddress)
      .single()

    if (!cacheError && cachedData) {
      const cacheAge = Date.now() - new Date(cachedData.updated_at).getTime()
      if (cacheAge < 60 * 1000) { // 1 minute cache
        logger.info("Returning cached Meteora transactions", { mintAddress })
        return NextResponse.json({ transactions: cachedData.data }, { headers })
      }
    }

    // Validate mint addresses
    try {
      const tokenMint = new PublicKey(mintAddress)
      const swarmsMint = new PublicKey(swarmsAddress)

      // Get pool address
      const poolKey = deriveCustomizablePermissionlessConstantProductPoolAddress(
        tokenMint,
        swarmsMint,
        createProgram(connection).ammProgram.programId,
      )

      // Fetch recent transactions for the pool
      const signatures = await connection.getSignaturesForAddress(
        poolKey,
        { limit: 5 }, // Reduced from 20 to 5
        'confirmed'
      )

      // Get transaction details with a single RPC call
      const transactions = await Promise.all(
        signatures.map(async (sig) => {
          logger.info("Processing transaction", { signature: sig.signature })
          
          const tx = await connection.getParsedTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0
          })
          
          if (!tx) {
            logger.info("Transaction not found", { signature: sig.signature })
            return null
          }

          // Parse swap details from transaction
          const swapDetails = parseSwapTransaction(tx, tokenMint, swarmsMint)
          if (!swapDetails) {
            logger.info("Could not parse swap details", { signature: sig.signature })
            return null
          }

          const transaction = {
            signature: sig.signature,
            price: swapDetails.price,
            size: swapDetails.tokenAmount, // Already in UI format, no need to divide
            side: swapDetails.side,
            timestamp: sig.blockTime ? sig.blockTime * 1000 : Date.now()
          }

          logger.info("Processed transaction", transaction)
          return transaction
        })
      )

      // Filter out null transactions
      const validTransactions = transactions.filter(tx => tx !== null)

      // Update cache
      await supabase
        .from('meteora_transactions')
        .upsert({
          mint_address: mintAddress,
          data: validTransactions,
          updated_at: new Date().toISOString()
        })

      return NextResponse.json({ transactions: validTransactions }, { headers })

    } catch (error) {
      logger.error("Error fetching Meteora transactions", error as Error)
      return NextResponse.json(
        { error: "Failed to fetch transactions", details: (error as Error).message },
        { status: 500 }
      )
    }
  } catch (error) {
    logger.error("Error in transaction endpoint", error as Error)
    return NextResponse.json(
      { error: "Internal server error", details: (error as Error).message },
      { status: 500 }
    )
  }
} 
