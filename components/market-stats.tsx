'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MarketService, MarketData } from '@/lib/market'
import { Loader2 } from 'lucide-react'

interface MarketStatsProps {
  mintAddress: string
  symbol: string
}

export function MarketStats({ mintAddress, symbol }: MarketStatsProps) {
  const [marketData, setMarketData] = useState<MarketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const marketService = new MarketService(mintAddress)
        const data = await marketService.getMarketData()
        setMarketData(data)
      } catch (error) {
        setError('Failed to load market data')
        console.error(error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 30000) // Update every 30 seconds

    return () => clearInterval(interval)
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
          Market Stats
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {marketData ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-gray-400">Price</div>
              <div className="text-xl font-bold">${marketData.price.toFixed(4)}</div>
            </div>
            <div>
              <div className="text-sm text-gray-400">24h Volume</div>
              <div className="text-xl font-bold">
                ${marketData.volume24h.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400">Market Cap</div>
              <div className="text-xl font-bold">
                ${marketData.marketCap.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400">24h Range</div>
              <div className="text-sm">
                <span className="text-gray-400">L: </span>
                <span className="font-mono">${marketData.lowPrice24h.toFixed(4)}</span>
                <span className="text-gray-400 mx-1">H: </span>
                <span className="font-mono">${marketData.highPrice24h.toFixed(4)}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-[104px] flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-red-600" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

