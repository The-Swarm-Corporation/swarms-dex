import { NextResponse } from "next/server"
import { Connection, PublicKey, ParsedTransactionWithMeta, TokenBalance } from "@solana/web3.js"
import { logger } from "@/lib/logger"
import { deriveCustomizablePermissionlessConstantProductPoolAddress, createProgram } from "@mercurial-finance/dynamic-amm-sdk/dist/cjs/src/amm/utils"
import { createClient } from "@supabase/supabase-js"
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

// Helper function to parse swap transaction
export function parseSwapTransaction(
  tx: ParsedTransactionWithMeta, 
  tokenMint: PublicKey, 
  swarmsMint: PublicKey,
  vaultAddresses: { tokenVault: string, swarmsVault: string }
): { 
  signature: string; 
  side: 'buy' | 'sell'; 
  size: number; 
  price: number;
  vaults: { tokenVault: string; swarmsVault: string };
  user: string;
} | null {
  if (!tx.meta?.postTokenBalances || !tx.meta?.preTokenBalances || !tx.meta?.logMessages) {
    return null
  }

  // First verify this is a Meteora swap instruction
  const hasMeteoraProgram = tx.meta.logMessages.some(log => 
    log.includes('Program Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB invoke')
  )
  const hasSwapInstruction = tx.meta.logMessages.some(log => 
    log.includes('Program log: Instruction: Swap')
  )

  if (!hasMeteoraProgram || !hasSwapInstruction) {
    return null
  }

  // Find token vault balance changes
  const tokenVaultPre = tx.meta.preTokenBalances.find(b => 
    b.owner === vaultAddresses.tokenVault && 
    b.mint === tokenMint.toString()
  )?.uiTokenAmount?.uiAmount ?? null

  const tokenVaultPost = tx.meta.postTokenBalances.find(b => 
    b.owner === vaultAddresses.tokenVault && 
    b.mint === tokenMint.toString()
  )?.uiTokenAmount?.uiAmount ?? null

  // Find SWARMS vault balance changes
  const swarmsVaultPre = tx.meta.preTokenBalances.find(b => 
    b.owner === vaultAddresses.swarmsVault && 
    b.mint === swarmsMint.toString()
  )?.uiTokenAmount?.uiAmount ?? null

  const swarmsVaultPost = tx.meta.postTokenBalances.find(b => 
    b.owner === vaultAddresses.swarmsVault && 
    b.mint === swarmsMint.toString()
  )?.uiTokenAmount?.uiAmount ?? null

  if (tokenVaultPre === null || tokenVaultPost === null || 
      swarmsVaultPre === null || swarmsVaultPost === null) {
    return null
  }

  // Calculate changes
  const tokenChange = tokenVaultPost - tokenVaultPre
  const swarmsChange = swarmsVaultPost - swarmsVaultPre
  
  // A buy is when tokens leave the token vault (negative change)
  const isBuy = tokenChange < 0
  const tokenAmount = Math.abs(tokenChange)
  const swarmsAmount = Math.abs(swarmsChange)

  // Find the user's account (non-vault account)
  const userAccount = tx.meta.preTokenBalances.find(b => 
    b.mint === tokenMint.toString() && 
    b.owner !== vaultAddresses.tokenVault
  )

  // The price is already provided by Meteora in the correct format
  const price = swarmsAmount / tokenAmount

  return {
    signature: tx.transaction.signatures[0],
    side: isBuy ? 'buy' : 'sell' as const,
    size: tokenAmount,
    price: swarmsAmount / tokenAmount,
    vaults: {
      tokenVault: vaultAddresses.tokenVault,
      swarmsVault: vaultAddresses.swarmsVault
    },
    user: userAccount?.owner || 'unknown'
  }
}

// Helper to find the user from balance changes
function findUserFromBalances(
  isBuy: boolean,
  tokenBalances: { pre: any[], post: any[] },
  swarmsBalances: { pre: any[], post: any[] },
  vaultAddresses: { tokenVault: string, swarmsVault: string }
): string {
  const relevantBalances = isBuy ? tokenBalances : swarmsBalances
  const nonVaultBalances = relevantBalances.post.filter(b => 
    b.owner !== vaultAddresses.tokenVault && 
    b.owner !== vaultAddresses.swarmsVault
  )
  return nonVaultBalances[0]?.owner || 'unknown'
}

