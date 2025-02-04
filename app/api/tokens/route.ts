import { NextResponse } from "next/server"
import { PublicKey, Connection, Keypair } from "@solana/web3.js"
import { createPool } from "@/lib/meteora/pool"
import { logger } from "@/lib/logger"
import { WalletService } from "@/lib/solana/wallet"
import { getSupabaseClient } from "@/lib/supabase/client"
import { SWARMS_TOKEN_MINT } from "@/constants"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { name, description, symbol, totalSupply, swapsRequired, creatorWallet } = body

    // Initialize services
    const connection = new Connection(process.env.RPC_URL as string)
    const walletService = new WalletService(connection)
    const supabase = getSupabaseClient()

    // Generate new token mint keypair
    const mintKeypair = Keypair.generate()

    // Get platform wallet from environment variables
    const platformWallet = process.env.PLATFORM_WALLET as string

    // Get user wallet from database
    const { data: userWalletData, error: userWalletError } = await supabase
      .from("web3agents")
      .select("wallet_address")
      .eq("id", creatorWallet)
      .single()

    if (userWalletError) throw userWalletError

    const userWallet = new PublicKey(userWalletData.solana_wallet)

    // Get private key from environment variables
    const privateKey = Uint8Array.from(Buffer.from(process.env.PRIVATE_KEY as string, "hex"))

    // Create pool transaction
    const { transaction: poolTx, poolAddress } = await createPool({
      tokenAMint: mintKeypair.publicKey,
      tokenBMint: SWARMS_TOKEN_MINT,
      initialLiquidityA: BigInt(body.swapsRequired * 1e9),
      initialLiquidityB: BigInt(Math.floor(body.swapsRequired * body.totalSupply * 1e9)),
      userWallet,
    })

    // Sign and send pool creation transaction
    const signedPoolTx = await walletService.signTransaction(poolTx, privateKey)
    const poolSignature = await connection.sendRawTransaction(signedPoolTx.serialize())
    await connection.confirmTransaction(poolSignature)

    logger.info("Created Meteora pool", {
      pool: poolAddress.toString(),
      signature: poolSignature,
    })

    // Store token info in database
    const { data: agent, error: dbError } = await supabase
      .from("web3agents")
      .insert({
        name: body.name,
        description: body.description,
        token_symbol: body.symbol,
        mint_address: mintKeypair.publicKey.toString(),
        creator_id: body.creatorWallet,
        initial_supply: body.totalSupply,
        liquidity_pool_size: body.swapsRequired,
        is_verified: false,
        is_swarm: false,
        metadata: {
          pool_address: poolAddress.toString(),
          platform_wallet: platformWallet,
        },
      })
      .select()
      .single()

    if (dbError) throw dbError

    logger.info("Token created successfully", {
      mint: mintKeypair.publicKey.toString(),
      pool: poolAddress.toString(),
      agent: agent.id,
    })

    return NextResponse.json({
      success: true,
      mint: mintKeypair.publicKey.toString(),
      pool: poolAddress.toString(),
      agent: agent.id,
    })
  } catch (error) {
    logger.error("Token creation failed", error as Error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

