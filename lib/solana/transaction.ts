import { Transaction, Keypair, Connection, SendTransactionError, PublicKey, TransactionInstruction } from "@solana/web3.js"
import { logger } from "../logger"
import { sleep } from "../utils"

const MAX_RETRIES = 3
const CONFIRMATION_TIMEOUT = 60000 // 60 seconds
const MAX_TRANSACTION_SIZE = 1232 // Maximum size in bytes
const MAX_INSTRUCTIONS = 20 // Maximum number of instructions per transaction
const RATE_LIMIT_WINDOW = 60000 // 1 minute window
const MAX_TRANSACTIONS_PER_WINDOW = 10 // Maximum transactions per window

// Rate limiting map: wallet public key -> timestamps of recent transactions
const transactionRateLimit = new Map<string, number[]>()

interface PhantomWallet {
  publicKey: PublicKey
  signTransaction: (tx: Transaction) => Promise<Transaction>
  signAndSendTransaction?: (tx: Transaction) => Promise<{ signature: string }>
}

// Security validation functions
function validateTransaction(transaction: Transaction): void {
  if (!transaction) {
    throw new Error("Invalid transaction: Transaction cannot be null")
  }

  // Check transaction size
  const rawTransaction = transaction.serialize()
  if (rawTransaction.length > MAX_TRANSACTION_SIZE) {
    throw new Error(`Transaction too large: ${rawTransaction.length} bytes`)
  }

  // Check number of instructions
  if (transaction.instructions.length > MAX_INSTRUCTIONS) {
    throw new Error(`Too many instructions: ${transaction.instructions.length}`)
  }

  // Validate each instruction
  transaction.instructions.forEach((instruction: TransactionInstruction, index: number) => {
    if (!instruction.programId || !instruction.keys || !instruction.data) {
      throw new Error(`Invalid instruction at index ${index}`)
    }
  })
}

function enforceRateLimit(walletPublicKey: string): void {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW
  
  // Get or initialize transaction timestamps for this wallet
  let timestamps = transactionRateLimit.get(walletPublicKey) || []
  
  // Remove old timestamps outside the window
  timestamps = timestamps.filter(timestamp => timestamp > windowStart)
  
  // Check rate limit
  if (timestamps.length >= MAX_TRANSACTIONS_PER_WINDOW) {
    throw new Error(`Rate limit exceeded for wallet ${walletPublicKey}`)
  }
  
  // Add current timestamp and update map
  timestamps.push(now)
  transactionRateLimit.set(walletPublicKey, timestamps)
}

export async function signTransaction(transaction: Transaction, privateKey: Uint8Array): Promise<Transaction> {
  try {
    // Validate inputs
    if (!privateKey || privateKey.length !== 64) {
      throw new Error("Invalid private key")
    }
    
    validateTransaction(transaction)

    const connection = new Connection(process.env.RPC_URL as string, "confirmed")
    const signer = Keypair.fromSecretKey(privateKey)
    
    // Verify the transaction hasn't been tampered with
    if (transaction.feePayer && !transaction.feePayer.equals(signer.publicKey)) {
      throw new Error("Transaction fee payer mismatch")
    }
    
    transaction.feePayer = signer.publicKey
    
    const { blockhash } = await connection.getLatestBlockhash()
    transaction.recentBlockhash = blockhash
    
    // Sign and verify signature
    transaction.sign(signer)
    if (!transaction.verifySignatures()) {
      throw new Error("Transaction signature verification failed")
    }

    logger.info("Transaction signed successfully", {
      signer: signer.publicKey.toString(),
      numInstructions: transaction.instructions.length,
      transactionSize: transaction.serialize().length,
    })

    return transaction
  } catch (error: any) {
    logger.error("Failed to sign transaction", error as Error)
    throw error
  }
}

