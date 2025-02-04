import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  SendTransactionError,
  LAMPORTS_PER_SOL,
  Signer,
} from '@solana/web3.js'
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMintInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
  createInitializeAccountInstruction,
} from '@solana/spl-token'
import { logger } from '../logger'
import { 
  InsufficientBalanceError, 
  TransactionError, 
  WalletError,
  ValidationError 
} from './errors'
import { sleep, retry } from '../utils'
import { PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID } from '@metaplex-foundation/mpl-token-metadata'
import { CreateMetadataAccountV3Instruction } from '@metaplex-foundation/mpl-token-metadata'

const MAX_RETRIES = 3
const CONFIRMATION_TIMEOUT = 60000 // 60 seconds
const MIN_SOL_BALANCE = 0.05 // 0.05 SOL minimum required

interface PhantomWallet {
  publicKey: PublicKey
  isConnected: boolean
  signTransaction: (tx: Transaction) => Promise<Transaction>
}

interface TokenCreationParams {
  connection: Connection
  wallet: PhantomWallet
  supply: number
  decimals?: number
  freezeAuthority?: PublicKey
  bondingCurveAccount?: PublicKey
  name: string
  symbol: string
  uri: string
}

interface TokenCreationResult {
  mint: PublicKey
  userTokenAccount: PublicKey
  signature: string
}

interface TokenSigner {
  publicKey: PublicKey
  signTransaction(tx: Transaction): Promise<Transaction>
}

// Helper function to derive metadata PDA
async function getMetadataAddress(mint: PublicKey): Promise<PublicKey> {
  const [metadataAddress] = await PublicKey.findProgramAddress(
    [
      Buffer.from('metadata'),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  )
  return metadataAddress
}

async function validateParams(params: TokenCreationParams): Promise<void> {
  const errors: Record<string, string> = {}

  if (!params.connection) {
    errors.connection = 'Connection is required'
  }

  if (!params.wallet?.isConnected) {
    errors.wallet = 'Wallet must be connected'
  }

  if (!params.supply || params.supply < 1000) {
    errors.supply = 'Supply must be at least 1,000 tokens'
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Invalid parameters', errors)
  }
}

async function checkAndFundAccount(
  connection: Connection,
  wallet: any,
  mintKeypair: Keypair,
  rentExemptBalance: number
): Promise<void> {
  logger.info('Checking wallet balance', {
    wallet: wallet.publicKey.toString(),
    required: MIN_SOL_BALANCE
  })

  const balance = await connection.getBalance(new PublicKey(wallet.publicKey.toString()))
  const balanceInSOL = balance / LAMPORTS_PER_SOL
  
  if (balanceInSOL < MIN_SOL_BALANCE) {
    throw new InsufficientBalanceError(balanceInSOL, MIN_SOL_BALANCE)
  }

  logger.info('Funding mint account', {
    mint: mintKeypair.publicKey.toString(),
    amount: rentExemptBalance / LAMPORTS_PER_SOL
  })

  const transaction = new Transaction()
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(wallet.publicKey.toString()),
      toPubkey: mintKeypair.publicKey,
      lamports: rentExemptBalance
    })
  )

  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
    transaction.recentBlockhash = blockhash
    transaction.lastValidBlockHeight = lastValidBlockHeight

    const signed = await wallet.signTransaction(transaction)
    const signature = await connection.sendRawTransaction(signed.serialize())
    
    await confirmTransaction(connection, signature)
    
    logger.info('Successfully funded mint account', { signature })
  } catch (error) {
    logger.error('Failed to fund mint account', error as Error)
    throw new TransactionError('Failed to fund mint account', undefined, 
      error instanceof SendTransactionError ? error.logs : undefined
    )
  }
}

async function confirmTransaction(
  connection: Connection,
  signature: string,
  timeout: number = CONFIRMATION_TIMEOUT
): Promise<void> {
  const start = Date.now()
  
  while (Date.now() - start < timeout) {
    const confirmation = await connection.confirmTransaction(signature)
    
    if (confirmation.value.err) {
      throw new TransactionError(
        'Transaction failed to confirm',
        signature,
        confirmation.value.err as any
      )
    }

    if (!confirmation.value.err) {
      return
    }

    await sleep(1000)
  }

  throw new TransactionError('Transaction confirmation timeout', signature)
}

async function getOrCreateTokenAccount(
  connection: Connection,
  signer: TokenSigner,
  mint: PublicKey,
  owner: PublicKey
) {
  return getOrCreateAssociatedTokenAccount(
    connection,
    signer as any, // Type assertion needed due to @solana/spl-token types
    mint,
    owner
  )
}

