import { 
  Connection, 
  ConnectionConfig, 
  PublicKey, 
  Transaction,
  Commitment,
  GetLatestBlockhashConfig,
  TransactionConfirmationStrategy,
  SignaturesForAddressOptions,
  ParsedTransactionWithMeta,
  GetVersionedTransactionConfig,
  SendOptions
} from '@solana/web3.js'
import { RPCPriorityQueue, Priority } from './priority-queue'
import { logger } from '@/lib/logger'
import AmmImpl from "@mercurial-finance/dynamic-amm-sdk"

export class RPCClient {
  private queue: RPCPriorityQueue

  constructor(endpoint: string, config: ConnectionConfig) {
    this.queue = new RPCPriorityQueue(endpoint, config)
  }

  // High Priority Methods (Trading)
  public async simulateTransaction(
    transaction: Transaction,
    priority: Priority = 'HIGH'
  ) {
    return this.queue.enqueue(priority, () =>
      this.queue.getConnection().simulateTransaction(transaction)
    )
  }

  public async sendRawTransaction(
    rawTransaction: Buffer,
    options?: SendOptions,
    priority: Priority = 'HIGH'
  ) {
    return this.queue.enqueue(priority, () =>
      this.queue.getConnection().sendRawTransaction(rawTransaction, options)
    )
  }

  public async getLatestBlockhash(
    commitment?: Commitment | GetLatestBlockhashConfig,
    priority: Priority = 'HIGH'
  ) {
    return this.queue.enqueue(priority, () =>
      this.queue.getConnection().getLatestBlockhash(commitment)
    )
  }

  public async getParsedAccountInfo(
    publicKey: PublicKey,
    priority: Priority = 'HIGH'
  ) {
    return this.queue.enqueue(priority, () =>
      this.queue.getConnection().getParsedAccountInfo(publicKey)
    )
  }

  // SDK Methods
  public async createMeteoraPair(
    poolKey: PublicKey,
    priority: Priority = 'HIGH'
  ): Promise<AmmImpl> {
    const connection = this.getConnection()
    const amm = await AmmImpl.create(connection, poolKey)
    await this.queue.enqueue(priority, () => amm.updateState())
    return amm
  }

  // Medium Priority Methods (Transaction Processing)
  public async confirmTransaction(
    strategy: TransactionConfirmationStrategy,
    commitment?: Commitment,
    priority: Priority = 'MEDIUM'
  ) {
    return this.queue.enqueue(priority, () =>
      this.queue.getConnection().confirmTransaction(strategy, commitment)
    )
  }

  public async getTransaction(
    signature: string,
    options: GetVersionedTransactionConfig = { maxSupportedTransactionVersion: 0 },
    priority: Priority = 'MEDIUM'
  ) {
    return this.queue.enqueue(priority, () =>
      this.queue.getConnection().getTransaction(signature, options)
    )
  }

  public async getParsedTransaction(
    signature: string,
    options: GetVersionedTransactionConfig = { maxSupportedTransactionVersion: 0 },
    priority: Priority = 'MEDIUM'
  ) {
    return this.queue.enqueue(priority, () =>
      this.queue.getConnection().getParsedTransaction(signature, options)
    )
  }

  // Market Data Methods (Low Priority)
  public async getSignaturesForAddress(
    address: PublicKey,
    options: SignaturesForAddressOptions = {},
    priority: Priority = 'LOW'
  ) {
    return this.queue.enqueue(priority, () =>
      this.queue.getConnection().getSignaturesForAddress(address, options)
    )
  }

  public async getParsedTransactions(
    signatures: string[],
    options: GetVersionedTransactionConfig = { maxSupportedTransactionVersion: 0 },
    priority: Priority = 'LOW'
  ): Promise<(ParsedTransactionWithMeta | null)[]> {
    return this.queue.enqueue(priority, () =>
      this.queue.getConnection().getParsedTransactions(signatures, options)
    )
  }

  public async getTokenAccountBalance(
    tokenAccount: PublicKey,
    priority: Priority = 'LOW'
  ) {
    return this.queue.enqueue(priority, () =>
      this.queue.getConnection().getTokenAccountBalance(tokenAccount)
    )
  }

  public async getTokenSupply(
    mintAddress: PublicKey,
    priority: Priority = 'LOW'
  ) {
    return this.queue.enqueue(priority, () =>
      this.queue.getConnection().getTokenSupply(mintAddress)
    )
  }

  // Utility Methods
  public async withRetry<T>(
    operation: (connection: Connection) => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        return await operation(this.getConnection());
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Operation failed (attempt ${retry + 1}/${maxRetries})`, {
          error: lastError.message,
          retry: retry + 1,
          maxRetries
        });
        
        if (retry < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retry)));
        }
      }
    }
    
    throw lastError || new Error('Operation failed after retries');
  }

  public getMetrics() {
    return this.queue.getMetrics()
  }

  public getConnection(): Connection {
    return this.queue.getConnection()
  }
} 