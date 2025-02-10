'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { OrderBook } from '@/components/order-book'
import { MarketStats } from '@/components/market-stats'
import { TradingViewChart } from '@/components/trading-view-chart'
import { TokenTradingPanel } from '@/components/token-trading-panel'
import { Bot, Users, ArrowLeft, Loader2, ExternalLink, Info } from 'lucide-react'
import { MarketService, MarketData } from '@/lib/market'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/providers/auth-provider'
import { toast } from 'sonner'
import { Separator } from "@/components/ui/separator"

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
    } | null
    transactions: Array<{
      signature: string
      price: number
      size: number
      side: 'buy' | 'sell'
      timestamp: number
    }>
  } | null
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


// lib/geckoTerminal.ts

export interface TokenPriceData {
  data: Array<{
    id: string;
    type: string;
    attributes: {
      token_prices: Record<string, string>;
    };
  }>;
}

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
export async function getTokenPrices({
  network,
  addresses,
  includeMarketCap = false,
  include24hrVol = false,
}: GetTokenPricesParams): Promise<TokenPriceData> {
  // Validate addresses count
  if (addresses.length > 30) {
    throw new Error('Exceeded maximum number of addresses. Maximum allowed is 30.');
  }

  const baseUrl = 'https://api.geckoterminal.com/api/v2';
  // Create endpoint by joining token addresses with commas (after URL-encoding each address)
  const encodedAddresses = addresses.map((addr) => encodeURIComponent(addr)).join(',');
  const endpoint = `/simple/networks/${encodeURIComponent(network)}/token_price/${encodedAddresses}`;

  // Build query parameters for optional data
  const queryParams = new URLSearchParams();
  queryParams.append('include_market_cap', includeMarketCap.toString());
  queryParams.append('include_24hr_vol', include24hrVol.toString());

  const url = `${baseUrl}${endpoint}?${queryParams.toString()}`;

  // Fetch data from the API
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      // Set the Accept header with the specified API version.
      Accept: 'application/json;version=20230302',
    },
  });

  // Check for HTTP errors
  if (!response.ok) {
    // Attempt to parse the error response
    const errorResponse: APIErrorResponse = await response.json();
    const errorMessages = errorResponse.errors.map((err) => err.title).join(', ');
    throw new Error(`API Error: ${errorMessages}`);
  }

  // Parse and return the JSON data
  const data: TokenPriceData = await response.json();
  return data;
}

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
      price: tx.price * swarmsPrice // Convert SWARMS price to USD
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
          open: lastKnownPrice * swarmsPrice,
          high: lastKnownPrice * swarmsPrice,
          low: lastKnownPrice * swarmsPrice,
          close: lastKnownPrice * swarmsPrice,
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
  const last24hTx = sortedTx.map(tx => ({
    ...tx,
    price: tx.price * swarmsPrice // Convert SWARMS price to USD
  })).filter(tx => tx.timestamp > now - 24 * 3600000)
  const prices24h = last24hTx.map(tx => tx.price)
  const volume24h = last24hTx.reduce((sum, tx) => sum + (tx.price * tx.size), 0)

  return {
    price: (sortedTx[sortedTx.length - 1]?.price || 0) * swarmsPrice,
    volume24h,
    marketCap: 0, // We don't have this information
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

      const response = await fetch(`/api/agent/${params.walletaddress}`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      })
      
      if (!response.ok) {
        throw new Error('Failed to fetch token data')
      }

      const data = await response.json()
      
      if (!data) {
        toast.error('Token not found')
        router.push('/')
        return
      }

      const tokenDetails: TokenDetails = {
        mint_address: data.mint_address,
        token_symbol: data.token_symbol,
        name: data.name,
        description: data.description,
        price: data.market?.stats?.price || 0,
        priceChange24h: calculatePriceChange24h(data.market?.transactions || []),
        liquidityPool: data.market_cap || 0,
        poolAddress: data.pool_address,
        creator_wallet: data.creator?.wallet_address || '',
        metadata: data.metadata,
        is_swarm: data.is_swarm,
        bonding_curve_address: data.bonding_curve_address,
        market: data.market ? {
          stats: data.market.stats || null,
          transactions: data.market.transactions || []
        } : null
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
              } : prev.market
            })
          }
        }
        return tokenDetails
      })
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

    // Initial fetch
    fetchData(false)

    // Set up polling every 30 seconds for subtle updates
    const interval = setInterval(() => {
      // Only fetch if not trading to prevent UI interruptions
      if (!isTrading) {
        fetchData(true)
      }
    }, 30000)

    return () => {
      clearInterval(interval)
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
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

  const isCreator = user?.user_metadata?.wallet_address === token.creator_wallet
  const needsPool = !token.poolAddress && isCreator

  return (
    <div className="space-y-6 relative">
      {updating && !isTrading && (
        <div className="absolute top-2 right-2 flex items-center gap-2 text-xs text-gray-400">
          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-red-600"></div>
          Updating...
        </div>
      )}
      <Link 
        href="/" 
        className="inline-flex items-center text-gray-400 hover:text-red-500 transition-colors"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Market
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-[1fr,400px] gap-6">
        <div className="space-y-6">
          {/* Token Header Card */}
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
                <div className="text-2xl font-bold font-mono token-price transition-all duration-300">
                  ${token.price.toLocaleString(undefined, { minimumFractionDigits: 10, maximumFractionDigits: 10 })}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-gray-400 mb-4">{token.description}</p>
            </CardContent>
          </Card>

          {/* Chart */}
          <Card className="bg-black/50 border-red-600/20">
            <CardContent className="p-0">
              <TradingViewChart 
                data={token.market?.transactions ? transformTransactionsToOHLCV(
                  token.market.transactions,
                  token.market.stats?.price || 0
                ) : null} 
                symbol={token.token_symbol} 
              />
            </CardContent>
          </Card>

          {/* Market Stats and Order Book */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <MarketStats 
              mintAddress={token.mint_address} 
              symbol={token.token_symbol}
              poolData={token.market?.stats || null}
            />
            <OrderBook 
              mintAddress={token.mint_address} 
              symbol={token.token_symbol}
              transactions={token.market?.transactions || []}
            />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Token Information Card */}
          <Card className="bg-black/50 border-red-600/20">
            <CardHeader>
              <CardTitle>Token Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <TokenStat label="Symbol" value={token.token_symbol} />
              <TokenStat label="Price" value={`$${token.price.toLocaleString(undefined, { minimumFractionDigits: 10, maximumFractionDigits: 10 })}`} />
              <TokenStat label="24h Change" value={`${token.priceChange24h.toFixed(2)}%`} />
              <TokenStat label="Liquidity Pool" value={`$${token.liquidityPool.toLocaleString()}`} />
              
              <Separator className="my-4 bg-red-600/20" />
              
              <div className="space-y-2">
                <div className="text-sm font-medium mb-2">Contract Address</div>
                <div className="font-mono text-xs break-all bg-black/20 p-2 rounded">
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
    </div>
  )
}