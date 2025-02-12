import { Connection, ConnectionConfig } from '@solana/web3.js'
import { logger } from '@/lib/logger'

export type Priority = 'HIGH' | 'MEDIUM' | 'LOW'

interface RPCRequest {
  id: string
  priority: Priority
  operation: () => Promise<any>
  timestamp: number
  maxRetries: number
  retryCount: number
  timeout: number
  resolve: (value: any) => void
  reject: (error: any) => void
}

interface QueueMetrics {
  queueLength: number
  processingTime: number
  successCount: number
  failureCount: number
  retryCount: number
  rateLimitHits: number
}

interface PriorityConfig {
  maxRetries: number
  timeout: number
  rateLimit: number
  processingDelay: number
}

export class RPCPriorityQueue {
  private highPriorityQueue: RPCRequest[] = []
  private mediumPriorityQueue: RPCRequest[] = []
  private lowPriorityQueue: RPCRequest[] = []
  private isProcessing: boolean = false
  private connection: Connection
  private metrics: Record<Priority, QueueMetrics> = {
    HIGH: this.initializeMetrics(),
    MEDIUM: this.initializeMetrics(),
    LOW: this.initializeMetrics()
  }

  private priorityConfig: Record<Priority, PriorityConfig> = {
    HIGH: {
      maxRetries: 3,
      timeout: 10000,
      rateLimit: 100,
      processingDelay: 0
    },
    MEDIUM: {
      maxRetries: 5,
      timeout: 30000,
      rateLimit: 50,
      processingDelay: 100
    },
    LOW: {
      maxRetries: 2,
      timeout: 60000,
      rateLimit: 20,
      processingDelay: 250
    }
  }

  private rateLimitWindows: Record<Priority, { count: number, timestamp: number }> = {
    HIGH: { count: 0, timestamp: Date.now() },
    MEDIUM: { count: 0, timestamp: Date.now() },
    LOW: { count: 0, timestamp: Date.now() }
  }

  constructor(endpoint: string, config: ConnectionConfig) {
    this.connection = new Connection(endpoint, config)
  }

  private initializeMetrics(): QueueMetrics {
    return {
      queueLength: 0,
      processingTime: 0,
      successCount: 0,
      failureCount: 0,
      retryCount: 0,
      rateLimitHits: 0
    }
  }

  private getQueue(priority: Priority): RPCRequest[] {
    switch (priority) {
      case 'HIGH':
        return this.highPriorityQueue
      case 'MEDIUM':
        return this.mediumPriorityQueue
      case 'LOW':
        return this.lowPriorityQueue
    }
  }

  private updateRateLimitWindow(priority: Priority) {
    const now = Date.now()
    const window = this.rateLimitWindows[priority]

    if (now - window.timestamp >= 1000) {
      window.count = 1
      window.timestamp = now
    } else {
      window.count++
    }
  }

  private isRateLimited(priority: Priority): boolean {
    const window = this.rateLimitWindows[priority]
    const config = this.priorityConfig[priority]

    if (Date.now() - window.timestamp >= 1000) {
      return false
    }

    if (window.count >= config.rateLimit) {
      this.metrics[priority].rateLimitHits++
      return true
    }

    return false
  }

  private async processRequest(request: RPCRequest): Promise<void> {
    const startTime = Date.now()
    const config = this.priorityConfig[request.priority]

    try {
      if (this.isRateLimited(request.priority)) {
        // Requeue if rate limited
        this.getQueue(request.priority).push(request)
        return
      }

      this.updateRateLimitWindow(request.priority)

      // Add processing delay based on priority
      await new Promise(resolve => setTimeout(resolve, config.processingDelay))

      const result = await Promise.race([
        request.operation(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), request.timeout)
        )
      ])

      this.metrics[request.priority].successCount++
      this.metrics[request.priority].processingTime += Date.now() - startTime
      request.resolve(result)
    } catch (error) {
      if (request.retryCount < request.maxRetries) {
        request.retryCount++
        this.metrics[request.priority].retryCount++
        
        // Exponential backoff for retries
        const backoffDelay = Math.min(1000 * Math.pow(2, request.retryCount - 1), 10000)
        setTimeout(() => {
          this.getQueue(request.priority).push(request)
        }, backoffDelay)
      } else {
        this.metrics[request.priority].failureCount++
        request.reject(error)
        
        if (request.priority === 'HIGH') {
          const errorToLog = error instanceof Error ? error : new Error('Unknown error')
          logger.error('High priority RPC request failed', errorToLog, {
            requestId: request.id,
            retries: request.retryCount
          })
        }
      }
    }
  }

  private async processQueues() {
    if (this.isProcessing) return

    this.isProcessing = true

    while (
      this.highPriorityQueue.length > 0 ||
      this.mediumPriorityQueue.length > 0 ||
      this.lowPriorityQueue.length > 0
    ) {
      // Process high priority first
      if (this.highPriorityQueue.length > 0) {
        const request = this.highPriorityQueue.shift()!
        await this.processRequest(request)
        continue
      }

      // Then medium priority
      if (this.mediumPriorityQueue.length > 0) {
        const request = this.mediumPriorityQueue.shift()!
        await this.processRequest(request)
        continue
      }

      // Finally low priority
      if (this.lowPriorityQueue.length > 0) {
        const request = this.lowPriorityQueue.shift()!
        await this.processRequest(request)
      }
    }

    this.isProcessing = false
  }

  public async enqueue<T>(
    priority: Priority,
    operation: () => Promise<T>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const request: RPCRequest = {
        id: Math.random().toString(36).substring(7),
        priority,
        operation,
        timestamp: Date.now(),
        maxRetries: this.priorityConfig[priority].maxRetries,
        retryCount: 0,
        timeout: this.priorityConfig[priority].timeout,
        resolve,
        reject
      }

      const queue = this.getQueue(priority)
      queue.push(request)
      this.metrics[priority].queueLength = queue.length

      if (!this.isProcessing) {
        this.processQueues()
      }
    })
  }

  public getMetrics(): Record<Priority, QueueMetrics> {
    return this.metrics
  }

  public getConnection(): Connection {
    return this.connection
  }
} 