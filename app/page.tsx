"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Bot, Users, ExternalLink, Search, Star, Flame, Loader2 } from "lucide-react"
import Link from "next/link"
import { listTokens, getTrendingTokens } from "@/lib/api"
import type { Web3Agent } from "@/lib/supabase/types"
import { logger } from "@/lib/logger"
import { useDebounce } from "@/hooks/use-debounce"
import { SearchBar } from "@/components/search-bar"

function TokenCard({ token }: { token: Web3Agent & { 
  price_change_24h?: number
  market?: {
    stats?: {
      price: number
      volume24h: number
      apy: number
    }
  }
} }) {
  const priceChangeColor = token.price_change_24h
    ? token.price_change_24h > 0
      ? "text-green-500"
      : "text-red-500"
    : "text-gray-400"

  // Format price with proper decimals
  const formatPrice = (price: number | null | undefined) => {
    if (!price) return "0.0000"
    return price.toLocaleString(undefined, {
      minimumFractionDigits: 13,
      maximumFractionDigits: 13
    })
  }

  // Format volume and market cap with comma separators
  const formatValue = (value: number | null | undefined) => {
    if (!value) return "0"
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }

  return (
    <Card className="group bg-black/50 border border-red-500/20 hover:border-red-500/40 transition-all hover:scale-[1.02] hover:shadow-lg hover:shadow-red-500/10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-xl font-bold group-hover:text-red-500 transition-colors">
              {token.name}
              {token.is_verified && (
                <Badge variant="secondary" className="ml-2">
                  Verified
                </Badge>
              )}
            </h2>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="w-fit">
                {token.token_symbol}
              </Badge>
              {token.price_change_24h !== undefined && (
                <Badge
                  variant={token.price_change_24h >= 0 ? "default" : "destructive"}
                  className={`${token.price_change_24h >= 0 ? "bg-green-500/20 text-green-500 hover:bg-green-500/30" : ""}`}
                >
                  {token.price_change_24h >= 0 ? "+" : ""}
                  {token.price_change_24h.toFixed(2)}%
                </Badge>
              )}
            </div>
          </div>
          {token.is_swarm ? (
            <Users className="h-6 w-6 text-red-500 group-hover:scale-110 transition-transform" />
          ) : (
            <Bot className="h-6 w-6 text-red-500 group-hover:scale-110 transition-transform" />
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-gray-400 mb-4 line-clamp-2">{token.description}</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="text-sm text-gray-400">Price</div>
            <div className="font-mono text-lg">${formatPrice(token.market?.stats?.price || token.current_price)}</div>
          </div>
          <div className="space-y-2">
            <div className="text-sm text-gray-400">Volume 24h</div>
            <div className="font-mono text-lg">${formatValue(token.market?.stats?.volume24h || token.volume_24h)}</div>
          </div>
          <div className="space-y-2">
            <div className="text-sm text-gray-400">Market Cap</div>
            <div className="font-mono text-lg">${formatValue(token.market_cap)}</div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <div className="flex space-x-2">
          {token.twitter_handle && (
            <Link
              href={`https://twitter.com/${token.twitter_handle}`}
              target="_blank"
              className="text-gray-400 hover:text-red-500 transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
            </Link>
          )}
        </div>
        <Link href={`/agent/${token.mint_address}`}>
          <Badge className="bg-red-500 hover:bg-red-600 transition-colors">View Details</Badge>
        </Link>
      </CardFooter>
    </Card>
  )
}

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("")
  const [tokens, setTokens] = useState<Web3Agent[]>([])
  const [trendingTokens, setTrendingTokens] = useState<Web3Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const debouncedSearch = useDebounce(searchQuery, 300)

  useEffect(() => {
    const fetchTrendingTokens = async () => {
      try {
        const trending = await getTrendingTokens()
        setTrendingTokens(trending)
      } catch (error) {
        logger.error("Failed to fetch trending tokens", error as Error)
        // Don't show error UI for trending section failure
        setTrendingTokens([])
      }
    }

    fetchTrendingTokens()
  }, [])

  useEffect(() => {
    const fetchTokens = async () => {
      try {
        setLoading(true)
        const fetchedTokens = await listTokens({
          limit: 50,
          search: debouncedSearch,
          orderBy: "created_at",
          include_market_data: true
        })

        // Use batch endpoint to fetch market data
        const mintAddresses = fetchedTokens.map(token => token.mint_address)
        const marketDataResponse = await fetch('/api/agent/market-data-batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ mintAddresses })
        })

        if (marketDataResponse.ok) {
          const marketData = await marketDataResponse.json()
          const updatedTokens = fetchedTokens.map(token => ({
            ...token,
            market: marketData[token.mint_address]?.market || null,
            price_change_24h: marketData[token.mint_address]?.price_change_24h || 0
          }))
          setTokens(updatedTokens)
        } else {
          setTokens(fetchedTokens)
        }
        setError(null)
      } catch (error) {
        logger.error("Failed to fetch tokens", error as Error)
        setError("Failed to load tokens")
      } finally {
        setLoading(false)
      }
    }

    fetchTokens()
  }, [debouncedSearch])

  const agents = tokens.filter((token) => !token.is_swarm)
  const swarms = tokens.filter((token) => token.is_swarm)

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="relative -mx-4 -mt-20 px-4 pt-32 pb-16 bg-gradient-to-b from-red-500/10 via-purple-500/5 to-transparent">
        <div className="max-w-4xl mx-auto space-y-4">
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-red-500 via-red-400 to-red-500 bg-clip-text text-transparent">
              swarms
            </span>
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl">
            Trade and track AI agents and swarm intelligence tokens on Solana
          </p>
          <SearchBar onSearch={setSearchQuery} />
        </div>
      </div>

      {/* Trending Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-red-500" />
          <h2 className="text-2xl font-semibold">Trending</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {trendingTokens.map((token) => (
            <TokenCard key={token.id} token={token} />
          ))}
        </div>
      </div>

      {/* Main Content */}
      {error ? (
        <div className="text-center py-12">
          <div className="text-red-500 mb-2">{error}</div>
          <button onClick={() => window.location.reload()} className="text-red-500 hover:text-red-400 underline">
            Try again
          </button>
        </div>
      ) : (
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-black/50">
            <TabsTrigger value="all" className="data-[state=active]:bg-red-500">
              <Star className="h-4 w-4 mr-2" />
              All ({tokens.length})
            </TabsTrigger>
            <TabsTrigger value="agents" className="data-[state=active]:bg-red-500">
              <Bot className="h-4 w-4 mr-2" />
              Agents ({agents.length})
            </TabsTrigger>
            <TabsTrigger value="swarms" className="data-[state=active]:bg-red-500">
              <Users className="h-4 w-4 mr-2" />
              Swarms ({swarms.length})
            </TabsTrigger>
          </TabsList>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-red-500" />
            </div>
          ) : (
            <>
              <TabsContent value="all" className="mt-6">
                {tokens.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {tokens.map((token) => (
                      <TokenCard key={token.id} token={token} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-400">No tokens found matching your search</div>
                )}
              </TabsContent>

              <TabsContent value="agents" className="mt-6">
                {agents.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {agents.map((token) => (
                      <TokenCard key={token.id} token={token} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-400">No agents found matching your search</div>
                )}
              </TabsContent>

              <TabsContent value="swarms" className="mt-6">
                {swarms.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {swarms.map((token) => (
                      <TokenCard key={token.id} token={token} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-400">No swarms found matching your search</div>
                )}
              </TabsContent>
            </>
          )}
        </Tabs>
      )}
    </div>
  )
}


