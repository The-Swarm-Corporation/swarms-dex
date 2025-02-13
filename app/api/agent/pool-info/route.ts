import { NextResponse } from "next/server"
import { MeteoraService } from "@/lib/meteora/service"
import { getConnection } from "@/config/solana"
import { logger } from "@/lib/logger"
import { PublicKey } from "@solana/web3.js"

export async function POST(request: Request) {
  try {
    const { poolAddress, tokenMint, swapsMint } = await request.json()
    
    if (!poolAddress || !tokenMint || !swapsMint) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      )
    }

    const connection = await getConnection()
    const meteoraService = new MeteoraService(connection)

    try {
      const poolPublicKey = new PublicKey(poolAddress)
      const pool = await meteoraService.getPool(poolPublicKey)

      if (!pool) {
        return NextResponse.json(
          { error: "Pool not found" },
          { status: 404 }
        )
      }

      return NextResponse.json({
        address: pool.address.toString(),
        tokenAMint: pool.tokenAMint.toString(),
        tokenBMint: pool.tokenBMint.toString()
      })
    } catch (error) {
      logger.error(
        `Failed to get pool info for ${poolAddress}`,
        error instanceof Error ? error : new Error("Unknown error")
      )
      
      return NextResponse.json(
        { error: "Failed to get pool info" },
        { status: 500 }
      )
    }
  } catch (error) {
    logger.error("Failed to parse request", error as Error)
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    )
  }
} 