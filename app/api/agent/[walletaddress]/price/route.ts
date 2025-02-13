import { NextResponse } from "next/server"
import { TokenTrading } from "@/lib/solana/trading"
import { getConnection } from "@/config/solana"
import { logger } from "@/lib/logger"

export async function GET(
  request: Request,
  { params }: { params: { walletaddress: string } }
) {
  try {
    const connection = await getConnection()
    const trading = new TokenTrading(connection)
    
    try {
      const price = await trading.getCurrentPrice(params.walletaddress)
      return NextResponse.json({ price })
    } catch (error) {
      logger.error(
        `Failed to get token price for ${params.walletaddress}`,
        error instanceof Error ? error : new Error("Unknown error")
      )
      
      if (error instanceof Error && error.message.includes('Invalid mint account')) {
        return NextResponse.json(
          { error: "Invalid token address" },
          { status: 400 }
        )
      }
      
      return NextResponse.json(
        { error: "Failed to get token price" },
        { status: 500 }
      )
    }
  } catch (error) {
    logger.error("Failed to initialize connection", error as Error)
    return NextResponse.json(
      { error: "Failed to initialize connection" },
      { status: 500 }
    )
  }
} 