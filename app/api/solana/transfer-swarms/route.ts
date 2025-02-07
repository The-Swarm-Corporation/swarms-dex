import { Connection, PublicKey, Transaction, Keypair, TransactionInstruction } from '@solana/web3.js'
import { NextResponse } from 'next/server'
import { 
  getAssociatedTokenAddress, 
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount
} from '@solana/spl-token'
import { logger } from '@/lib/logger'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/crypto'
import { createSwapTokensInstruction } from '@/lib/solana/bonding-curve'
import { ComputeBudgetProgram } from '@solana/web3.js'

const RPC_URL = process.env.RPC_URL as string
const SWARMS_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS as string
const SWARMS_PUMP_ADDRESS = process.env.NEXT_PUBLIC_SWARMS_PLATFORM_TEST_ADDRESS as string
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Bonding curve constants
const TOKEN_DECIMALS = 6
const INITIAL_SUPPLY = 1_000_000_000 // 1B actual tokens to mint
const VIRTUAL_TOKEN_SUPPLY = 73_000_191 // Virtual supply used for calculations
const INITIAL_VIRTUAL_SWARMS = 20000 // 5000 SWARMS virtual reserve (10x more expensive)

// Scale k value for 5000 SWARMS to maintain price dynamics
// Original PUMP.FUN k value scaled for our virtual supply and higher SWARMS reserve
const K_VALUE = 32_190_005_730 * (VIRTUAL_TOKEN_SUPPLY / 1_073_000_191) * (20000/500)

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

// Calculate tokens for given SWARMS amount using PUMP.FUN formula
function calculateTokenAmount(currentSwarmsReserve: number, additionalSwarms: number): number {
  // Use current SWARMS reserve + additional amount for calculation
  const totalSwarmsAfter = currentSwarmsReserve + additionalSwarms
  
  // Prevent division by zero and negative values
  if (totalSwarmsAfter <= 0) return 0
  
  // Calculate virtual balances first
  const currentVirtualSwarms = currentSwarmsReserve + INITIAL_VIRTUAL_SWARMS
  const totalVirtualSwarms = totalSwarmsAfter + INITIAL_VIRTUAL_SWARMS
  
  // Calculate tokens using constant product formula: k = x * y
  // where x is virtual SWARMS and y is virtual tokens
  const currentVirtualTokens = K_VALUE / currentVirtualSwarms
  const newVirtualTokens = K_VALUE / totalVirtualSwarms
  
  // The difference is how many tokens they receive
  const virtualTokensToReceive = currentVirtualTokens - newVirtualTokens
  
  // Scale down to actual supply and ensure non-negative
  const scaledTokens = Math.max(0, (virtualTokensToReceive / VIRTUAL_TOKEN_SUPPLY) * INITIAL_SUPPLY)
  
  console.log('Token calculation details:', {
    currentReserve: currentSwarmsReserve,
    additionalAmount: additionalSwarms,
    totalAfter: totalSwarmsAfter,
    currentVirtualSwarms,
    totalVirtualSwarms,
    currentVirtualTokens,
    newVirtualTokens,
    virtualTokensToReceive,
    scaledTokens,
    k: K_VALUE,
    priceImpact: (newVirtualTokens - currentVirtualTokens) / currentVirtualTokens * 100
  })
  
  return scaledTokens
}

