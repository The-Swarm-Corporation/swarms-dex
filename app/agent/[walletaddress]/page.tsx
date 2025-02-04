'use client'

import { useEffect, useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { OrderBook } from '@/components/order-book'
import { MarketStats } from '@/components/market-stats'
import { TradingViewChart } from '@/components/trading-view-chart'
import { TokenTradingPanel } from '@/components/token-trading-panel'
import { Bot, Users, ArrowLeft } from 'lucide-react'
import { MarketService, MarketData } from '@/lib/market'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/providers/auth-provider'
import { toast } from 'sonner'
import { getTokenByMint } from '@/lib/api'
import type { Web3Agent } from '@/lib/supabase/types'

interface TokenDetails extends Web3Agent {
  price: number
  priceChange24h: number
  liquidityPool: number
  swaps_token_address?: string
}

export default function TokenPage({ params }: { params: { walletaddress: string } }) {
  const router = useRouter()
  const { user } = useAuth()
  const [token, setToken] = useState<TokenDetails | null>(null)
  const [marketData, setMarketData] = useState<MarketData | null>(null)
  const [loading, setLoading] = useState(true)
  const marketServiceRef = useRef<MarketService | null>(null)

  useEffect(() => {
    fetchData()
  }, [params.walletaddress])

  const fetchData = async () => {
    try {
      setLoading(true)
      const tokenData = await getTokenByMint(params.walletaddress)
      
      if (!tokenData) {
        toast.error('Token not found')
        router.push('/')
        return
      }

      // Transform token data to match our interface
      const tokenDetails: TokenDetails = {
        ...tokenData,
        price: tokenData.current_price || 0,
        priceChange24h: tokenData.price_change_24h || 0,
        liquidityPool: tokenData.market_cap || 0,
      }
      
      setToken(tokenDetails)

      const marketService = new MarketService(tokenData.mint_address)
      marketServiceRef.current = marketService
      
      const data = await marketService.getMarketData()
      setMarketData(data)

      // Set up interval for real-time updates
      const interval = setInterval(async () => {
        const updatedData = await marketService.getMarketData()
        setMarketData(updatedData)
      }, 15000) // Update every 15 seconds

      return () => {
        clearInterval(interval)
        if (marketServiceRef.current) {
          marketServiceRef.current.disconnect()
          marketServiceRef.current = null
        }
      }
    } catch (error) {
      console.error('Failed to fetch token data:', error)
      toast.error('Failed to load token data')
    } finally {
      setLoading(false)
    }
  }

  // Handler for protected actions
  const handleProtectedAction = async (action: () => Promise<void>) => {
    if (!user) {
      toast.error('Please connect your wallet to perform this action')
      return
    }

    try {
      await action()
    } catch (error) {
      console.error('Action failed:', error)
      toast.error('Failed to perform action')
    }
  }

  if (loading || !token || !marketData) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-red-600">Loading...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link 
        href="/" 
        className="inline-flex items-center text-gray-400 hover:text-red-500 transition-colors"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Market
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-[1fr,400px] gap-6">
        <Card className="bg-black/50 border-red-600/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="text-2xl font-bold text-red-600 flex items-center gap-2">
                  {token.name}
                  {token.is_swarm ? (
                    <Users className="h-5 w-5" />
                  ) : (
                    <Bot className="h-5 w-5" />
                  )}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{token.token_symbol}</Badge>
                  <Badge 
                    variant={token.priceChange24h >= 0 ? "default" : "destructive"}
                    className={`${token.priceChange24h >= 0 ? 'bg-green-500/20 text-green-500 hover:bg-green-500/30' : ''}`}
                  >
                    {token.priceChange24h >= 0 ? '+' : ''}{token.priceChange24h.toFixed(2)}%
                  </Badge>
                </div>
              </div>
              <div className="text-2xl font-bold font-mono">
                ${token.price.toFixed(4)}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-gray-400 mb-4">{token.description}</p>
            <div className="text-sm">
              <span className="text-gray-400">Mint Address: </span>
              <span className="font-mono">{token.mint_address}</span>
            </div>
          </CardContent>
        </Card>

        <TokenTradingPanel 
          mintAddress={token.mint_address}
          symbol={token.token_symbol}
          currentPrice={token.price}
          swapsTokenAddress={token.swaps_token_address}
        />
      </div>

      <div className="space-y-6">
        <TradingViewChart data={marketData} symbol={token.token_symbol} />
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <MarketStats 
            mintAddress={token.mint_address} 
            symbol={token.token_symbol} 
          />
          <OrderBook 
            mintAddress={token.mint_address} 
            symbol={token.token_symbol} 
          />
        </div>
      </div>
    </div>
  )
}