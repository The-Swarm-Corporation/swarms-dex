import { Connection, type ConnectionConfig } from "@solana/web3.js"
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'

export const network = WalletAdapterNetwork.Mainnet
export const RPC_ENDPOINT = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com'
export const CONNECTION_CONFIG: ConnectionConfig = {
  commitment: "confirmed",
  disableRetryOnRateLimit: false,
  confirmTransactionInitialTimeout: 60000,
  httpHeaders: {
    "Content-Type": "application/json",
  },
}

// Implement connection with retry logic
class SolanaConnection {
  private static instance: Connection | null = null
  private static maxRetries = 3

  static async getInstance(): Promise<Connection> {
    if (!this.instance) {
      this.instance = await this.createConnection()
    }
    return this.instance
  }

  private static async createConnection(): Promise<Connection> {
    let lastError: Error | null = null

    for (let retry = 0; retry < this.maxRetries; retry++) {
      try {
        const connection = new Connection(RPC_ENDPOINT, CONNECTION_CONFIG)

        // Test the connection
        await connection.getVersion()

        return connection
      } catch (error) {
        lastError = error as Error
        console.error(`Failed to connect to RPC endpoint (attempt ${retry + 1}):`, error)

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retry + 1)))
      }
    }

    throw new Error(`Failed to connect to Solana RPC endpoint: ${lastError?.message}`)
  }

  static async resetConnection(): Promise<void> {
    this.instance = null
    await this.getInstance()
  }
}

export const getConnection = SolanaConnection.getInstance