export async function POST(req: Request) {
  try {
    const { walletAddress, swarmsAmount, fromAccount, toAccount } = await req.json()
    
    if (!walletAddress || !swarmsAmount || !fromAccount || !toAccount) {
      return NextResponse.json({ error: 'Wallet address, SWARMS amount, and account addresses are required' }, { status: 400 })
    }

    const connection = new Connection(RPC_URL, {
      commitment: 'processed',
      confirmTransactionInitialTimeout: 60000
    })
    const userPublicKey = new PublicKey(walletAddress)
    const fromTokenAccount = new PublicKey(fromAccount)
    const toTokenAccount = new PublicKey(toAccount)

    // Check if destination is a bonding curve account
    console.log('Looking up bonding curve:', { toAccount })
    
    // First get the mint address from web3agents using bonding curve address
    const { data: agentData, error: agentError } = await supabase
      .from('web3agents')
      .select('mint_address, token_symbol')
      .eq('bonding_curve_address', toAccount)
      .single()

    if (agentError || !agentData) {
      console.log('Not a bonding curve account, proceeding with regular transfer')
      // Regular transfer code continues...
    } else {
      logger.info('Destination is a bonding curve account, creating deposit transaction', {
        bondingCurveAddress: toAccount,
        mintAddress: agentData.mint_address
      })

      // Get current SWARMS balance
      const bondingCurveSwarmsATA = await getAssociatedTokenAddress(
        new PublicKey(SWARMS_TOKEN_ADDRESS),
        new PublicKey(toAccount)
      )

      let currentSwarmsReserve = 0
      try {
        const swarmsBalance = await connection.getTokenAccountBalance(bondingCurveSwarmsATA)
        currentSwarmsReserve = Number(swarmsBalance.value.amount) / (10 ** TOKEN_DECIMALS)
      } catch {
        // ATA doesn't exist yet, currentSwarmsReserve stays 0
      }

      // Calculate amounts with 6 decimals
      const totalAmount = BigInt(swarmsAmount) * BigInt(10 ** TOKEN_DECIMALS)
      const feeAmount = totalAmount * BigInt(1) / BigInt(100) // 1% fee
      const depositAmount = totalAmount - feeAmount // 99% for deposit

      // Calculate tokens to receive based on bonding curve
      const tokensToReceive = calculateTokenAmount(
        currentSwarmsReserve,
        Number(depositAmount) / (10 ** TOKEN_DECIMALS)
      )

      // Create deposit transaction
      const depositTx = new Transaction()

      // Add compute budget instructions
      const computeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })
      const priorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 })
      depositTx.add(computeUnits, priorityFee)

      // Get bonding curve keys for private key
      const { data: bondingCurveData, error: bondingCurveError } = await supabase
        .from('bonding_curve_keys')
        .select('*')
        .eq('public_key', toAccount)
        .single()

      if (bondingCurveError || !bondingCurveData) {
        throw new Error('Failed to retrieve bonding curve keys')
      }

      // Decrypt private key and create keypair
      const privateKeyBase64 = await decrypt(bondingCurveData.encrypted_private_key)
      const privateKey = Buffer.from(privateKeyBase64, 'base64')
      const bondingCurveKeypair = Keypair.fromSecretKey(privateKey)

      // Get user's token account
      const userTokenATA = await getAssociatedTokenAddress(
        new PublicKey(agentData.mint_address),
        userPublicKey
      )

      // Get bonding curve's token account
      const bondingCurveTokenATA = await getAssociatedTokenAddress(
        new PublicKey(agentData.mint_address),
        bondingCurveKeypair.publicKey
      )

      // Create user's token ATA if it doesn't exist
      try {
        await connection.getTokenAccountBalance(userTokenATA)
      } catch {
        depositTx.add(
          createAssociatedTokenAccountInstruction(
            userPublicKey,
            userTokenATA,
            userPublicKey,
            new PublicKey(agentData.mint_address)
          )
        )
      }

      // Add 1% fee transfer to platform
      const pumpTokenAccount = await getAssociatedTokenAddress(
        new PublicKey(SWARMS_TOKEN_ADDRESS),
        new PublicKey(SWARMS_PUMP_ADDRESS),
        true
      )

      depositTx.add(
        createTransferInstruction(
          fromTokenAccount,
          pumpTokenAccount,
          userPublicKey,
          Number(feeAmount)
        )
      )

      // Add deposit instruction for SWARMS
      depositTx.add(
        createTransferInstruction(
          fromTokenAccount,
          bondingCurveSwarmsATA,
          userPublicKey,
          Number(depositAmount)
        )
      )

      // Add token transfer from bonding curve to user
      depositTx.add(
        createTransferInstruction(
          bondingCurveTokenATA,
          userTokenATA,
          bondingCurveKeypair.publicKey,
          BigInt(Math.floor(tokensToReceive * (10 ** TOKEN_DECIMALS)))
        )
      )

      // Add memo instruction to show amounts in Phantom
      depositTx.add(
        new TransactionInstruction({
          keys: [],
          programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
          data: Buffer.from(`Deposit ${Number(depositAmount) / (10 ** TOKEN_DECIMALS)} SWARMS for ${tokensToReceive.toFixed(6)} ${agentData.token_symbol} (Fee: ${Number(feeAmount) / (10 ** TOKEN_DECIMALS)} SWARMS)`)
        })
      )

      depositTx.feePayer = userPublicKey

      // Get fresh blockhash before signing
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('processed')
      const adjustedLastValidBlockHeight = lastValidBlockHeight + 1500
      
      depositTx.recentBlockhash = blockhash
      depositTx.lastValidBlockHeight = adjustedLastValidBlockHeight

      // Sign with bonding curve keypair for token transfer
      depositTx.partialSign(bondingCurveKeypair)

      // Serialize the transaction
      const serializedTx = depositTx.serialize({ requireAllSignatures: false }).toString('base64')

      logger.info('Deposit transaction created', {
        from: fromAccount,
        to: toAccount,
        totalAmount: Number(totalAmount) / (10 ** TOKEN_DECIMALS),
        feeAmount: Number(feeAmount) / (10 ** TOKEN_DECIMALS),
        depositAmount: Number(depositAmount) / (10 ** TOKEN_DECIMALS),
        tokensToReceive,
        validUntilBlock: adjustedLastValidBlockHeight
      })

      return NextResponse.json({
        transaction: serializedTx,
        validUntilBlock: adjustedLastValidBlockHeight,
        details: {
          totalAmount: Number(totalAmount) / (10 ** TOKEN_DECIMALS),
          feeAmount: Number(feeAmount) / (10 ** TOKEN_DECIMALS),
          transferAmount: Number(depositAmount) / (10 ** TOKEN_DECIMALS),
          tokensToReceive,
          from: fromAccount,
          to: toAccount,
          platformAddress: pumpTokenAccount.toString(),
          isDeposit: true
        }
      })
    }

    // Regular transfer if not a bonding curve
    const pumpTokenAccount = await getAssociatedTokenAddress(
      new PublicKey(SWARMS_TOKEN_ADDRESS),
      new PublicKey(SWARMS_PUMP_ADDRESS),
      true
    )

    // Calculate amounts with 6 decimals
    const totalAmount = BigInt(swarmsAmount) * BigInt(10 ** 6)
    const feeAmount = totalAmount * BigInt(1) / BigInt(100) // 1% fee
    const transferAmount = totalAmount - feeAmount // 99% to destination

    // Create transfer transaction
    const transferTx = new Transaction()

    // Add compute budget instructions
    const computeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })
    const priorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 })
    transferTx.add(computeUnits, priorityFee)

    // Add 1% fee transfer to platform
    transferTx.add(
      createTransferInstruction(
        fromTokenAccount,
        pumpTokenAccount,
        userPublicKey,
        Number(feeAmount) // Convert BigInt to number for the instruction
      )
    )

    // Add 99% transfer to destination
    transferTx.add(
      createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        userPublicKey,
        Number(transferAmount) // Convert BigInt to number for the instruction
      )
    )

    // Add memo instruction to show amounts in Phantom
    transferTx.add(
      new TransactionInstruction({
        keys: [],
        programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
        data: Buffer.from(`Transfer ${Number(transferAmount) / (10 ** 6)} SWARMS (Fee: ${Number(feeAmount) / (10 ** 6)} SWARMS)`)
      })
    )

    transferTx.feePayer = userPublicKey

    // Get fresh blockhash right before serializing
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('processed')
    const adjustedLastValidBlockHeight = lastValidBlockHeight + 1500 // Add 1500 blocks (~10-12 minutes) for validity
    
    transferTx.recentBlockhash = blockhash
    transferTx.lastValidBlockHeight = adjustedLastValidBlockHeight

    // Serialize the transaction
    const serializedTx = transferTx.serialize({ requireAllSignatures: false }).toString('base64')

    logger.info('Transfer transaction created', {
      from: fromAccount,
      to: toAccount,
      totalAmount: Number(totalAmount) / (10 ** 6),
      feeAmount: Number(feeAmount) / (10 ** 6),
      transferAmount: Number(transferAmount) / (10 ** 6),
      validUntilBlock: adjustedLastValidBlockHeight
    })

    return NextResponse.json({
      transaction: serializedTx,
      validUntilBlock: adjustedLastValidBlockHeight,
      details: {
        totalAmount: Number(totalAmount) / (10 ** 6),
        feeAmount: Number(feeAmount) / (10 ** 6),
        transferAmount: Number(transferAmount) / (10 ** 6),
        from: fromAccount,
        to: toAccount,
        platformAddress: pumpTokenAccount.toString(),
        isSwap: false
      }
    })

  } catch (error) {
    logger.error('Failed to create transfer transaction', error as Error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create transfer transaction' },
      { status: 500 }
    )
  }
}