interface Transaction {
  signature: string
  price: number | null
  size: number | null
  side: 'buy' | 'sell' | null
  timestamp: number
  isSwap: boolean
}

interface CachedTransactionData {
  data: Transaction[]
  updated_at: string
}

async function getLatestTransactions(
  connection: Connection,
  poolKey: PublicKey,
  tokenMint: PublicKey,
  swarmsMint: PublicKey,
  lastKnownSignature?: string
) {
  let existingTransactions: Transaction[] = []
  try {
    // Get pool info to find vault addresses
    const amm = await AmmImpl.create(connection, poolKey)
    await amm.updateState()
    const pool = amm.poolState
    
    if (!pool) {
      logger.error("Failed to fetch pool info", new Error("Pool state not found"))
      return existingTransactions
    }

    const vaultAddresses = {
      tokenVault: pool.aVault.toString(),
      swarmsVault: pool.bVault.toString()
    }

    // First try to get cached transactions from database
    const { data: cachedData, error: cacheError } = await supabase
      .from('meteora_transactions')
      .select('*')
      .eq('mint_address', tokenMint.toString())
      .single()

    let mostRecentSignature: string | undefined = undefined

    if (!cacheError && cachedData) {
      const typedData = cachedData as unknown as CachedTransactionData
      existingTransactions = typedData.data
      mostRecentSignature = existingTransactions[0]?.signature
      
      // If cache is fresh (less than 1 minute old) or if the most recent signature matches our last known signature
      const cacheAge = Date.now() - new Date(typedData.updated_at).getTime()
      if (cacheAge < 60 * 1000 || (lastKnownSignature && existingTransactions[0]?.signature === lastKnownSignature)) {
        logger.info("Using cached transactions", {
          mintAddress: tokenMint.toString(),
          transactionCount: existingTransactions.length,
          cacheAge: `${Math.round(cacheAge / 1000)}s`,
          hasLastKnownSignature: !!lastKnownSignature
        })
        return existingTransactions.filter(tx => tx.isSwap)
      }
    }

    // Fetch only new signatures since our last known signature
    const signatures = await connection.getSignaturesForAddress(
      poolKey,
      { 
        limit: 10,
        before: mostRecentSignature // Only get transactions newer than our cache
      },
      'confirmed'
    )

    if (signatures.length === 0 || (existingTransactions.length > 0 && signatures.length === existingTransactions.length)) {
      logger.info("No new transactions to process", {
        mintAddress: tokenMint.toString(),
        poolAddress: poolKey.toString(),
        signatureCount: signatures.length,
        existingCount: existingTransactions.length
      })
      // Update cache timestamp even if no new transactions
      await supabase
        .from('meteora_transactions')
        .upsert({
          mint_address: tokenMint.toString(),
          data: existingTransactions,
          updated_at: new Date().toISOString()
        })
      return existingTransactions
    }

    logger.info("Found new signatures", {
      count: signatures.length,
      poolAddress: poolKey.toString()
    })

    // Process new transactions with delay between each to avoid rate limits
    const newTransactions: Transaction[] = []
    for (const sig of signatures) {
      try {
        const tx = await connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed'
        })

        if (!tx) {
          logger.info("Transaction not found", { signature: sig.signature })
          continue
        }

        const swapDetails = parseSwapTransaction(tx, tokenMint, swarmsMint, vaultAddresses)
        
        // Save all transactions, but mark non-swaps with null values
        newTransactions.push({
          signature: sig.signature,
          price: swapDetails?.price ?? null,
          size: swapDetails?.size ?? null,
          side: swapDetails?.side ?? null,
          timestamp: sig.blockTime ? sig.blockTime * 1000 : Date.now(),
          isSwap: !!swapDetails
        })

        if (!swapDetails) {
          logger.info("Saving non-swap transaction", { signature: sig.signature })
          continue
        }
      } catch (error) {
        logger.error("Error processing transaction", error as Error, { signature: sig.signature })
        // Save failed transactions too
        newTransactions.push({
          signature: sig.signature,
          price: null,
          size: null,
          side: null,
          timestamp: sig.blockTime ? sig.blockTime * 1000 : Date.now(),
          isSwap: false
        })
      }
    }

    // Merge new transactions with existing ones and sort
    const allTransactions = [...newTransactions, ...existingTransactions]
      .sort((a: Transaction, b: Transaction) => b.timestamp - a.timestamp)
      .slice(0, 100) // Keep only the 100 most recent transactions

    // Filter out non-swaps when returning to user
    const swapTransactions = allTransactions.filter(tx => tx.isSwap)

    // Update cache with merged transactions
    await supabase
      .from('meteora_transactions')
      .upsert({
        mint_address: tokenMint.toString(),
        data: allTransactions,
        updated_at: new Date().toISOString()
      })

    logger.info("Updated transaction cache", {
      mintAddress: tokenMint.toString(),
      newTransactions: newTransactions.length,
      totalTransactions: allTransactions.length
    })

    return swapTransactions
  } catch (error) {
    logger.error("Error fetching Meteora transactions", error as Error)
    // If we have existing transactions, return them even if update failed
    if (existingTransactions.length > 0) {
      return existingTransactions
    }
    return []
  }
}

