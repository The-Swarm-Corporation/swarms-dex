'use client'

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useState } from "react"

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
  const [page, setPage] = useState(1)
  const tradesPerPage = 20
  
  // Sort transactions by timestamp, most recent first
  const sortedTransactions = [...transactions].sort((a, b) => b.timestamp - a.timestamp)
  const totalPages = Math.ceil(sortedTransactions.length / tradesPerPage)
  const displayedTransactions = sortedTransactions.slice((page - 1) * tradesPerPage, page * tradesPerPage)

  return (
    <Card className="bg-black/50 border-red-600/20">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>Recent Trades</CardTitle>
          {totalPages > 1 && (
            <div className="flex gap-2 text-xs text-gray-400">
              <button 
                onClick={() => setPage(p => Math.max(1, p - 1))} 
                disabled={page === 1}
                className="hover:text-red-500 disabled:opacity-50 disabled:hover:text-gray-400"
              >
                Prev
              </button>
              <span>{page} / {totalPages}</span>
              <button 
                onClick={() => setPage(p => Math.min(totalPages, p + 1))} 
                disabled={page === totalPages}
                className="hover:text-red-500 disabled:opacity-50 disabled:hover:text-gray-400"
              >
                Next
              </button>
            </div>
          )}
        </div>
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
            {displayedTransactions.map((tx) => (
              <div key={tx.signature} className="grid grid-cols-4 text-xs font-mono">
                <span className={tx.side === 'buy' ? 'text-green-500' : 'text-red-500'}>
                  ${tx.price.toLocaleString(undefined, { minimumFractionDigits: 10, maximumFractionDigits: 10 })}
                </span>
                <span className="text-right">
                  {Math.round(tx.size).toLocaleString()}
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

