import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { NextResponse } from 'next/server'
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token'
import { logger } from '@/lib/logger'

const RPC_URL = process.env.RPC_URL as string
const SWARMS_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS as string
const SWARMS_PUMP_ADDRESS = process.env.NEXT_PUBLIC_SWARMS_PLATFORM_TEST_ADDRESS as string

export async function POST(req: Request) {
  try {
    const { walletAddress, swarmsAmount } = await req.json()
    
    if (!walletAddress || !swarmsAmount) {
      return NextResponse.json({ error: 'Wallet address and SWARMS amount are required' }, { status: 400 })
    }

    const connection = new Connection(RPC_URL, 'confirmed')
    const userPublicKey = new PublicKey(walletAddress)
    const swarmsMint = new PublicKey(SWARMS_TOKEN_ADDRESS)
    const pumpPublicKey = new PublicKey(SWARMS_PUMP_ADDRESS)

    // Get user's token account
    const userTokenAccount = await getAssociatedTokenAddress(
      swarmsMint,
      userPublicKey
    )

    // Get pump's token account
    const pumpTokenAccount = await getAssociatedTokenAddress(
      swarmsMint,
      pumpPublicKey,
      true
    )

    // Create transfer transaction
    const transferTx = new Transaction()
    const amount = BigInt(swarmsAmount) * BigInt(10 ** 6) // SWARMS has 6 decimals

    transferTx.add(
      createTransferInstruction(
        userTokenAccount,
        pumpTokenAccount,
        userPublicKey,
        amount
      )
    )

    // Get latest blockhash using our RPC
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    transferTx.recentBlockhash = blockhash
    transferTx.lastValidBlockHeight = lastValidBlockHeight
    transferTx.feePayer = userPublicKey

    // Serialize the transaction
    const serializedTx = transferTx.serialize({ requireAllSignatures: false }).toString('base64')

    logger.info('Transfer transaction created', {
      from: userTokenAccount.toString(),
      to: pumpTokenAccount.toString(),
      amount: swarmsAmount
    })

    return NextResponse.json({
      transaction: serializedTx,
      blockhash,
      lastValidBlockHeight
    })

  } catch (error) {
    logger.error('Failed to create transfer transaction', error as Error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create transfer transaction' },
      { status: 500 }
    )
  }
} 