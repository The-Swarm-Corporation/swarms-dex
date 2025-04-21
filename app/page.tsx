"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Bot, ExternalLink, Star, Flame, Loader2, Share2, Copy, Twitter, DiscIcon as Discord, Send } from "lucide-react"
import Link from "next/link"
import { listTokens, getTrendingTokens } from "@/lib/api"
import type { Web3Agent } from "@/lib/supabase/types"
import { logger } from "@/lib/logger"
import { useDebounce } from "@/hooks/use-debounce"
import { SearchBar } from "@/components/search-bar"
import { Button } from "@/components/ui/button"
import { ShareModal } from "@/components/share-modal"
import { 
  Pagination, 
  PaginationContent, 
  PaginationItem, 
  PaginationLink, 
  PaginationNext, 
  PaginationPrevious 
} from "@/components/ui/pagination"

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
  const [shareModalOpen, setShareModalOpen] = useState(false)

  // Format price with proper decimals
  const formatPrice = (price: number | null | undefined) => {
    if (!price) return "0.00"
    if (price < 0.01) {
      return price.toLocaleString(undefined, {
        minimumFractionDigits: 8,
        maximumFractionDigits: 8
      })
    }
    return price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    })
  }

  // Simplified market cap formatter
  const formatMarketCap = (value: number | null | undefined) => {
    const numValue = Number(value) || 0
    if (numValue >= 1e9) return `${(numValue / 1e9).toFixed(1)}B`
    if (numValue >= 1e6) return `${(numValue / 1e6).toFixed(1)}M`
    if (numValue >= 1e3) return `${(numValue / 1e3).toFixed(1)}K`
    return numValue.toFixed(1)
  }

  const marketCap = token.market?.stats?.marketCap || token.market_cap || 0

  return (
    <>
      <Card className="group relative bg-black border-[1px] border-red-500/20 hover:border-red-500/40 transition-all duration-300 hover:scale-[1.02] before:absolute before:inset-0 before:p-[1px] before:bg-gradient-to-r before:from-red-500/50 before:via-transparent before:to-red-500/50 before:rounded-lg before:-z-10 after:absolute after:inset-0 after:p-[1px] after:bg-gradient-to-b after:from-red-500/50 after:via-transparent after:to-red-500/50 after:rounded-lg after:-z-10">
        <Link href={`/agent/${token.mint_address}`}>
          <div className="absolute inset-0 bg-gradient-to-br from-black via-black/95 to-red-950/10 rounded-lg z-0"></div>
          <div className="p-4 relative z-10">
            <div className="flex items-start gap-3">
              {token.image_url && (
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-black/20 ring-1 ring-red-500/20 shadow-lg shadow-red-500/10 flex-shrink-0">
                  <img 
                    src={token.image_url} 
                    alt={`${token.name} logo`}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-bold group-hover:text-red-500 transition-colors truncate">
                    {token.name}
                  </h2>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className="text-xs border-red-500/20 text-red-400 bg-red-500/5">
                      MC: ${formatMarketCap(marketCap)}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="w-fit border-red-500/20 text-red-400 bg-red-500/5">
                    ${formatPrice(token.market?.stats?.price || token.current_price)}
                  </Badge>
                  {token.price_change_24h !== undefined && (
                    <Badge
                      variant={token.price_change_24h >= 0 ? "default" : "destructive"}
                      className={`${token.price_change_24h >= 0 ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}
                    >
                      {token.price_change_24h >= 0 ? "+" : ""}
                      {token.price_change_24h.toFixed(2)}%
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-gray-400 mt-2 mb-3 line-clamp-2">{token.description}</p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShareModalOpen(true);
                    }}
                    className="flex-1 h-8 text-red-400 hover:text-white border-red-500/20 hover:border-red-500 hover:bg-red-500/20 transition-colors"
                  >
                    <Share2 className="h-4 w-4 mr-2" />
                    Share
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-8 text-red-400 hover:text-white border-red-500/20 hover:border-red-500 hover:bg-red-500/20 transition-colors"
                  >
                    Trade
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Link>
      </Card>
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
  const [currentPage, setCurrentPage] = useState(1)
  const debouncedSearch = useDebounce(searchQuery, 300)

  const TOKENS_PER_PAGE = 20
  
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
          
          // Sort tokens by market cap for the top market cap section
          const sortedByMarketCap = [...updatedTokens].sort((a, b) => {
            const marketCapA = a.market?.stats?.marketCap || a.market_cap || 0
            const marketCapB = b.market?.stats?.marketCap || b.market_cap || 0
            return marketCapB - marketCapA
          })
          
          setTokens(sortedByMarketCap)
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

  const paginateTokens = (tokenList: Web3Agent[]) => {
    const startIndex = (currentPage - 1) * TOKENS_PER_PAGE
    const endIndex = startIndex + TOKENS_PER_PAGE
    return tokenList.slice(startIndex, endIndex)
  }

  const renderPagination = (totalItems: number) => {
    const totalPages = Math.ceil(totalItems / TOKENS_PER_PAGE)
    if (totalPages <= 1) return null

    const getPageNumbers = () => {
      const pages = []
      for (let i = 1; i <= totalPages; i++) {
        if (
          i === 1 ||
          i === totalPages ||
          (i >= currentPage - 2 && i <= currentPage + 2)
        ) {
          pages.push(i)
        } else if (i === currentPage - 3 || i === currentPage + 3) {
          pages.push('...')
        }
      }
      return pages
    }

    return (
      <Pagination className="mt-8">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              className={currentPage === 1 ? "pointer-events-none opacity-50" : ""}
            />
          </PaginationItem>
          
          {getPageNumbers().map((page, idx) => (
            <PaginationItem key={idx}>
              {page === '...' ? (
                <PaginationLink className="pointer-events-none">...</PaginationLink>
              ) : (
                <PaginationLink
                  onClick={() => setCurrentPage(page as number)}
                  isActive={currentPage === page}
                  className={currentPage === page ? "bg-red-500 text-white hover:bg-red-600" : ""}
                >
                  {page}
                </PaginationLink>
              )}
            </PaginationItem>
          ))}

          <PaginationItem>
            <PaginationNext
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              className={currentPage === totalPages ? "pointer-events-none opacity-50" : ""}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    )
  }

  // Reset pagination when search changes
  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch])

  const agents = tokens.filter((token) => !token.is_swarm)

  const paginatedTokens = paginateTokens(tokens)
  const paginatedAgents = paginateTokens(agents)

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="relative -mx-4 -mt-20 px-4 pt-32 pb-16 bg-gradient-to-b from-red-500/10 via-purple-500/5 to-transparent">
        <div className="max-w-4xl mx-auto space-y-4">
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-red-500 via-red-400 to-red-500 bg-clip-text text-transparent">
              Swarms Launchpad
            </span>
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl">
            The Definitive Agent Token Launchpad.
          </p>
          <SearchBar onSearch={setSearchQuery} />
        </div>
      </div>

      {/* Top Market Cap Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Star className="h-5 w-5 text-red-500" />
          <h2 className="text-2xl font-semibold">Top by Market Cap</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tokens.slice(0, 6).map((token) => (
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
          </TabsList>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-red-500" />
            </div>
          ) : (
            <>
              <TabsContent value="all" className="mt-6">
                {tokens.length > 0 ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {paginatedTokens.map((token) => (
                        <TokenCard key={token.id} token={token} />
                      ))}
                    </div>
                    {renderPagination(tokens.length)}
                  </>
                ) : (
                  <div className="text-center py-12 text-gray-400">No tokens found matching your search</div>
                )}
              </TabsContent>

              <TabsContent value="agents" className="mt-6">
                {agents.length > 0 ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {paginatedAgents.map((token) => (
                        <TokenCard key={token.id} token={token} />
                      ))}
                    </div>
                    {renderPagination(agents.length)}
                  </>
                ) : (
                  <div className="text-center py-12 text-gray-400">No agents found matching your search</div>
                )}
              </TabsContent>
            </>
          )}
        </Tabs>
      )}

      {/* Ending Section */}
      <div className="mt-20 mb-12">
        <Card className="w-full bg-gradient-to-br from-black via-red-950/20 to-black border-[1px] border-red-500/20 hover:border-red-500/40 transition-all duration-300 overflow-hidden relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-red-500/20 via-transparent to-transparent opacity-50"></div>
          <div className="relative z-10 p-8 md:p-12">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-center mb-6 bg-gradient-to-r from-red-500 via-red-400 to-red-500 bg-clip-text text-transparent">
              Let's Automate the World Economy
            </h2>
            <p className="text-gray-400 text-center max-w-2xl mx-auto mb-8">
              Join us in building the future of automated finance. Connect, collaborate, and create with Swarms.
            </p>
            <div className="flex justify-center items-center space-x-6">
              <Link 
                href="https://twitter.com/swarms_corp" 
                target="_blank"
                className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-500/10 rounded-full relative
                         before:absolute before:inset-0 before:rounded-full before:border before:border-red-500/50 before:scale-0 
                         hover:before:scale-100 before:transition-transform before:duration-300"
              >
                <Twitter className="h-6 w-6" />
              </Link>
              <Link 
                href="https://discord.gg/jM3Z6M9uMq" 
                target="_blank"
                className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-500/10 rounded-full relative
                         before:absolute before:inset-0 before:rounded-full before:border before:border-red-500/50 before:scale-0 
                         hover:before:scale-100 before:transition-transform before:duration-300"
              >
                <Discord className="h-6 w-6" />
              </Link>
              <Link 
                href="https://t.me/swarmsgroupchat" 
                target="_blank"
                className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-500/10 rounded-full relative
                         before:absolute before:inset-0 before:rounded-full before:border before:border-red-500/50 before:scale-0 
                         hover:before:scale-100 before:transition-transform before:duration-300"
              >
                <Send className="h-6 w-6" />
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}


