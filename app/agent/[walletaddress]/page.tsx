'use client'

import { useEffect, useState, useRef } from 'react'
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
import { getTokenByMint } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PublicKey, Transaction, Connection } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
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

      const tokenDetails: TokenDetails = {
        mint_address: tokenData.mint_address,
        token_symbol: tokenData.token_symbol,
        name: tokenData.name,
        description: tokenData.description,
        price: tokenData.current_price || 0,
        priceChange24h: tokenData.price_change_24h || 0,
        liquidityPool: tokenData.market_cap || 0,
        poolAddress: tokenData.pool_address,
        creator_wallet: tokenData.creator_wallet || '',
        metadata: tokenData.metadata,
        is_swarm: tokenData.is_swarm,
        bonding_curve_address: tokenData.bonding_curve_address
      }
      
      setToken(tokenDetails)

      const marketService = new MarketService(tokenData.mint_address)
      marketServiceRef.current = marketService
      
      const data = await marketService.getMarketData()
      setMarketData(data)

      const interval = setInterval(async () => {
        const updatedData = await marketService.getMarketData()
        setMarketData(updatedData)
      }, 15000)

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

  if (loading || !token || !marketData) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-red-600">Loading...</div>
      </div>
    )
  }

  const isCreator = user?.user_metadata?.wallet_address === token.creator_wallet;
  const needsPool = !token.poolAddress && isCreator;

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
        {/* Main Content */}
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
                <div className="text-2xl font-bold font-mono">
                  ${token.price.toFixed(4)}
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
              <TradingViewChart data={marketData} symbol={token.token_symbol} />
            </CardContent>
          </Card>

          {/* Market Stats and Order Book */}
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

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Token Information Card */}
          <Card className="bg-black/50 border-red-600/20">
            <CardHeader>
              <CardTitle>Token Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <TokenStat label="Symbol" value={token.token_symbol} />
              <TokenStat label="Price" value={`$${token.price.toFixed(4)}`} />
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
          />
        </div>
      </div>
    </div>
  )
}