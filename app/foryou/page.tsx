"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { 
  ChevronUp, 
  ChevronDown, 
  ShoppingCart, 
  TrendingDown,
  ArrowUpDown,
  ChevronUpIcon,
  ChevronDownIcon
} from "lucide-react"
import { listTokens } from "@/lib/api"
import type { Web3Agent } from "@/lib/supabase/types"
import { Button } from "@/components/ui/button"
import { TokenTradingPanel } from "@/components/token-trading-panel"
import { useAuth } from "@/components/providers/auth-provider"
import { toast } from "sonner"
import Image from "next/image"
import { cn } from "@/lib/utils"

export default function ForYouPage() {
  const { user } = useAuth()
  const [tokens, setTokens] = useState<Web3Agent[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isTrading, setIsTrading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollTimeout = useRef<NodeJS.Timeout>()
  const [isScrolling, setIsScrolling] = useState(false)
  const lastScrollTime = useRef<number>(0)
  const SCROLL_COOLDOWN = 150 // Shorter cooldown for more responsive scrolling

  useEffect(() => {
    const fetchTokens = async () => {
      try {
        setLoading(true)
        console.log("Fetching tokens...")
        const tokens = await listTokens({
          limit: 50,
          orderBy: "market_cap",
          include_market_data: true
        })
        console.log("Received tokens:", tokens)
        setTokens(tokens)
      } catch (error) {
        console.error("Failed to fetch tokens:", error)
        setError("Failed to load tokens")
      } finally {
        setLoading(false)
      }
    }
    fetchTokens()
  }, [])

  // Add debug log for render
  console.log("Current render state:", { tokens, currentIndex, loading, error })

  const formatPrice = (price: number | undefined | null) => {
    if (!price) return "$0.00"
    return price < 0.01 
      ? `$${price.toFixed(8)}`
      : `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
  }

  const formatMarketCap = (value: number | undefined | null) => {
    if (!value) return "$0"
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`
    if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`
    return `$${value.toFixed(1)}`
  }

  const handleScroll = useCallback((direction: 'up' | 'down') => {
    const now = Date.now()
    if (now - lastScrollTime.current < SCROLL_COOLDOWN) return
    lastScrollTime.current = now

    setCurrentIndex(prev => {
      const nextIndex = direction === 'up' ? prev - 1 : prev + 1
      if (nextIndex >= 0 && nextIndex < tokens.length) {
        return nextIndex
      }
      return prev
    })
  }, [tokens.length])

  const handleKeyPress = useCallback((event: KeyboardEvent) => {
    // Prevent default behavior for arrow keys to avoid page scrolling
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
    }

    const now = Date.now()
    if (now - lastScrollTime.current < SCROLL_COOLDOWN) return
    lastScrollTime.current = now

    // Handle arrow keys for navigation
    if (event.key === 'ArrowUp') {
      handleScroll('up')
    } else if (event.key === 'ArrowDown') {
      handleScroll('down')
    }

    // Handle keyboard shortcuts
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
    const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey

    if (cmdOrCtrl && !isTrading) {
      if (event.key.toLowerCase() === 'b') {
        event.preventDefault()
        if (!user) {
          toast.error("Please connect your wallet first")
          return
        }
        setIsTrading(true)
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!user) {
          toast.error("Please connect your wallet first")
          return
        }
        setIsTrading(true)
      }
    }
  }, [handleScroll, user, isTrading])

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    
    const now = Date.now()
    if (now - lastScrollTime.current < SCROLL_COOLDOWN) return
    
    // Determine scroll direction with a threshold to prevent accidental scrolls
    const threshold = 10
    if (Math.abs(event.deltaY) > threshold) {
      handleScroll(event.deltaY > 0 ? 'down' : 'up')
    }
  }, [handleScroll])

  // Set up event listeners with passive: false for better scroll control
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const wheelOptions = { passive: false }

    // Add event listeners
    window.addEventListener('keydown', handleKeyPress)
    container.addEventListener('wheel', handleWheel, wheelOptions)

    // Cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyPress)
      container.removeEventListener('wheel', handleWheel)
    }
  }, [handleKeyPress, handleWheel])

  // Add keyboard shortcut hints to buttons
  const isMac = typeof window !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const modifierKey = isMac ? '⌘' : 'Ctrl'

  return (
    <div 
      className="fixed inset-0 bg-gradient-to-b from-black to-zinc-950" 
      ref={containerRef}
      style={{ overscrollBehavior: 'none' }} // Prevent browser bounce effect
    >
      {loading ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-red-500 animate-spin w-8 h-8 border-2 border-current border-t-transparent rounded-full" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-full text-red-500">
          {error}
        </div>
      ) : tokens.length === 0 ? (
        <div className="flex items-center justify-center h-full text-red-500">
          No tokens found
        </div>
      ) : (
        <AnimatePresence mode="wait">
          {tokens[currentIndex] && (
            <motion.div
              key={tokens[currentIndex].id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="h-full w-full relative"
            >
              {/* Token Card */}
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <div className="w-full max-w-md aspect-[9/16] relative group">
                  {/* Card Background with optimized border */}
                  <div className="absolute inset-0 rounded-2xl bg-black/90 backdrop-blur-xl" />
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-red-500/5 to-transparent" />
                  <div className="absolute inset-0 rounded-2xl border border-red-500/10 overflow-hidden" />
                  <div className="absolute inset-[1px] rounded-2xl bg-gradient-to-b from-red-500/[0.05] via-transparent to-transparent" />
                  
                  {/* Token Content */}
                  <div className="relative h-full p-6 flex flex-col">
                    {/* Token Image with Next.js Image */}
                    <div className="flex-1 flex items-center justify-center">
                      <div className="relative w-64 h-64">
                        {/* Glow Effect */}
                        <div className="absolute inset-0 bg-gradient-radial from-red-500/10 to-transparent rounded-full blur-2xl transform scale-110" />
                        
                        {/* Image */}
                        <div className="relative w-full h-full">
                          {tokens[currentIndex].image_url ? (
                            <Image
                              src={tokens[currentIndex].image_url}
                              alt={tokens[currentIndex].name}
                              fill
                              className="object-contain"
                              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                              priority
                            />
                          ) : (
                            <div className="w-full h-full rounded-full bg-gradient-to-br from-red-500/20 to-red-900/20" />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Token Info */}
                    <div className="space-y-6">
                      <div className="text-center">
                        <h2 className="text-2xl font-bold bg-gradient-to-r from-white via-red-100 to-white bg-clip-text text-transparent">
                          {tokens[currentIndex].name}
                        </h2>
                        <p className="text-xl font-mono font-semibold text-red-400">
                          {formatPrice(tokens[currentIndex].current_price)}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-center">
                        <div className="bg-black/60 p-3 rounded-xl backdrop-blur-xl border border-red-500/10 group-hover:border-red-500/20 transition-colors">
                          <p className="text-xs text-gray-400 mb-1">Market Cap</p>
                          <p className="text-white font-mono">
                            {formatMarketCap(tokens[currentIndex].market_cap)}
                          </p>
                        </div>
                        <div className="bg-black/60 p-3 rounded-xl backdrop-blur-xl border border-red-500/10 group-hover:border-red-500/20 transition-colors">
                          <p className="text-xs text-gray-400 mb-1">24h Change</p>
                          <p className={cn(
                            "font-mono",
                            tokens[currentIndex].price_change_24h != null && tokens[currentIndex].price_change_24h >= 0 
                              ? "text-green-400" 
                              : "text-red-400"
                          )}>
                            {tokens[currentIndex].price_change_24h != null && (tokens[currentIndex].price_change_24h >= 0 ? "+" : "")}
                            {tokens[currentIndex].price_change_24h != null ? `${tokens[currentIndex].price_change_24h.toFixed(2)}%` : "N/A"}
                          </p>
                        </div>
                      </div>

                      {/* Trading Panel */}
                      {!isTrading ? (
                        <div className="flex justify-center gap-3">
                          <Button 
                            size="sm"
                            className="bg-green-500/90 hover:bg-green-500 text-white backdrop-blur-sm transition-all duration-300 
                                     relative group px-6 py-2 h-10 flex items-center gap-2 hover:scale-105 active:scale-95"
                            onClick={() => {
                              if (!user) {
                                toast.error("Please connect your wallet first");
                                return;
                              }
                              setIsTrading(true);
                            }}
                          >
                            <ShoppingCart className="w-4 h-4" />
                            <span className="font-medium">Buy</span>
                            <span className="ml-1 opacity-50 text-xs group-hover:opacity-100 transition-opacity border-l border-white/20 pl-2">
                              {modifierKey}+B
                            </span>
                          </Button>
                          <Button 
                            size="sm"
                            variant="outline"
                            className="border-red-500/20 text-red-400 hover:bg-red-500/10 backdrop-blur-sm transition-all duration-300 
                                     relative group px-6 py-2 h-10 flex items-center gap-2 hover:scale-105 active:scale-95"
                            onClick={() => {
                              if (!user) {
                                toast.error("Please connect your wallet first");
                                return;
                              }
                              setIsTrading(true);
                            }}
                          >
                            <TrendingDown className="w-4 h-4" />
                            <span className="font-medium">Sell</span>
                            <span className="ml-1 opacity-50 text-xs group-hover:opacity-100 transition-opacity border-l border-red-500/20 pl-2">
                              {modifierKey}+S
                            </span>
                          </Button>
                        </div>
                      ) : (
                        <TokenTradingPanel
                          mintAddress={tokens[currentIndex].mint_address}
                          symbol={tokens[currentIndex].token_symbol}
                          currentPrice={tokens[currentIndex].current_price || 0}
                          poolAddress={tokens[currentIndex].pool_address || undefined}
                          swapsTokenAddress={process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS}
                          onTradingStateChange={setIsTrading}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Navigation Controls */}
              <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-3">
                <button
                  onClick={() => handleScroll('up')}
                  className={cn(
                    "p-2.5 rounded-full bg-black/80 text-white backdrop-blur-xl border border-red-500/20",
                    "hover:border-red-500/40 hover:bg-black hover:scale-110 hover:shadow-lg hover:shadow-red-500/10",
                    "transition-all duration-200 ease-out",
                    "disabled:opacity-50 disabled:hover:border-red-500/20 disabled:hover:scale-100 disabled:hover:shadow-none",
                    "active:scale-95 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                  )}
                  disabled={currentIndex === 0}
                  aria-label="Previous token"
                >
                  <ChevronUpIcon className="w-5 h-5" />
                </button>
                <div className="text-center text-sm font-medium text-gray-400 bg-black/60 px-2 py-1 rounded-md backdrop-blur-sm">
                  {currentIndex + 1}/{tokens.length}
                </div>
                <button
                  onClick={() => handleScroll('down')}
                  className={cn(
                    "p-2.5 rounded-full bg-black/80 text-white backdrop-blur-xl border border-red-500/20",
                    "hover:border-red-500/40 hover:bg-black hover:scale-110 hover:shadow-lg hover:shadow-red-500/10",
                    "transition-all duration-200 ease-out",
                    "disabled:opacity-50 disabled:hover:border-red-500/20 disabled:hover:scale-100 disabled:hover:shadow-none",
                    "active:scale-95 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                  )}
                  disabled={currentIndex === tokens.length - 1}
                  aria-label="Next token"
                >
                  <ChevronDownIcon className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  )
}
