'use client'

import { useEffect, useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { OrderBook } from '@/components/order-book'
import { MarketStats } from '@/components/market-stats'
import { TradingViewChart } from '@/components/trading-view-chart'
import { TokenTradingPanel } from '@/components/token-trading-panel'
import { Bot, Users, ArrowLeft, Loader2 } from 'lucide-react'
import { MarketService, MarketData } from '@/lib/market'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/providers/auth-provider'
import { toast } from 'sonner'
import { getTokenByMint } from '@/lib/api'
import type { Web3Agent } from '@/lib/supabase/types'
import { Button } from '@/components/ui/button'

// Extend TokenDetails from Web3Agent
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

export default function TokenPage({ params }: { params: { walletaddress: string } }) {
  const router = useRouter()
  const { user } = useAuth()
  const [token, setToken] = useState<TokenDetails | null>(null)
  const [marketData, setMarketData] = useState<MarketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [creatingPool, setCreatingPool] = useState(false)
  const marketServiceRef = useRef<MarketService | null>(null)

  // Function to handle pool creation
  const handleCreatePool = async () => {
    if (!token || !user) return;

    setCreatingPool(true);
    const toastId = toast.loading("Checking pool requirements...");

    try {
      // First simulate pool creation to check SOL requirements
      const poolSimResponse = await fetch('/api/solana/create-pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenMint: token.mint_address,
          userPublicKey: user.user_metadata.wallet_address,
          createPool: false
        })
      });

      if (!poolSimResponse.ok) {
        const error = await poolSimResponse.json();
        throw new Error(error.error || 'Failed to simulate pool creation');
      }

      const simResult = await poolSimResponse.json();

      // If we need more SOL, show the transfer UI
      if (!simResult.readyToProceed) {
        toast.error(
          `Pool creation needs ${simResult.recommendedSol.toFixed(4)} SOL. Please send SOL to your bonding curve account.`, 
          { id: toastId, duration: 8000 }
        );
        // Show bonding curve address for easy copy
        toast.info(
          <div className="mt-2 text-xs font-mono break-all">
            <div>Bonding Curve Address:</div>
            <div>{token.bonding_curve_address}</div>
          </div>,
          { duration: 15000 }
        );
        return;
      }

      // If we have enough SOL, proceed with pool creation
      toast.loading("Creating liquidity pool...", { id: toastId });

      const poolResponse = await fetch('/api/solana/create-pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenMint: token.mint_address,
          userPublicKey: user.user_metadata.wallet_address,
          createPool: true
        })
      });

      if (!poolResponse.ok) {
        const error = await poolResponse.json();
        throw new Error(error.error || 'Failed to create pool');
      }

      const { signature: poolSignature, poolAddress } = await poolResponse.json();

      toast.success("Pool created successfully!", { 
        id: toastId,
        duration: 5000,
        description: (
          <div className="mt-2 text-xs font-mono break-all">
            <div>Pool: {poolAddress}</div>
            <div>
              <a
                href={`https://explorer.solana.com/tx/${poolSignature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-600"
              >
                View Transaction
              </a>
            </div>
          </div>
        ),
      });

      // Refresh the page to show the new pool
      router.refresh();
      
    } catch (error) {
      console.error('Failed to create pool:', error);
      toast.error(
        error instanceof Error ? error.message : "Failed to create pool", 
        { id: toastId }
      );
    } finally {
      setCreatingPool(false);
    }
  };

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
      
      if (!tokenDetails.poolAddress) {
        console.warn('No pool address found for token:', tokenData.mint_address);
      } else {
        console.log('Found pool address:', tokenDetails.poolAddress);
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
            {needsPool && (
              <div className="mt-4 p-4 bg-red-600/10 rounded-lg border border-red-600/20">
                <h3 className="text-sm font-semibold text-red-500">Pool Creation Required</h3>
                <p className="mt-2 text-sm text-gray-200">
                  Your token needs a liquidity pool to enable trading. Create one now:
                </p>
                <Button
                  onClick={handleCreatePool}
                  disabled={creatingPool}
                  className="mt-3 bg-red-600 hover:bg-red-700 text-white"
                >
                  {creatingPool ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating Pool...
                    </>
                  ) : (
                    "Create Pool"
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <TokenTradingPanel 
          mintAddress={token.mint_address}
          symbol={token.token_symbol}
          currentPrice={token.price}
          poolAddress={token.poolAddress}
          showCreatePool={needsPool}
          swapsTokenAddress={process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS}
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