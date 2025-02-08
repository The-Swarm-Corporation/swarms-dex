'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface MarketStatsProps {
  mintAddress: string
  symbol: string
  poolData: {
    price: number
    volume24h: number
    tvl: number
    apy: number
  } | null
}

export function MarketStats({ mintAddress, symbol, poolData }: MarketStatsProps) {
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
            <span className="font-mono font-medium">${(poolData?.price || 0).toFixed(4)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">24h Volume</span>
            <span className="font-mono font-medium">${(poolData?.volume24h || 0).toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">TVL</span>
            <span className="font-mono font-medium">${(poolData?.tvl || 0).toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">APY</span>
            <span className="font-mono font-medium">{(poolData?.apy || 0).toFixed(2)}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