export async function GET(req: Request) {
  let existingTransactions: Transaction[] = []
  let mintAddress: string | null = null
  const headers = new Headers()

  try {
    const { searchParams } = new URL(req.url)
    mintAddress = searchParams.get('mintAddress')
    const swarmsAddress = process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS

    if (!mintAddress || !swarmsAddress) {
      return NextResponse.json({ error: "Missing required addresses" }, { status: 400 })
    }

    // Add cache headers to prevent duplicate requests
    headers.set('Cache-Control', 'public, s-maxage=60') // Cache for 60 seconds
    headers.set('CDN-Cache-Control', 'public, s-maxage=60')
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=60')

    let lastKnownSignature: string | undefined

    // Try to get cached data first
    const { data: cachedData, error: cacheError } = await supabase
      .from('meteora_transactions')
      .select('*')
      .eq('mint_address', mintAddress)
      .single()

    if (!cacheError && cachedData?.data?.length > 0) {
      const typedData = cachedData as unknown as CachedTransactionData
      existingTransactions = typedData.data
      lastKnownSignature = existingTransactions[0]?.signature // Most recent transaction
      
      const cacheAge = Date.now() - new Date(typedData.updated_at).getTime()
      if (cacheAge < 60 * 1000) { // 1 minute cache
        logger.info("Returning cached Meteora transactions", { 
          mintAddress,
          transactionCount: existingTransactions.length
        })
        return NextResponse.json({ transactions: existingTransactions }, { headers })
      }
    }

    const tokenMint = new PublicKey(mintAddress)
    const swarmsMint = new PublicKey(swarmsAddress)

    // Get pool address
    const poolKey = deriveCustomizablePermissionlessConstantProductPoolAddress(
      tokenMint,
      swarmsMint,
      createProgram(connection).ammProgram.programId,
    )

    // Fetch only new transactions
    const newTransactions = await getLatestTransactions(
      connection,
      poolKey,
      tokenMint,
      swarmsMint,
      lastKnownSignature
    )

    // Merge new transactions with existing ones
    const allTransactions = [...newTransactions, ...existingTransactions]
      .sort((a: Transaction, b: Transaction) => b.timestamp - a.timestamp) // Sort by timestamp descending
      .slice(0, 100) // Keep only the 100 most recent transactions

    // Update cache with merged transactions
    await supabase
      .from('meteora_transactions')
      .upsert({
        mint_address: mintAddress,
        data: allTransactions,
        updated_at: new Date().toISOString()
      })

    return NextResponse.json({ transactions: allTransactions }, { headers })

  } catch (error) {
    logger.error("Error in transaction endpoint", error as Error)
    
    // If we have cached data, return it even if it's stale
    if (existingTransactions?.length > 0 && mintAddress) {
      logger.info("Returning stale cached data due to error", {
        mintAddress,
        transactionCount: existingTransactions.length
      })
      return NextResponse.json({ transactions: existingTransactions }, { headers })
    }

    return NextResponse.json(
      { error: "Internal server error", details: (error as Error).message },
      { status: 500 }
    )
  }
} 
