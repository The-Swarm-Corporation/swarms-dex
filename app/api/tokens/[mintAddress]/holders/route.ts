import { NextResponse } from 'next/server'
import { Connection, PublicKey, ParsedAccountData } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { getRPCClient } from '@/lib/rpc/config'

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable")
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable")
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
const rpcClient = getRPCClient()

interface TokenAccount {
  pubkey: PublicKey
  account: {
    data: {
      parsed: {
        info: {
          tokenAmount: {
            uiAmount: number
          }
          owner: string
        }
      }
    }
  }
}

interface TokenHolder {
  wallet_address: string
  balance: number
  owner: string
  percentage?: number
  last_updated?: string
}

export async function GET(
  req: Request,
  { params }: { params: { mintAddress: string } }
) {
  try {
    const mintAddress = params.mintAddress
    if (!mintAddress) {
      return NextResponse.json({ error: "Mint address is required" }, { status: 400 })
    }

    // First try to get cached data
    const { data: cachedData, error: cacheError } = await supabase
      .from('token_holders')
      .select('*')
      .eq('mint_address', mintAddress)
      .order('balance', { ascending: false })
      .limit(10)

    logger.info("Cache check result", {
      hasCachedData: !!cachedData,
      cacheError: cacheError?.message,
      cacheAge: cachedData?.[0] ? `${Math.round((Date.now() - new Date(cachedData[0].last_updated).getTime()) / 1000)}s` : 'no cache',
      mintAddress
    })

    // If we have recent cached data (less than 5 minutes old), use it
    if (!cacheError && cachedData && cachedData.length > 0) {
      const cacheAge = Date.now() - new Date(cachedData[0].last_updated).getTime()
      if (cacheAge < 5 * 60 * 1000) { // 5 minutes
        logger.info("Using cached holder data", {
          mintAddress,
          holderCount: cachedData.length,
          cacheAge: `${Math.round(cacheAge / 1000)}s`
        })
        return NextResponse.json(cachedData)
      }
    }

    // If no recent cache, fetch fresh data
    logger.info("Fetching fresh holder data", { mintAddress })
    
    const connection = rpcClient.getConnection()
    const mint = new PublicKey(mintAddress)

    // Get all token accounts for this mint
    const accounts = await connection.getParsedProgramAccounts(
      TOKEN_PROGRAM_ID,
      {
        filters: [
          { dataSize: 165 }, // Size of token account
          { memcmp: { offset: 0, bytes: mint.toBase58() } }
        ]
      }
    )

    // Filter and sort accounts
    const holders = accounts
      .map((account): TokenHolder => ({
        wallet_address: account.pubkey.toString(),
        balance: (account.account.data as ParsedAccountData).parsed.info.tokenAmount.uiAmount || 0,
        owner: (account.account.data as ParsedAccountData).parsed.info.owner
      }))
      .filter(holder => holder.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 10) // Get top 10 holders

    // Calculate total supply for percentage calculation
    const mintInfo = await connection.getParsedAccountInfo(mint)
    const totalSupply = mintInfo.value && 'parsed' in mintInfo.value.data 
      ? Number(mintInfo.value.data.parsed.info.supply) / Math.pow(10, mintInfo.value.data.parsed.info.decimals)
      : 0

    // Add percentage of total supply
    const holdersWithPercentage = holders.map(holder => ({
      ...holder,
      percentage: totalSupply > 0 ? (holder.balance / totalSupply) * 100 : 0,
      last_updated: new Date().toISOString()
    }))

    // Update cache
    const { error: updateError } = await supabase
      .from('token_holders')
      .upsert(
        holdersWithPercentage.map(holder => ({
          mint_address: mintAddress,
          wallet_address: holder.wallet_address,
          owner: holder.owner,
          balance: holder.balance,
          percentage: holder.percentage,
          last_updated: holder.last_updated
        }))
      )

    if (updateError) {
      logger.error("Failed to update holder cache", updateError)
    } else {
      logger.info("Updated holder cache", {
        mintAddress,
        holderCount: holdersWithPercentage.length
      })
    }

    return NextResponse.json(holdersWithPercentage)
  } catch (error) {
    logger.error("Failed to fetch token holders", error as Error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch token holders" },
      { status: 500 }
    )
  }
} 