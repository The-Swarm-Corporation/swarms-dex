'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { OrderBook } from '@/components/order-book'
import { MarketStats } from '@/components/market-stats'
import { GeckoTerminalChart } from '@/components/gecko-terminal-chart'
import { TokenTradingPanel } from '@/components/token-trading-panel'
import { Bot, Users, ArrowLeft, ExternalLink, Share2 } from 'lucide-react'
import { MarketData } from '@/lib/market'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/providers/auth-provider'
import { toast } from 'sonner'
import { Separator } from "@/components/ui/separator"
import { TokenHolders } from '@/components/token-holders'
import { ShareModal } from '@/components/share-modal'
import { Button } from '@/components/ui/button'
import type { Web3Agent } from "@/lib/supabase/types"
import { Comments } from '@/components/comments'
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

interface TokenDetails {
  mint_address: string
  token_symbol: string
  name: string
  description: string
  price: number
  priceChange24h: number
  liquidityPool: number
  poolAddress?: string
  creator_wallet?: string
  metadata?: any
  is_swarm?: boolean
  bonding_curve_address?: string
  market: {
    stats: {
      price: number
      volume24h: number
      tvl: number
      apy: number
      marketCap?: number
    } | null
    transactions: Array<{
      signature: string
      price: number
      size: number
      side: 'buy' | 'sell'
      timestamp: number
    }>
  } | null
  twitter_handle?: string
  telegram_group?: string
  discord_server?: string
  current_supply?: number
  image_url?: string
  created_at?: string
  // Required Web3Agent properties
  id: string
  creator_id: string
  volume24h: number
  volume_24h: number
  pool_address: string | null
  is_verified: boolean
  market_cap: number
  current_price: number
  updated_at: string
  initial_supply: number
  liquidity_pool_size: number
  comments?: Array<{
    id: string
    content: string
    created_at: string
    updated_at: string
    is_edited: boolean
    user: {
      id: string
      username: string | null
      wallet_address: string
      avatar_url: string | null
    }
    parent_id: string | null
  }>
}

interface TokenStatProps {
  label: string
  value: string | number
  className?: string
}

const TokenStat = ({ label, value, className }: TokenStatProps) => (
  <div className={`flex justify-between items-center py-3 ${className}`}>
    <span className="text-gray-400">{label}</span>
    <span className="font-mono font-medium">{value}</span>
  </div>
)


export interface APIErrorResponse {
  errors: Array<{
    status: string;
    title: string;
  }>;
}

interface GetTokenPricesParams {
  network: string;
  addresses: string[];
  includeMarketCap?: boolean;
  include24hrVol?: boolean;
}

/**
 * Retrieves current USD token prices from the GeckoTerminal API.
 *
 * @param params - Parameters for the API request.
 * @returns A promise that resolves with the token price data.
 * @throws An error if the request fails or if more than 30 addresses are provided.
 */
