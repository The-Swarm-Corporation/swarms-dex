import { Transaction, Keypair, Connection, SendTransactionError, PublicKey } from "@solana/web3.js"
import { logger } from "../logger"
import { sleep } from "../utils"

const MAX_RETRIES = 3
const CONFIRMATION_TIMEOUT = 60000 // 60 seconds

interface PhantomWallet {
  publicKey: PublicKey
  signTransaction: (tx: Transaction) => Promise<Transaction>
  signAndSendTransaction?: (tx: Transaction) => Promise<{ signature: string }>
}

export async function signTransaction(transaction: Transaction, privateKey: Uint8Array): Promise<Transaction> {
  try {
    const connection = new Connection(process.env.RPC_URL as string, "confirmed")
    const signer = Keypair.fromSecretKey(privateKey)
    transaction.feePayer = signer.publicKey
    
    const { blockhash } = await connection.getLatestBlockhash()
    transaction.recentBlockhash = blockhash
    transaction.sign(signer)

    logger.info("Transaction signed successfully", {
      signer: signer.publicKey.toString(),
    })

    return transaction
  } catch (error) {
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
        // Use wallet's built-in send for simple transactions
        const { signature } = await wallet.signAndSendTransaction(transaction)
        const result = await confirmTransaction(connection, signature)
        return { signature, result }
      } else {
        // Manual signing flow for complex transactions
        signedTransaction = await wallet.signTransaction(transaction)
        
        // Sign with any additional signers
        if (additionalSigners.length > 0) {
          signedTransaction.partialSign(...additionalSigners)
        }

        // Send transaction
        const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
          skipPreflight,
          preflightCommitment: 'confirmed',
        })

        const result = await confirmTransaction(connection, signature)
        return { signature, result }
      }
    } catch (error) {
      lastError = error as Error
      logger.warn(`Transaction attempt ${attempt + 1} failed`, { error: lastError.message })
      
      if (error instanceof SendTransactionError) {
        const transactionLogs = await getTransactionLogs(connection, error)
        logger.error('Transaction failed', error as Error)
        logger.info('Transaction logs:', { transactionLogs: transactionLogs.join('\n') })
      }

      // If it's the last attempt, throw the error
      if (attempt === MAX_RETRIES - 1) {
        throw lastError
      }

      // Wait before retrying with exponential backoff
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