export async function PUT(req: Request) {
  try {
    const { signedTransaction } = await req.json()

    if (!signedTransaction) {
      return NextResponse.json({ error: 'Signed transaction is required' }, { status: 400 })
    }

    const connection = new Connection(RPC_URL, {
      commitment: 'processed',
      confirmTransactionInitialTimeout: 60000
    })

    try {
      // Deserialize the signed transaction
      const tx = Transaction.from(Buffer.from(signedTransaction, 'base64'))
      
      // Send the transaction without modifying blockhash
      const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'processed',
        maxRetries: 3
      })

      logger.info('Transaction sent to network', { signature })

      // Wait for confirmation with retries using getSignatureStatus
      let confirmed = false
      let retries = 0
      const maxRetries = 10
      const maxAttempts = 30
      let attempts = 0

      while (!confirmed && retries < maxRetries && attempts < maxAttempts) {
        try {
          // Wait a bit before checking status
          await new Promise(resolve => setTimeout(resolve, 1000))
          attempts++

          const status = await connection.getSignatureStatus(signature)
          
          if (status.value?.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`)
          }

          if (status.value?.confirmationStatus === 'processed' || 
              status.value?.confirmationStatus === 'confirmed' || 
              status.value?.confirmationStatus === 'finalized') {
            confirmed = true
            logger.info('Transfer transaction confirmed', { 
              signature,
              confirmationStatus: status.value.confirmationStatus 
            })
            break
          }

        } catch (error) {
          retries++
          if (retries === maxRetries) {
            throw error
          }
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }

      if (!confirmed) {
        throw new Error('Transaction confirmation timeout')
      }

      return NextResponse.json({ signature })

    } catch (txError) {
      logger.error('Transaction execution failed', txError as Error)
      return NextResponse.json(
        { error: txError instanceof Error ? txError.message : 'Transaction execution failed' },
        { status: 400 }
      )
    }

  } catch (error) {
    logger.error('Failed to process request', error as Error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process request' },
      { status: 500 }
    )
  }
} 