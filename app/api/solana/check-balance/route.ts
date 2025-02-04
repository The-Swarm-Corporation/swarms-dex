import { Connection, PublicKey } from '@solana/web3.js'
import { NextResponse } from 'next/server'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import { logger } from '@/lib/logger'

const RPC_URL = process.env.RPC_URL as string
const SWARMS_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS as string

export async function POST(req: Request) {
  try {
    const { walletAddress } = await req.json()
    
    if (!walletAddress) {
      return NextResponse.json({ error: 'Wallet address is required' }, { status: 400 })
    }

    const connection = new Connection(RPC_URL, 'confirmed')
    const publicKey = new PublicKey(walletAddress)
    const swarmsMint = new PublicKey(SWARMS_TOKEN_ADDRESS)

    // Get SOL balance
    const solBalance = await connection.getBalance(publicKey)
    
    // Get user's SWARMS token account
    const tokenAccount = await getAssociatedTokenAddress(
      swarmsMint,
      publicKey
    )

    // Get SWARMS balance if account exists
    let swarmsBalance = 0
    try {
      const tokenBalance = await connection.getTokenAccountBalance(tokenAccount)
      swarmsBalance = tokenBalance.value.uiAmount || 0
    } catch (error) {
      logger.warn('Token account not found or has no balance', {
        wallet: walletAddress,
        tokenAccount: tokenAccount.toString()
      })
    }

    logger.info('Fetched balances', {
      wallet: walletAddress,
      sol: solBalance / 1e9,
      swarms: swarmsBalance
    })

    return NextResponse.json({
      sol: solBalance / 1e9,
      swarms: swarmsBalance,
      tokenAccount: tokenAccount.toString()
    })

  } catch (error) {
    logger.error('Failed to check balances', error as Error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to check balances' },
      { status: 500 }
    )
  }
} 