export async function createTokenAndMint(
  params: TokenCreationParams
): Promise<TokenCreationResult> {
  const { 
    connection, 
    wallet, 
    supply, 
    decimals = 9, 
    bondingCurveAccount,
    name,
    symbol,
    uri
  } = params
  
  try {
    // Validate parameters
    await validateParams(params)
    if (!bondingCurveAccount) {
      throw new Error('Bonding curve account is required')
    }

    // Generate mint keypair
    const mintKeypair = Keypair.generate()
    logger.info('Generated mint keypair', {
      mint: mintKeypair.publicKey.toString()
    })

    // Get minimum balance for rent exemption
    const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(
      MINT_SIZE
    )

    // Create transaction for token creation
    const createAndMintTx = new Transaction()

    // 1. Create mint account
    createAndMintTx.add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports: rentExemptBalance,
        programId: TOKEN_PROGRAM_ID,
      })
    )

    // 2. Initialize mint with decimals and mint authority
    createAndMintTx.add(
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        decimals,
        bondingCurveAccount, // Set bonding curve as mint authority
        null, // No freeze authority
        TOKEN_PROGRAM_ID
      )
    )

    // 3. Create bonding curve token account
    createAndMintTx.add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: bondingCurveAccount,
        space: 165, // Token account size
        lamports: await connection.getMinimumBalanceForRentExemption(165),
        programId: TOKEN_PROGRAM_ID,
      })
    )

    // 4. Initialize token account
    createAndMintTx.add(
      createInitializeAccountInstruction(
        bondingCurveAccount,
        mintKeypair.publicKey,
        bondingCurveAccount,
        TOKEN_PROGRAM_ID
      )
    )

    // 5. Mint initial supply
    createAndMintTx.add(
      createMintToInstruction(
        mintKeypair.publicKey,
        bondingCurveAccount,
        bondingCurveAccount,
        BigInt(supply * (10 ** decimals))
      )
    )

    // 6. Revoke mint authority
    createAndMintTx.add(
      createSetAuthorityInstruction(
        mintKeypair.publicKey,
        bondingCurveAccount,
        AuthorityType.MintTokens,
        null
      )
    )

    // 7. Create metadata account
    const metadataAddress = await getMetadataAddress(mintKeypair.publicKey)
    const metadataSpace = 607 // Size for metadata v3

    // Transfer lamports for metadata account rent
    createAndMintTx.add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: metadataAddress,
        lamports: await connection.getMinimumBalanceForRentExemption(metadataSpace)
      })
    )

    // Allocate space for metadata account
    createAndMintTx.add(
      SystemProgram.allocate({
        accountPubkey: metadataAddress,
        space: metadataSpace
      })
    )

    // Assign metadata account to Token Metadata Program
    createAndMintTx.add(
      SystemProgram.assign({
        accountPubkey: metadataAddress,
        programId: TOKEN_METADATA_PROGRAM_ID
      })
    )

    // Create metadata account
    createAndMintTx.add(
      createCreateMetadataAccountV3Instruction(
        {
          metadata: metadataAddress,
          mint: mintKeypair.publicKey,
          mintAuthority: bondingCurveAccount,
          payer: wallet.publicKey,
          updateAuthority: bondingCurveAccount
        },
        {
          createMetadataAccountArgsV3: {
            data: {
              name,
              symbol,
              uri,
              sellerFeeBasisPoints: 0,
              creators: null,
              collection: null,
              uses: null
            },
            isMutable: false,
            collectionDetails: null
          }
        }
      )
    )

    // Get latest blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
    createAndMintTx.recentBlockhash = blockhash
    createAndMintTx.lastValidBlockHeight = lastValidBlockHeight

    // Sign transaction
    const signedTx = await wallet.signTransaction(createAndMintTx)
    signedTx.partialSign(mintKeypair)
    
    // Send transaction
    const signature = await retry(
      () => connection.sendRawTransaction(signedTx.serialize()),
      MAX_RETRIES
    )

    await confirmTransaction(connection, signature)
    logger.info('Token created and initial supply minted', { 
      signature,
      mint: mintKeypair.publicKey.toString(),
      bondingCurve: bondingCurveAccount.toString()
    })

    return {
      mint: mintKeypair.publicKey,
      userTokenAccount: bondingCurveAccount,
      signature
    }

  } catch (error) {
    if (error instanceof ValidationError || 
        error instanceof InsufficientBalanceError || 
        error instanceof TransactionError || 
        error instanceof WalletError) {
      throw error
    }

    logger.error('Unexpected error in token creation', error as Error)
    throw new TransactionError(
      'Failed to create token',
      undefined,
      error instanceof SendTransactionError ? error.logs : undefined
    )
  }
}