function transformTransactionsToOHLCV(transactions: Array<{
  signature: string
  price: number // This is price in SWARMS
  size: number
  side: 'buy' | 'sell'
  timestamp: number
}>, swarmsPrice: number = 0): MarketData {
  if (!transactions || transactions.length === 0) {
    return {
      price: 0,
      volume24h: 0,
      marketCap: 0,
      highPrice24h: 0,
      lowPrice24h: 0,
      priceHistory: []
    }
  }

  // Sort transactions by timestamp
  const sortedTx = [...transactions].sort((a, b) => a.timestamp - b.timestamp)
  const firstTime = sortedTx[0].timestamp
  const lastTime = sortedTx[sortedTx.length - 1].timestamp
  const timeframe = 3600000 // 1 hour in milliseconds

  // Create time buckets for each hour
  const buckets: { [key: number]: typeof sortedTx } = {}
  for (let time = firstTime; time <= lastTime; time += timeframe) {
    buckets[time] = []
  }

  // Group transactions into hourly buckets
  sortedTx.forEach(tx => {
    const bucketTime = Math.floor(tx.timestamp / timeframe) * timeframe
    if (!buckets[bucketTime]) {
      buckets[bucketTime] = []
    }
    buckets[bucketTime].push({
      ...tx,
      price: tx.price // Keep price in SWARMS, don't multiply by swarmsPrice
    })
  })

  // Calculate OHLCV for each bucket and ensure ascending order
  const priceHistory = Object.entries(buckets)
    .sort(([timeA], [timeB]) => parseInt(timeA) - parseInt(timeB))
    .map(([time, txs]) => {
      if (txs.length === 0) {
        // Use the last known price for empty buckets
        const lastKnownPrice = sortedTx.find(tx => tx.timestamp < parseInt(time))?.price || 0
        return {
          time: new Date(parseInt(time)),
          open: lastKnownPrice,
          high: lastKnownPrice,
          low: lastKnownPrice,
          close: lastKnownPrice,
          volume: 0
        }
      }

      const prices = txs.map(tx => tx.price)
      const volume = txs.reduce((sum, tx) => sum + (tx.price * tx.size), 0)

      return {
        time: new Date(parseInt(time)),
        open: txs[0].price,
        high: Math.max(...prices),
        low: Math.min(...prices),
        close: txs[txs.length - 1].price,
        volume
      }
    })

  // Calculate 24h stats
  const now = Date.now()
  const last24hTx = sortedTx.filter(tx => tx.timestamp > now - 24 * 3600000)
  const prices24h = last24hTx.map(tx => tx.price)
  const volume24h = last24hTx.reduce((sum, tx) => sum + (tx.price * tx.size), 0)

  return {
    price: sortedTx[sortedTx.length - 1]?.price || 0,
    volume24h,
    marketCap: 0,
    highPrice24h: prices24h.length > 0 ? Math.max(...prices24h) : 0,
    lowPrice24h: prices24h.length > 0 ? Math.min(...prices24h) : 0,
    priceHistory
  }
}

function calculatePriceChange24h(transactions: Array<{
  price: number
  timestamp: number
}>): number {
  if (!transactions || transactions.length === 0) return 0

  const now = Date.now()
  const oneDayAgo = now - 24 * 60 * 60 * 1000
  const last24hTx = transactions
    .filter(tx => tx.timestamp > oneDayAgo)
    .sort((a, b) => b.timestamp - a.timestamp)

  if (last24hTx.length < 2) return 0

  const currentPrice = last24hTx[0].price
  const oldestPrice = last24hTx[last24hTx.length - 1].price

  if (oldestPrice === 0) return 0
  return ((currentPrice - oldestPrice) / oldestPrice) * 100
}