export async function signAndSendTransaction(
  connection: Connection,
  transaction: Transaction,
  wallet: PhantomWallet,
  additionalSigners: Keypair[] = [],
  skipPreflight: boolean = false
): Promise<{ signature: string; result: any }> {
  let lastError: Error | undefined
  
  try {
    // Validate wallet
    if (!wallet.publicKey) {
      throw new Error("Invalid wallet: missing public key")
    }

    // Validate transaction before processing
    validateTransaction(transaction)
    
    // Enforce rate limiting
    enforceRateLimit(wallet.publicKey.toString())

  } catch (error) {
    logger.error("Pre-transaction validation failed", error as Error)
    throw error
  }
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Get fresh blockhash for each attempt
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
      transaction.recentBlockhash = blockhash
      transaction.lastValidBlockHeight = lastValidBlockHeight
      transaction.feePayer = wallet.publicKey

      // Sign with wallet
      let signedTransaction: Transaction
      if (wallet.signAndSendTransaction && additionalSigners.length === 0) {
        // Verify wallet interface before using built-in send
        if (typeof wallet.signAndSendTransaction !== 'function') {
          throw new Error("Invalid wallet: signAndSendTransaction is not a function")
        }
        
        const { signature } = await wallet.signAndSendTransaction(transaction)
        if (!signature || typeof signature !== 'string') {
          throw new Error("Invalid signature returned from wallet")
        }
        
        const result = await confirmTransaction(connection, signature)
        return { signature, result }
      } else {
        // Manual signing flow for complex transactions
        signedTransaction = await wallet.signTransaction(transaction)
        
        // Verify signature before proceeding
        if (!signedTransaction.verifySignatures()) {
          throw new Error("Primary signature verification failed")
        }
        
        // Sign with any additional signers
        if (additionalSigners.length > 0) {
          signedTransaction.partialSign(...additionalSigners)
          // Verify all signatures after additional signing
          if (!signedTransaction.verifySignatures()) {
            throw new Error("Additional signatures verification failed")
          }
        }

        // Final transaction validation before sending
        validateTransaction(signedTransaction)

        // Send transaction with additional security options
        const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
          skipPreflight,
          preflightCommitment: 'confirmed',
          maxRetries: 3,
        })

        const result = await confirmTransaction(connection, signature)
        return { signature, result }
      }
    } catch (error) {
      lastError = error as Error
      logger.warn(`Transaction attempt ${attempt + 1} failed`, { 
        error: lastError.message,
        errorType: lastError.constructor.name,
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
      })
      
      if (error instanceof SendTransactionError) {
        const transactionLogs = await getTransactionLogs(connection, error)
        logger.error("Transaction failed", error as Error)
      }

      if (attempt === MAX_RETRIES - 1) {
        throw lastError
      }

      await sleep(1000 * Math.pow(2, attempt))
    }
  }

  throw lastError || new Error('Transaction failed after all retries')
}

async function confirmTransaction(
  connection: Connection,
  signature: string,
  timeout: number = CONFIRMATION_TIMEOUT
): Promise<any> {
  const start = Date.now()
  
  while (Date.now() - start < timeout) {
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash: await connection.getLatestBlockhash().then(res => res.blockhash),
      lastValidBlockHeight: await connection.getLatestBlockhash().then(res => res.lastValidBlockHeight),
    }, 'confirmed')
    
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`)
    }

    if (!confirmation.value.err) {
      return confirmation.value
    }

    await sleep(1000)
  }

  throw new Error('Transaction confirmation timeout')
}

// Helper function to safely get transaction logs
async function getTransactionLogs(
  connection: Connection,
  error: SendTransactionError
): Promise<string[]> {
  try {
    if (error.logs?.length) {
      return error.logs
    }
    
    const sigMatch = error.message.match(/Transaction ([A-Za-z0-9]+) failed/)
    const signature = sigMatch?.[1]
    
    if (!signature) {
      return ['No transaction signature available']
    }

    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0
    })
    
    return tx?.meta?.logMessages || ['No logs available']
  } catch (e) {
    logger.error('Failed to get transaction logs', e as Error)
    return ['Failed to retrieve transaction logs']
  }
} 
