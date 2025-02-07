'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from 'lucide-react'

interface MarketStatsProps {
  mintAddress: string
  symbol: string
}

interface PoolStats {
  volume24h: number
  tvl: number
  apy: number
}

interface PoolResponse {
  pool: {
    address: string
    tokenAMint: string
    tokenBMint: string
    tokenABalance: string
    tokenBBalance: string
    fees: {
      tradeFee: number
      ownerTradeFee: number
      ownerWithdrawFee: number
    }
  }
  stats: PoolStats
  price: number
}

export function MarketStats({ mintAddress, symbol }: MarketStatsProps) {
  const [poolData, setPoolData] = useState<PoolResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        // Use the same endpoint as OrderBook
        const response = await fetch(`/api/solana/meteora/market?mintAddress=${mintAddress}`)
        
        if (!response.ok) {
          throw new Error('Failed to fetch market data')
        }

        const data = await response.json()
        setPoolData(data.pool)
      } catch (error) {
        setError('Failed to fetch pool stats')
        console.error('Failed to fetch pool stats:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()

    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000)
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
        {loading ? (
          <div className="text-center text-gray-400">Loading stats...</div>
        ) : poolData ? (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Price</span>
              <span className="font-mono font-medium">${(poolData?.price || 0).toFixed(4)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">24h Volume</span>
              <span className="font-mono font-medium">${(poolData?.stats?.volume24h || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">TVL</span>
              <span className="font-mono font-medium">${(poolData?.stats?.tvl || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">APY</span>
              <span className="font-mono font-medium">{(poolData?.stats?.apy || 0).toFixed(2)}%</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Pool Fees</span>
              <span className="font-mono font-medium">{((poolData?.pool?.fees?.tradeFee || 0) / 1000).toFixed(2)}%</span>
            </div>
          </div>
        ) : (
          <div className="text-center text-gray-400">No pool data available</div>
        )}
      </CardContent>
    </Card>
  )
}

