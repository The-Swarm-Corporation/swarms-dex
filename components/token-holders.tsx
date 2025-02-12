'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Users, ExternalLink } from 'lucide-react'

interface TokenHolder {
  wallet_address: string
  balance: number
  percentage: number
  last_updated: string
}

interface TokenHoldersProps {
  mintAddress: string
  symbol: string
  totalSupply: number
}

export function TokenHolders({ mintAddress, symbol, totalSupply }: TokenHoldersProps) {
  const [holders, setHolders] = useState<TokenHolder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchHolders = async () => {
      try {
        setLoading(true)
        const response = await fetch(`/api/tokens/${mintAddress}/holders`)
        if (!response.ok) {
          throw new Error('Failed to fetch token holders')
        }
        const data = await response.json()
        setHolders(data)
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to fetch holders')
      } finally {
        setLoading(false)
      }
    }

    fetchHolders()
  }, [mintAddress])

  if (error) {
    return (
      <Card className="bg-black/50 border-red-600/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Top Holders
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-red-500">{error}</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-black/50 border-red-600/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Top Holders
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {loading ? (
            // Loading skeletons
            Array(5).fill(0).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <Skeleton className="h-4 w-[200px]" />
                <Skeleton className="h-4 w-[100px]" />
              </div>
            ))
          ) : holders.length === 0 ? (
            <div className="text-sm text-gray-500">No holders found</div>
          ) : (
            holders.map((holder, index) => (
              <div key={holder.wallet_address} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">#{index + 1}</span>
                  <a
                    href={`https://solscan.io/account/${holder.wallet_address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm text-red-500 hover:text-red-400 flex items-center gap-1"
                  >
                    {holder.wallet_address.slice(0, 4)}...{holder.wallet_address.slice(-4)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono text-sm">
                    {holder.balance.toLocaleString()} {symbol}
                  </span>
                  <span className="text-gray-500 text-sm">
                    {holder.percentage.toFixed(2)}%
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
} 