import { ConnectionConfig } from '@solana/web3.js'
import { RPCClient } from './client'

if (!process.env.RPC_URL) {
  throw new Error('RPC_URL environment variable is not set')
}

export const RPC_ENDPOINT = process.env.RPC_URL

export const RPC_CONFIG: ConnectionConfig = {
  commitment: 'confirmed',
  disableRetryOnRateLimit: false,
  confirmTransactionInitialTimeout: 60000,
  httpHeaders: {
    'Content-Type': 'application/json',
  },
}

// Create a singleton instance of the RPC client
let rpcClient: RPCClient | null = null

export function getRPCClient(): RPCClient {
  if (!rpcClient) {
    rpcClient = new RPCClient(RPC_ENDPOINT, RPC_CONFIG)
  }
  return rpcClient
}

// Reset the RPC client (useful for testing or when connection needs to be refreshed)
export function resetRPCClient(): void {
  rpcClient = null
} 