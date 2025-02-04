'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MarketService, Order } from '@/lib/market'
import { formatDistance } from 'date-fns'
import { ArrowDownRight, ArrowUpRight, Loader2 } from 'lucide-react'

interface OrderBookProps {
  mintAddress: string
  symbol: string
}

export function OrderBook({ mintAddress, symbol }: OrderBookProps) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const marketService = new MarketService(mintAddress)
    setLoading(true)

    const unsubscribe = marketService.subscribe((newOrders) => {
      setOrders(prev => {
        const combined = [...newOrders, ...prev]
        // Keep only last 10 orders
        return combined.slice(0, 10)
      })
      setLoading(false)
    })

    // Cleanup
    return () => {
      unsubscribe()
      marketService.disconnect()
    }
  }, [mintAddress])

  if (error) {
    return (
      <Card className="bg-black/50 border-red-600/20">
        <CardContent className="pt-6">
          <div className="text-red-600 text-center">{error}</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-black/50 border-red-600/20">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-red-600 flex items-center justify-between">
          Live Orders
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {orders.length === 0 && !loading ? (
            <div className="text-center text-gray-400 py-4">
              Waiting for orders...
            </div>
          ) : (
            orders.map((order, index) => (
              <div
                key={order.id}
                className={`flex justify-between items-center p-2 rounded ${
                  order.side === 'buy' 
                    ? 'bg-red-600/10 border border-red-600/20' 
                    : 'bg-gray-800/50 border border-gray-700'
                }`}
              >
                <div className="flex items-center">
                  {order.side === 'buy' ? (
                    <ArrowUpRight className="h-4 w-4 text-red-600 mr-2" />
                  ) : (
                    <ArrowDownRight className="h-4 w-4 text-gray-400 mr-2" />
                  )}
                  <span className={order.side === 'buy' ? 'text-red-600' : 'text-gray-400'}>
                    ${order.price.toFixed(4)}
                  </span>
                </div>
                <div className="text-sm text-gray-400">
                  {order.size.toLocaleString()} {symbol}
                </div>
                <div className="text-xs text-gray-500">
                  {formatDistance(order.time, new Date(), { addSuffix: true })}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}