export default function TokenPage({ params }: { params: { walletaddress: string } }) {
  const router = useRouter()
  const { user } = useAuth()
  const [token, setToken] = useState<TokenDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [holdersCount, setHoldersCount] = useState<number>(0)
  const fetchTimeoutRef = useRef<NodeJS.Timeout>()
  const lastFetchRef = useRef<number>(0)
  const [isTrading, setIsTrading] = useState(false)

  // Prevent default form submission for the entire page
  useEffect(() => {
    const handleSubmit = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isTrading) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    document.addEventListener('submit', handleSubmit, true);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('submit', handleSubmit, true);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isTrading]);

  const fetchData = useCallback(async (isUpdate = false) => {
    try {
      // Don't update market data while user is trading
      if (isTrading && isUpdate) {
        return
      }

      // Debounce requests to prevent multiple calls
      const now = Date.now()
      if (now - lastFetchRef.current < 1000) { // 1 second debounce
        return
      }
      lastFetchRef.current = now

      // Only show loading on initial load, not during updates or trading
      if (!isUpdate && !isTrading) {
        setLoading(true)
      } else if (!isTrading) {
        setUpdating(true)
      }

      // First get the agent data
      const agentResponse = await fetch(`/api/agent/${params.walletaddress}`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      })
      
      if (!agentResponse.ok) {
        throw new Error('Failed to fetch token data')
      }

      const data = await agentResponse.json()
      
      if (!data) {
        toast.error('Token not found')
        router.push('/')
        return
      }

      // Then fetch comments using the agent's ID
      const commentsResponse = await fetch(`/api/comments?agent_id=${data.id}`)
      const comments = commentsResponse.ok ? await commentsResponse.json() : []
      
      const tokenDetails: TokenDetails = {
        mint_address: data.mint_address,
        token_symbol: data.token_symbol,
        name: data.name,
        description: data.description,
        price: data.market?.stats?.price,
        priceChange24h: calculatePriceChange24h(data.market?.transactions || []),
        liquidityPool: data.market_cap,
        poolAddress: data.pool_address,
        creator_wallet: data.creator?.wallet_address || '',
        metadata: data.metadata,
        is_swarm: data.is_swarm,
        bonding_curve_address: data.bonding_curve_address,
        market: data.market ? {
          stats: {
            ...(data.market.stats || {}),
            marketCap: data.market_cap
          },
          transactions: data.market.transactions || []
        } : null,
        twitter_handle: data.twitter_handle,
        telegram_group: data.telegram_group,
        discord_server: data.discord_server,
        current_supply: data.current_supply,
        image_url: data.image_url,
        created_at: data.created_at,
        id: data.id,
        creator_id: data.creator_id,
        volume24h: data.volume_24h,
        volume_24h: data.volume_24h,
        pool_address: data.pool_address,
        is_verified: data.is_verified,
        market_cap: data.market_cap,
        current_price: data.current_price,
        updated_at: data.updated_at,
        initial_supply: data.initial_supply,
        liquidity_pool_size: data.liquidity_pool_size,
        comments: comments
      }
      
      setToken(prev => {
        if (!prev) return tokenDetails
        // If this is an update and we have previous data, smoothly transition
        if (isUpdate) {
          return {
            ...prev,
            // Only update non-critical fields during trading
            ...(isTrading ? {} : {
              price: tokenDetails.price,
              priceChange24h: tokenDetails.priceChange24h,
              liquidityPool: tokenDetails.liquidityPool,
              market: tokenDetails.market ? {
                stats: tokenDetails.market.stats,
                transactions: [
                  ...(prev.market?.transactions || []),
                  ...(tokenDetails.market.transactions || [])
                    .filter(tx => 
                      !(prev.market?.transactions || [])
                        .some(prevTx => prevTx.signature === tx.signature)
                    )
                ]
              } : prev.market,
              comments: comments
            })
          }
        }
        return tokenDetails
      })

      // Fetch holders count
      const holdersResponse = await fetch(`/api/tokens/${params.walletaddress}/holders`)
      if (holdersResponse.ok) {
        const holders = await holdersResponse.json()
        setHoldersCount(holders.length)
      }
    } catch (error) {
      console.error('Failed to fetch token data:', error)
      if (!isUpdate) {
        setError('Failed to load token data')
        toast.error('Failed to load token data')
      }
    } finally {
      if (!isUpdate) {
        setLoading(false)
      } else {
        setUpdating(false)
      }
    }
  }, [params.walletaddress, router, isTrading])

  useEffect(() => {
    // Clear any existing timeout
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current)
    }

    // Initial fetch only on mount
    if (!isTrading && !lastFetchRef.current) {
      fetchData(false)
    }

    // Set up polling every 30 seconds for subtle updates
    const interval = setInterval(() => {
      // Only fetch if not trading to prevent UI interruptions
      if (!isTrading) {
        fetchData(true)
      }
    }, 30000)

    // When trading state changes from true to false, delay the fetch
    let delayedFetch: NodeJS.Timeout
    if (!isTrading && lastFetchRef.current) {
      delayedFetch = setTimeout(() => {
        fetchData(true)
      }, 6000) // Wait 6 seconds after trading completes (after confetti)
    }

    return () => {
      clearInterval(interval)
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
      }
      if (delayedFetch) {
        clearTimeout(delayedFetch)
      }
    }
  }, [fetchData, isTrading])

  // Add a useEffect to handle smooth price updates
  useEffect(() => {
    if (token?.price && !isTrading) {
      const element = document.querySelector('.token-price')
      if (element) {
        element.classList.add('price-update')
        setTimeout(() => {
          element.classList.remove('price-update')
        }, 1000)
      }
    }
  }, [token?.price, isTrading])

  if (loading || !token) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-red-600">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-red-600">{error}</div>
      </div>
    )
  }

  // Remove creator check, only check if pool exists
  const needsPool = !token.poolAddress

  return (
    <div className="space-y-4 sm:space-y-6 relative w-full max-w-[100vw] px-2 sm:px-4">
      {updating && !isTrading && (
        <div className="absolute top-2 right-2 flex items-center gap-2 text-xs text-gray-400">
          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-red-600"></div>
          Updating...
        </div>
      )}
      <div className="flex items-center justify-between">
        <Link 
          href="/" 
          className="inline-flex items-center text-gray-400 hover:text-red-500 transition-colors text-sm sm:text-base"
        >
          <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
          Back to Market
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,400px] gap-4 sm:gap-6">
        <div className="space-y-4 sm:space-y-6">
          {/* Token Header Card */}
          <Card className="bg-black/50 border-red-600/20 overflow-hidden">
            <CardHeader className="p-3 sm:p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
                <div className="space-y-1 w-full sm:w-auto">
                  <CardTitle className="text-xl sm:text-2xl font-bold text-red-600 flex items-center gap-2 flex-wrap">
                    {token.image_url && (
                      <img 
                        src={token.image_url} 
                        alt={`${token.name} logo`}
                        className="w-6 h-6 sm:w-8 sm:h-8 rounded-lg bg-black/20"
                      />
                    )}
                    <span className="break-all">{token.name}</span>
                    {token.is_swarm ? (
                      <Users className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
                    ) : (
                      <Bot className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs">{token.token_symbol}</Badge>
                    <Badge 
                      variant={token.priceChange24h >= 0 ? "default" : "destructive"}
                      className={`text-xs ${token.priceChange24h >= 0 ? 'bg-green-500/20 text-green-500 hover:bg-green-500/30' : ''}`}
                    >
                      {token.priceChange24h >= 0 ? '+' : ''}{token.priceChange24h.toFixed(2)}%
                    </Badge>
                  </div>
                </div>
                <div className="text-lg sm:text-2xl font-bold font-mono token-price transition-all duration-300 w-full sm:w-auto text-right">
                  ${(token.price ?? 0).toLocaleString(undefined, { minimumFractionDigits: 10, maximumFractionDigits: 10 })}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-3 sm:p-6">
              <p className="text-gray-400 text-sm sm:text-base">{token.description}</p>
            </CardContent>
          </Card>

          {/* Chart */}
          <Card className="bg-black/50 border-red-600/20 overflow-hidden">
            <CardContent className="p-0">
              <GeckoTerminalChart 
                poolAddress={token.poolAddress || ''} 
              />
            </CardContent>
          </Card>

          {/* Market Stats and Trading Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <MarketStats 
              mintAddress={token.mint_address} 
              symbol={token.token_symbol}
              poolData={token.market?.stats || null}
              priceChange24h={token.priceChange24h}
            />
            <Card className="bg-black/50 border-red-600/20">
              <Tabs defaultValue="trades" className="w-full">
                <CardHeader className="p-3 sm:p-6 pb-0 sm:pb-0">
                  <div className="flex items-center justify-between">
                    <TabsList className="bg-black/50">
                      <TabsTrigger value="trades" className="data-[state=active]:bg-red-600">Recent Trades</TabsTrigger>
                      <TabsTrigger value="holders" className="data-[state=active]:bg-red-600">Top Holders</TabsTrigger>
                    </TabsList>
                  </div>
                </CardHeader>
                <CardContent className="p-3 sm:p-6">
                  <TabsContent value="trades" className="mt-0">
                    <OrderBook 
                      mintAddress={token.mint_address} 
                      symbol={token.token_symbol}
                      transactions={token.market?.transactions || []}
                    />
                  </TabsContent>
                  <TabsContent value="holders" className="mt-0">
                    <TokenHolders
                      mintAddress={token.mint_address}
                      symbol={token.token_symbol}
                      totalSupply={token.current_supply || 0}
                    />
                  </TabsContent>
                </CardContent>
              </Tabs>
            </Card>
          </div>

          {/* Comments Section */}
          <Comments 
            agentId={token.id}
            comments={token.comments || []}
            onCommentAdded={() => fetchData(true)}
            onCommentUpdated={() => fetchData(true)}
            onCommentDeleted={() => fetchData(true)}
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-4 sm:space-y-6">
          {/* Token Information Card */}
          <Card className="bg-black/50 border-red-600/20">
            <CardHeader className="p-3 sm:p-6">
              <CardTitle className="text-lg sm:text-xl">Token Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-3 sm:p-6">
              <TokenStat label="Symbol" value={token.token_symbol} />
              <TokenStat label="Holders" value={holdersCount.toLocaleString()} />
              {token.created_at && (
                <TokenStat 
                  label="Created" 
                  value={new Date(token.created_at).toLocaleDateString(undefined, { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })} 
                />
              )}
              
              <Separator className="my-4 bg-red-600/20" />
              
              <div className="space-y-2">
                <div className="text-sm font-medium mb-2">Contract Address</div>
                <div className="font-mono text-[10px] sm:text-xs break-all bg-black/20 p-2 rounded">
                  {token.mint_address}
                </div>
                <a
                  href={`https://solscan.io/address/${token.mint_address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-red-500 hover:text-red-400 inline-flex items-center gap-1"
                >
                  View on Explorer
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              {/* Social Links */}
              {(token.twitter_handle || token.telegram_group || token.discord_server) && (
                <>
                  <Separator className="my-4 bg-red-600/20" />
                  <div className="space-y-3">
                    <div className="text-sm font-medium">Social Links</div>
                    {token.twitter_handle && (
                      <a
                        href={`https://x.com/${token.twitter_handle.replace('@', '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs sm:text-sm text-red-500 hover:text-red-400 flex items-center gap-2"
                      >
                        <svg className="h-3 w-3 sm:h-4 sm:w-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                        </svg>
                        {token.twitter_handle}
                      </a>
                    )}
                    {token.telegram_group && (
                      <a
                        href={`https://t.me/${token.telegram_group.replace('@', '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs sm:text-sm text-red-500 hover:text-red-400 flex items-center gap-2"
                      >
                        <svg className="h-3 w-3 sm:h-4 sm:w-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
                        </svg>
                        {token.telegram_group}
                      </a>
                    )}
                    {token.discord_server && (
                      <a
                        href={token.discord_server?.includes('discord') ? `https://${token.discord_server}` : `https://discord.com/invite/${token.discord_server}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs sm:text-sm text-red-500 hover:text-red-400 flex items-center gap-2"
                      >
                        <svg className="h-3 w-3 sm:h-4 sm:w-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
                        </svg>
                        Discord
                      </a>
                    )}
                  </div>
                </>
              )}

              {/* Share Button */}
              <Separator className="my-4 bg-red-600/20" />
              <Button
                variant="outline"
                size="lg"
                onClick={() => setShareModalOpen(true)}
                className="w-full text-gray-400 hover:text-red-500 hover:bg-red-500/10 border-red-600/20"
              >
                <Share2 className="h-4 w-4 mr-2" />
                Share {token.name}
              </Button>
            </CardContent>
          </Card>

          {/* Trading Panel */}
          <TokenTradingPanel 
            mintAddress={token.mint_address}
            symbol={token.token_symbol}
            currentPrice={token.price}
            poolAddress={token.poolAddress}
            showCreatePool={needsPool}
            swapsTokenAddress={process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS}
            bondingCurveAddress={token.bonding_curve_address}
            initialSwarmsAmount={token.metadata?.initial_swarms_amount || "0"}
            onTradingStateChange={setIsTrading}
            onPoolCreated={(poolAddress) => {
              setToken(prev => {
                if (!prev) return null;
                return {
                  ...prev,
                  poolAddress
                };
              });
              // Trigger a data refresh
              fetchData(true);
            }}
          />
        </div>
      </div>

      {token && (
        <ShareModal 
          isOpen={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          token={{
            id: token.id,
            creator_id: token.creator_id,
            mint_address: token.mint_address,
            name: token.name,
            description: token.description,
            token_symbol: token.token_symbol,
            image_url: token.image_url,
            volume24h: token.volume24h,
            volume_24h: token.volume_24h,
            pool_address: token.pool_address,
            is_verified: token.is_verified,
            is_swarm: token.is_swarm || false,
            market_cap: token.market_cap,
            current_price: token.current_price,
            updated_at: token.updated_at,
            initial_supply: token.initial_supply,
            liquidity_pool_size: token.liquidity_pool_size,
            twitter_handle: token.twitter_handle,
            telegram_group: token.telegram_group,
            discord_server: token.discord_server,
            current_supply: token.current_supply,
            created_at: token.created_at
          } as Web3Agent}
        />
      )}
    </div>
  )
}