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
      logger.info('Destination is a bonding curve account, creating swap transaction', {
        bondingCurveAddress: toAccount,
        mintAddress: agentData.mint_address
      })

      // Create swap transaction
      const swapTx = new Transaction()

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

      // Get bonding curve's SWARMS ATA
      const bondingCurveSwarmsATA = await getAssociatedTokenAddress(
        new PublicKey(SWARMS_TOKEN_ADDRESS),
        bondingCurveKeypair.publicKey
      )

      // Create bonding curve's SWARMS ATA if it doesn't exist
      try {
        await connection.getTokenAccountBalance(bondingCurveSwarmsATA)
      } catch {
        const createAtaIx = createAssociatedTokenAccountInstruction(
          userPublicKey,  // fee payer
          bondingCurveSwarmsATA,
          bondingCurveKeypair.publicKey,
          new PublicKey(SWARMS_TOKEN_ADDRESS)
        )
        swapTx.add(createAtaIx)
      }

      // Get current SWARMS balance
      const swarmsBalance = await connection.getTokenAccountBalance(bondingCurveSwarmsATA)
      const currentSwarmsReserve = Number(swarmsBalance.value.amount) / (10 ** TOKEN_DECIMALS)

      // Get bonding curve's token ATA
      const bondingCurveTokenATA = await getAssociatedTokenAddress(
        new PublicKey(agentData.mint_address),
        bondingCurveKeypair.publicKey
      )

      // Create bonding curve's token ATA if it doesn't exist
      try {
        await connection.getTokenAccountBalance(bondingCurveTokenATA)
      } catch {
        const createAtaIx = createAssociatedTokenAccountInstruction(
          userPublicKey,  // fee payer
          bondingCurveTokenATA,
          bondingCurveKeypair.publicKey,
          new PublicKey(agentData.mint_address)
        )
        swapTx.add(createAtaIx)
      }

      // Get current token balance
      const tokenBalance = await connection.getTokenAccountBalance(bondingCurveTokenATA)
      const currentTokenReserve = Number(tokenBalance.value.amount) / (10 ** TOKEN_DECIMALS)

      // Get user's token ATA
      const userTokenATA = await getAssociatedTokenAddress(
        new PublicKey(agentData.mint_address),
        userPublicKey
      )

      // Calculate amounts with 6 decimals
      const totalAmount = BigInt(swarmsAmount) * BigInt(10 ** TOKEN_DECIMALS)
      const feeAmount = totalAmount * BigInt(1) / BigInt(100) // 1% fee
      const swapAmount = totalAmount - feeAmount // 99% for swap

      // Calculate token allocation based on current SWARMS reserve and new amount
      const tokensToReceive = calculateTokenAmount(
        currentSwarmsReserve,
        Number(swapAmount) / (10 ** TOKEN_DECIMALS)
      )

      // Calculate price diagnostics
      const pricePerToken = Number(swapAmount) / (tokensToReceive * (10 ** TOKEN_DECIMALS))
      const effectivePrice = (Number(swapAmount) / (10 ** TOKEN_DECIMALS)) / tokensToReceive
      const virtualPrice = K_VALUE / (INITIAL_VIRTUAL_SWARMS + currentSwarmsReserve) ** 2

      console.log('Bonding curve pricing diagnostics:', {
        currentSwarmsReserve,
        currentTokenReserve,
        additionalSwarms: Number(swapAmount) / (10 ** TOKEN_DECIMALS),
        tokensToReceive,
        pricePerToken,
        effectivePrice,
        virtualPrice,
        kValue: K_VALUE,
        initialVirtualSwarms: INITIAL_VIRTUAL_SWARMS,
        virtualTokenSupply: VIRTUAL_TOKEN_SUPPLY,
        initialSupply: INITIAL_SUPPLY,
        swapDetails: {
          totalSwarms: Number(totalAmount) / (10 ** TOKEN_DECIMALS),
          fee: Number(feeAmount) / (10 ** TOKEN_DECIMALS),
          netSwarms: Number(swapAmount) / (10 ** TOKEN_DECIMALS)
        }
      })

      // Verify bonding curve has enough tokens
      if (tokensToReceive > currentTokenReserve) {
        throw new Error(`Insufficient token balance in bonding curve. Required: ${tokensToReceive}, Available: ${currentTokenReserve}`)
      }

      // Create user's token ATA if it doesn't exist
      try {
        await connection.getTokenAccountBalance(userTokenATA)
      } catch {
        swapTx.add(
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

      swapTx.add(
        createTransferInstruction(
          fromTokenAccount,
          pumpTokenAccount,
          userPublicKey,
          Number(feeAmount)
        )
      )

      // Add transfer instruction for SWARMS to bonding curve
      swapTx.add(
        createTransferInstruction(
          fromTokenAccount,
          bondingCurveSwarmsATA,  // Send to bonding curve's SWARMS token account
          userPublicKey,
          Number(swapAmount)
        )
      )

      // Add transfer instruction for tokens from bonding curve
      swapTx.add(
        createTransferInstruction(
          bondingCurveTokenATA,
          userTokenATA,
          bondingCurveKeypair.publicKey,
          BigInt(Math.floor(tokensToReceive * (10 ** TOKEN_DECIMALS)))
        )
      )

      // Add memo instruction to show token amount in Phantom
      swapTx.add(
        new TransactionInstruction({
          keys: [],
          programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
          data: Buffer.from(`Swap ${swarmsAmount} SWARMS for ${tokensToReceive.toFixed(4)} ${agentData.token_symbol} @ ${effectivePrice.toFixed(6)} SWARMS/token`)
        })
      )

      swapTx.feePayer = userPublicKey

      // Get fresh blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('processed')
      const adjustedLastValidBlockHeight = lastValidBlockHeight + 1500
      
      swapTx.recentBlockhash = blockhash
      swapTx.lastValidBlockHeight = adjustedLastValidBlockHeight

      // Sign with bonding curve keypair
      swapTx.partialSign(bondingCurveKeypair)

      // Log transaction details before serializing
      console.log('Transaction setup:', {
        instructions: swapTx.instructions.map((ix, index) => ({
          index,
          programId: ix.programId.toString(),
          keys: ix.keys.map(k => ({
            pubkey: k.pubkey.toString(),
            isSigner: k.isSigner,
            isWritable: k.isWritable
          }))
        })),
        signers: swapTx.signatures.map(s => ({
          publicKey: s.publicKey.toString(),
          signature: s.signature ? 'present' : 'missing'
        }))
      })

      // Serialize the transaction
      const serializedTx = swapTx.serialize({ requireAllSignatures: false }).toString('base64')

      // Add detailed console log
      console.log('Swap transaction details:', {
        from: fromAccount,
        to: toAccount,
        totalAmount: Number(totalAmount) / (10 ** TOKEN_DECIMALS),
        feeAmount: Number(feeAmount) / (10 ** TOKEN_DECIMALS),
        swapAmount: Number(swapAmount) / (10 ** TOKEN_DECIMALS),
        currentSwarmsReserve,
        currentTokenReserve,
        tokensToReceive,
        effectivePrice,
        pricePerToken
      })

      logger.info('Swap transaction created', {
        from: fromAccount,
        to: toAccount,
        totalAmount: Number(totalAmount) / (10 ** TOKEN_DECIMALS),
        feeAmount: Number(feeAmount) / (10 ** TOKEN_DECIMALS),
        swapAmount: Number(swapAmount) / (10 ** TOKEN_DECIMALS),
        currentSwarmsReserve,
        currentTokenReserve,
        tokensToReceive,
        validUntilBlock: adjustedLastValidBlockHeight
      })

      return NextResponse.json({
        transaction: serializedTx,
        validUntilBlock: adjustedLastValidBlockHeight,
        details: {
          totalAmount: Number(totalAmount) / (10 ** TOKEN_DECIMALS),
          feeAmount: Number(feeAmount) / (10 ** TOKEN_DECIMALS),
          swapAmount: Number(swapAmount) / (10 ** TOKEN_DECIMALS),
          currentSwarmsReserve,
          currentTokenReserve,
          tokensToReceive,
          from: fromAccount,
          to: toAccount,
          platformAddress: pumpTokenAccount.toString(),
          isSwap: true
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
      
      // Send the transaction
      const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'processed',
        maxRetries: 3
      })

      // Get latest blockhash for confirmation
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('processed')

      // Wait for confirmation using the latest blockhash
      const confirmation = await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight
      }, 'processed')

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`)
      }

      logger.info('Transfer transaction confirmed', { signature })

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