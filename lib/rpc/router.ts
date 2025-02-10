import { Connection, ConnectionConfig } from '@solana/web3.js'
import { logger } from '@/lib/logger'

interface RpcEndpoint {
  url: string
  weight: number
  failureCount: number
  lastFailure: number
  isDown: boolean
}

export class RpcRouter {
  private endpoints: RpcEndpoint[]
  private currentIndex: number
  private readonly maxFailures: number
  private readonly recoveryTimeMs: number
  private readonly config: ConnectionConfig

  constructor(
    endpoints: Array<{ url: string; weight: number }>,
    config: ConnectionConfig = { commitment: 'confirmed' },
    maxFailures: number = 3,
    recoveryTimeMs: number = 60000
  ) {
    this.endpoints = endpoints.map(e => ({
      ...e,
      failureCount: 0,
      lastFailure: 0,
      isDown: false
    }))
    this.currentIndex = 0
    this.maxFailures = maxFailures
    this.recoveryTimeMs = recoveryTimeMs
    this.config = config
  }

  private getNextEndpoint(): RpcEndpoint {
    const now = Date.now()

    // Reset endpoints that have recovered
    this.endpoints.forEach(endpoint => {
      if (endpoint.isDown && (now - endpoint.lastFailure) > this.recoveryTimeMs) {
        endpoint.isDown = false
        endpoint.failureCount = 0
        logger.info('RPC endpoint recovered', { url: endpoint.url })
      }
    })

    // Get available endpoints
    const availableEndpoints = this.endpoints.filter(e => !e.isDown)
    if (availableEndpoints.length === 0) {
      // If all endpoints are down, reset them all
      this.endpoints.forEach(endpoint => {
        endpoint.isDown = false
        endpoint.failureCount = 0
      })
      logger.warn('All RPC endpoints were down, resetting all endpoints')
      return this.endpoints[0]
    }

    // Round-robin through available endpoints
    this.currentIndex = (this.currentIndex + 1) % availableEndpoints.length
    return availableEndpoints[this.currentIndex]
  }

  private markEndpointFailure(endpoint: RpcEndpoint) {
    endpoint.failureCount++
    endpoint.lastFailure = Date.now()
    
    if (endpoint.failureCount >= this.maxFailures) {
      endpoint.isDown = true
      logger.warn('RPC endpoint marked as down', { 
        url: endpoint.url, 
        failures: endpoint.failureCount 
      })
    }
  }

  public getConnection(): Connection {
    const endpoint = this.getNextEndpoint()
    return new Connection(endpoint.url, this.config)
  }

  public async withRetry<T>(
    operation: (connection: Connection) => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 500
  ): Promise<T> {
      let lastError: Error | null = null
      
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const endpoint = this.getNextEndpoint()
        const connection = new Connection(endpoint.url, this.config)
        
        try {
          const result = await operation(connection)
          return result
        } catch (error) {
          lastError = error as Error
          this.markEndpointFailure(endpoint)
          
          if (attempt < maxRetries - 1) {
            logger.warn('RPC request failed, retrying with different endpoint', {
              url: endpoint.url,
              attempt: attempt + 1,
              error: lastError.message
            })
            await new Promise(resolve => setTimeout(resolve, delayMs))
          }
        }
      }
      
      throw lastError || new Error('Operation failed after all retries')
  }
}

// Create singleton instance with default endpoints
const DEFAULT_RPC_ENDPOINTS = [
  { url: process.env.RPC_URL!, weight: 1 },
  // Add backup RPCs here
  { url: process.env.BACKUP_RPC_URL || process.env.RPC_URL!, weight: 1 },
]

export const rpcRouter = new RpcRouter(DEFAULT_RPC_ENDPOINTS) 