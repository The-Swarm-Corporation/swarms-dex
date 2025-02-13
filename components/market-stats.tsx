'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface MarketStatsProps {
  mintAddress: string
  symbol: string
  poolData: {
    price: number
    volume24h: number
    apy: number
    marketCap?: number
  } | null
  priceChange24h: number
}

export function MarketStats({ mintAddress, symbol, poolData, priceChange24h }: MarketStatsProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(false)
  }, [poolData])

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
        <CardTitle className="text-xl font-bold text-red-600">
          Market Stats
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Price</span>
            <span className="font-mono font-medium">
              ${(poolData?.price || 0).toLocaleString(undefined, { minimumFractionDigits: 10, maximumFractionDigits: 10 })}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">24h Change</span>
            <span className={`font-mono font-medium ${priceChange24h >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {priceChange24h >= 0 ? '+' : ''}{priceChange24h.toFixed(2)}%
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">24h Volume</span>
            <span className="font-mono font-medium">${(poolData?.volume24h || 0).toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Market Cap</span>
            <span className="font-mono font-medium">${(poolData?.marketCap || 0).toLocaleString()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

