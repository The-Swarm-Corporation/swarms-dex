import { NextResponse } from "next/server"
import { Connection, PublicKey } from "@solana/web3.js"
import { logger } from "@/lib/logger"
import { parseSwapTransaction } from "@/app/api/solana/meteora/transactions/route"
import { deriveCustomizablePermissionlessConstantProductPoolAddress, createProgram } from "@mercurial-finance/dynamic-amm-sdk/dist/cjs/src/amm/utils"
import AmmImpl from "@mercurial-finance/dynamic-amm-sdk"

if (!process.env.RPC_URL) {
  throw new Error("Missing RPC_URL environment variable")
}

if (!process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS) {
  throw new Error("Missing NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS environment variable")
}

const connection = new Connection(process.env.RPC_URL)

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const signature = searchParams.get('signature')
    const mintAddress = searchParams.get('mintAddress')

    if (!signature || !mintAddress) {
      return NextResponse.json({ 
        error: "Missing required parameters. Please provide 'signature' and 'mintAddress'." 
      }, { status: 400 })
    }

    logger.info("Debugging transaction parser", { signature, mintAddress })

    // Get transaction details
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    })

    if (!tx) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 })
    }

    // Get pool info to find vault addresses
    const tokenMint = new PublicKey(mintAddress)
    const swarmsMint = new PublicKey(process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS!)
    
    // Get pool address
    const poolKey = deriveCustomizablePermissionlessConstantProductPoolAddress(
      tokenMint,
      swarmsMint,
      createProgram(connection).ammProgram.programId,
    )

    // Get pool info
    const amm = await AmmImpl.create(connection, poolKey)
    await amm.updateState()
    const pool = amm.poolState

    if (!pool) {
      return NextResponse.json({ error: "Pool not found" }, { status: 404 })
    }

    const vaultAddresses = {
      tokenVault: pool.aVault.toString(),
      swarmsVault: pool.bVault.toString()
    }

    // Parse the transaction
    const result = parseSwapTransaction(
      tx,
      tokenMint,
      swarmsMint,
      vaultAddresses
    )

    // Return detailed debug information
    return NextResponse.json({
      success: true,
      result,
      debug: {
        signature,
        mintAddress,
        poolAddress: poolKey.toString(),
        vaultAddresses,
        rawTransaction: {
          logMessages: tx.meta?.logMessages,
          preTokenBalances: tx.meta?.preTokenBalances,
          postTokenBalances: tx.meta?.postTokenBalances,
        }
      }
    })

  } catch (error) {
    logger.error("Error in debug endpoint", error as Error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error"
      }, 
      { status: 500 }
    )
  }
} 