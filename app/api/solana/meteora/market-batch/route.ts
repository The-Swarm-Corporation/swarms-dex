import { NextResponse } from "next/server"
import { PublicKey } from "@solana/web3.js"
import { logger } from "@/lib/logger"
import { rpcRouter } from "@/lib/rpc/router"
import { deriveCustomizablePermissionlessConstantProductPoolAddress, createProgram } from "@mercurial-finance/dynamic-amm-sdk/dist/cjs/src/amm/utils"
import AmmImpl from "@mercurial-finance/dynamic-amm-sdk"
import { getServiceClient } from "@/lib/supabase/client"

if (!process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS) {
  throw new Error("Missing NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS environment variable")
}

// Batch size for RPC requests
const BATCH_SIZE = 3;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processBatch(
  connection: any,
  mintAddresses: string[],
  swarmsMint: PublicKey,
  results: Record<string, any>
) {
  const supabase = getServiceClient()
  
  // Process mint infos
  for (const mintAddress of mintAddresses) {
    try {
      const tokenMint = new PublicKey(mintAddress)
      const mintInfo = await connection.getParsedAccountInfo(tokenMint)
      const currentSupply = mintInfo.value && 'parsed' in mintInfo.value.data 
        ? Number(mintInfo.value.data.parsed.info.supply) / Math.pow(10, mintInfo.value.data.parsed.info.decimals)
        : 0

      // Get pool address
      const poolKey = deriveCustomizablePermissionlessConstantProductPoolAddress(
        tokenMint,
        swarmsMint,
        createProgram(connection).ammProgram.programId,
      )

      // Get pool account info
      const poolInfo = await connection.getAccountInfo(poolKey)
      if (!poolInfo) {
        logger.info("No pool found for token", { mintAddress })
        continue
      }

      // Create AMM instance and get pool state
      const amm = await AmmImpl.create(connection, poolKey)
      await amm.updateState()
      const pool = amm.poolState

      if (!pool) {
        throw new Error("Failed to get pool state")
      }

      // Calculate market data
      const tokenBalance = Number(pool.aVaultLp)
      const swarmsBalance = Number(pool.bVaultLp)
      const priceInSwarms = swarmsBalance > 0 ? tokenBalance / swarmsBalance : 0
      const swarmsPrice = 1 // TODO: Get actual SWARMS price
      const tokenPrice = priceInSwarms * swarmsPrice
      const marketCap = currentSupply * tokenPrice

      results[mintAddress] = {
        pool: {
          address: poolKey.toString(),
          tokenMint: mintAddress,
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
          volume24h: tokenBalance * tokenPrice * 0.1, // Estimated
          currentSupply,
          marketCap
        }
      }

      // Update meteora_pool_stats
      await supabase
        .from('meteora_pool_stats')
        .upsert({
          mint_address: mintAddress,
          data: results[mintAddress],
          updated_at: new Date().toISOString()
        })

      // Update web3agents with current supply and market cap
      await supabase
        .from('web3agents')
        .update({
          current_supply: currentSupply,
          current_price: tokenPrice,
          market_cap: marketCap,
          volume_24h: tokenBalance * tokenPrice * 0.1, // Estimated
          updated_at: new Date().toISOString()
        })
        .eq('mint_address', mintAddress)

      // Add delay between individual token processing
      await sleep(100);

    } catch (error) {
      logger.error(`Failed to get market data for ${mintAddress}`, error as Error)
    }
  }
}

export async function POST(req: Request) {
  try {
    const { mintAddresses } = await req.json()
    
    if (!Array.isArray(mintAddresses) || mintAddresses.length === 0) {
      return NextResponse.json({ error: "Invalid mint addresses" }, { status: 400 })
    }

    return await rpcRouter.withRetry(async (connection) => {
      const swarmsMint = new PublicKey(process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS!)
      const results: Record<string, any> = {}

      // Process in small batches
      for (let i = 0; i < mintAddresses.length; i += BATCH_SIZE) {
        const batch = mintAddresses.slice(i, i + BATCH_SIZE)
        
        await processBatch(connection, batch, swarmsMint, results)
        
        // Add delay between batches
        if (i + BATCH_SIZE < mintAddresses.length) {
          await sleep(500)
        }
      }

      return NextResponse.json(results)
    })

  } catch (error) {
    logger.error("Error in market-batch endpoint", error as Error)
    return NextResponse.json(
      { error: "Internal server error", details: (error as Error).message },
      { status: 500 }
    )
  }
} 