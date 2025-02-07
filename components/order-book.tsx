'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useConnection } from '@solana/wallet-adapter-react'

interface OrderBookProps {
  mintAddress: string
  symbol: string
}

interface Transaction {
  signature: string
  price: number
  size: number
  side: 'buy' | 'sell'
  timestamp: number
}

// Cache for ongoing requests
const requestCache: { [key: string]: Promise<any> } = {}

export function OrderBook({ mintAddress, symbol }: OrderBookProps) {
  const { connection } = useConnection()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        
        // Check if there's already an ongoing request for this mintAddress
        if (!requestCache[mintAddress]) {
          requestCache[mintAddress] = fetch(`/api/solana/meteora/market?mintAddress=${mintAddress}`)
            .then(async (response) => {
              const data = await response.json()
              // Clear the cache after request completes
              delete requestCache[mintAddress]
              return data
            })
            .catch((error) => {
              // Clear the cache if request fails
              delete requestCache[mintAddress]
              throw error
            })
        }

        // Use the cached request
        const data = await requestCache[mintAddress]
        setTransactions(data.transactions)
      } catch (error) {
        console.error('Failed to fetch market data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()

    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000)
    return () => {
      clearInterval(interval)
      // Clean up cache on unmount
      delete requestCache[mintAddress]
    }
  }, [mintAddress])

  // Sort transactions by timestamp, most recent first
  const sortedTransactions = [...transactions].sort((a, b) => b.timestamp - a.timestamp)

  return (
    <Card className="bg-black/50 border-red-600/20">
      <CardHeader>
        <CardTitle>Recent Trades</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center text-gray-400">Loading transactions...</div>
        ) : transactions.length > 0 ? (
          <div className="space-y-1">
            {/* Header */}
            <div className="grid grid-cols-4 text-xs font-mono text-gray-400 pb-2">
              <span>Price</span>
              <span className="text-right">Size</span>
              <span className="text-right">Total</span>
              <span className="text-right">Time</span>
            </div>
            
            {/* Transactions */}
            {sortedTransactions.map((tx, i) => (
              <div key={tx.signature} className="grid grid-cols-4 text-xs font-mono">
                <span className={tx.side === 'buy' ? 'text-green-500' : 'text-red-500'}>
                  ${tx.price.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                </span>
                <span className="text-right">
                  {tx.size.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                </span>
                <span className="text-right text-gray-400">
                  ${(tx.price * tx.size).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-right text-gray-400">
                  {new Date(tx.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-gray-400">No recent trades</div>
        )}
      </CardContent>
    </Card>
  )
}

