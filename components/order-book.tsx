'use client'

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface OrderBookProps {
  mintAddress: string
  symbol: string
  transactions: Array<{
    signature: string
    price: number
    size: number
    side: 'buy' | 'sell'
    timestamp: number
  }>
}

export function OrderBook({ mintAddress, symbol, transactions }: OrderBookProps) {
  // Sort transactions by timestamp, most recent first
  const sortedTransactions = [...transactions].sort((a, b) => b.timestamp - a.timestamp)

  return (
    <Card className="bg-black/50 border-red-600/20">
      <CardHeader>
        <CardTitle>Recent Trades</CardTitle>
      </CardHeader>
      <CardContent>
        {transactions.length > 0 ? (
          <div className="space-y-1">
            {/* Header */}
            <div className="grid grid-cols-4 text-xs font-mono text-gray-400 pb-2">
              <span>Price</span>
              <span className="text-right">Size</span>
              <span className="text-right">Total</span>
              <span className="text-right">Time</span>
            </div>
            
            {/* Transactions */}
            {sortedTransactions.map((tx) => (
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

