"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Bot, Users, ExternalLink, Star, Flame, Loader2, Share2, Copy, Twitter } from "lucide-react"
import Link from "next/link"
import { listTokens, getTrendingTokens } from "@/lib/api"
import type { Web3Agent } from "@/lib/supabase/types"
import { logger } from "@/lib/logger"
import { useDebounce } from "@/hooks/use-debounce"
import { SearchBar } from "@/components/search-bar"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

function ShareModal({ 
  isOpen, 
  onClose, 
  token 
}: { 
  isOpen: boolean
  onClose: () => void
  token: Web3Agent
}) {
  const url = `${window.location.origin}/agent/${token.mint_address}`;
  const shareText = `Check out ${token.name} (${token.token_symbol}) on Swarms DEX`;
  
  const shareLinks = [
    {
      name: 'Twitter',
      icon: <Twitter className="h-5 w-5" />,
      url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText + '\n\n' + url)}`,
      color: 'text-gray-400 hover:text-[#1DA1F2] hover:bg-[#1DA1F2]/10'
    },
    {
      name: 'Facebook',
      icon: (
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/>
        </svg>
      ),
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
      color: 'text-gray-400 hover:text-[#4267B2] hover:bg-[#4267B2]/10'
    },
    {
      name: 'LinkedIn',
      icon: (
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
        </svg>
      ),
      url: `https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(url)}&title=${encodeURIComponent(shareText)}`,
      color: 'text-gray-400 hover:text-[#0077B5] hover:bg-[#0077B5]/10'
    },
    {
      name: 'Telegram',
      icon: (
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
        </svg>
      ),
      url: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(shareText)}`,
      color: 'text-gray-400 hover:text-[#0088cc] hover:bg-[#0088cc]/10'
    },
    {
      name: 'WhatsApp',
      icon: (
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      ),
      url: `https://wa.me/?text=${encodeURIComponent(shareText + '\n\n' + url)}`,
      color: 'text-gray-400 hover:text-[#25D366] hover:bg-[#25D366]/10'
    },
    {
      name: 'Reddit',
      icon: (
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/>
        </svg>
      ),
      url: `https://reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(shareText)}`,
      color: 'text-gray-400 hover:text-[#FF4500] hover:bg-[#FF4500]/10'
    }
  ];

  const copyToClipboard = () => {
    navigator.clipboard.writeText(url);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-black/95 border-red-600/20">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-red-500">Share {token.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div className="flex items-center gap-4">
            {token.image_url && (
              <img 
                src={token.image_url} 
                alt={`${token.name} logo`} 
                className="w-12 h-12 rounded-lg bg-black/20"
              />
            )}
            <div>
              <h3 className="font-bold text-lg text-white">{token.name}</h3>
              <p className="text-sm text-gray-400">{token.token_symbol}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {shareLinks.map((link) => (
                <Button
                  key={link.name}
                  variant="outline"
                  className={`h-12 border-red-600/20 bg-black/50 ${link.color}`}
                  onClick={() => {
                    window.open(link.url, '_blank');
                    onClose();
                  }}
                >
                  {link.icon}
                  <span className="ml-2">{link.name}</span>
                </Button>
              ))}
            </div>

            <div className="flex items-center gap-2 bg-black/50 border border-red-600/20 rounded-lg p-3">
              <input
                type="text"
                value={url}
                readOnly
                className="flex-1 bg-transparent border-none focus:outline-none text-sm font-mono text-gray-400"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={copyToClipboard}
                className="text-gray-400 hover:text-red-500 hover:bg-red-500/10"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TokenCard({ token }: { token: Web3Agent & { 
  price_change_24h?: number
  market?: {
    stats?: {
      price: number
      volume24h: number
      apy: number
      marketCap: number
    }
  }
} }) {
  const [shareModalOpen, setShareModalOpen] = useState(false);

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

  // Get the most up-to-date market cap value
  const marketCap = token.market?.stats?.marketCap || token.market_cap || 0

  return (
    <>
      <Link href={`/agent/${token.mint_address}`} className="block">
        <Card className="group bg-black/50 border border-red-500/20 hover:border-red-500/40 transition-all hover:scale-[1.02] hover:shadow-lg hover:shadow-red-500/10">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {token.image_url && (
                  <div className="w-12 h-12 rounded-lg overflow-hidden bg-black/20">
                    <img 
                      src={token.image_url} 
                      alt={`${token.name} logo`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
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
                <div className="font-mono text-lg">${formatValue(marketCap)}</div>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <div className="flex items-center gap-4 w-full">
              {token.twitter_handle && (
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={(e) => e.stopPropagation()}
                  className="relative z-10 px-4 py-6 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl"
                >
                  <Link
                    href={`https://twitter.com/${token.twitter_handle}`}
                    target="_blank"
                    className="flex items-center justify-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-8 w-8" />
                  </Link>
                </Button>
              )}
              <Button
                variant="ghost"
                size="lg"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShareModalOpen(true);
                }}
                className="relative z-10 ml-auto px-4 py-6 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl"
              >
                <Share2 className="h-8 w-8" />
              </Button>
            </div>
          </CardFooter>
        </Card>
      </Link>
      <ShareModal 
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        token={token}
      />
    </>
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
            market: {
              ...marketData[token.mint_address]?.market,
              stats: {
                ...marketData[token.mint_address]?.market?.stats,
                marketCap: marketData[token.mint_address]?.market_cap
              }
            },
            market_cap: marketData[token.mint_address]?.market_cap,
            price_change_24h: marketData[token.mint_address]?.price_change_24h
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


