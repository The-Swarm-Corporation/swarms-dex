"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Wallet, Loader2, ExternalLink, Coins } from "lucide-react"
import { logger } from "@/lib/logger"
import { logActivity } from "@/lib/supabase/logging"
import { useAuth } from "@/components/providers/auth-provider"
import Link from "next/link"
import { toast } from "sonner"

interface TokenHolding {
  symbol: string
  balance: number
  mintAddress: string
  uiAmount: number
  decimals: number
  currentPrice: number
  value: number
}

export function HoldingsDialog() {
  const { user, loading: authLoading, isAuthenticated, walletAddress } = useAuth()
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [holdings, setHoldings] = useState<TokenHolding[]>([])
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (open && mounted && !authLoading && isAuthenticated && walletAddress) {
      fetchHoldings()
    }
  }, [mounted, authLoading, isAuthenticated, walletAddress, open])

  const fetchHoldings = async () => {
    if (!mounted || !isAuthenticated || !walletAddress) {
      console.log("Cannot fetch holdings:", {
        mounted,
        isAuthenticated,
        walletAddress
      })
      setError("Please connect your wallet first")
      return
    }

    try {
      setLoading(true)
      setError(null)
      setHoldings([]) // Clear existing holdings while loading

      const response = await fetch(`/api/tokens/holdings?wallet=${walletAddress}`, {
        // Add cache control headers
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to fetch holdings')
      }

      const holdings = await response.json()

      if (!Array.isArray(holdings)) {
        throw new Error('Invalid holdings data received')
      }

      logger.info("Holdings fetched successfully", {
        count: holdings.length,
      })

      await logActivity({
        category: "wallet",
        level: "info",
        action: "holdings_fetch",
        details: {
          count: holdings.length,
        },
        wallet_address: walletAddress,
      })

      setHoldings(holdings)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred"
      logger.error("Failed to fetch holdings", error as Error)

      await logActivity({
        category: "wallet",
        level: "error",
        action: "holdings_fetch_error",
        details: {
          error: errorMessage,
        },
        wallet_address: walletAddress,
      })

      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  if (!mounted) return null

  const currencies = holdings.filter(h => h.symbol === "SOL" || h.symbol === "SWARMS")
  const agentTokens = holdings.filter(h => h.symbol !== "SOL" && h.symbol !== "SWARMS")
  const totalValue = holdings.reduce((sum, holding) => sum + holding.value, 0)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          className="bg-black/50"
          disabled={loading || !isAuthenticated}
          onClick={() => {
            if (!isAuthenticated) {
              toast.error("Please connect your wallet first")
            }
          }}
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </>
          ) : (
            <>
              <Wallet className="mr-2 h-4 w-4" />
              Holdings
            </>
          )}
        </Button>
      </DialogTrigger>

      <DialogContent className="bg-black/95 border-red-600/20">
        <DialogHeader>
          <div className="flex justify-between items-center">
            <DialogTitle className="text-red-600">Wallet Holdings</DialogTitle>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:text-red-500"
                onClick={fetchHoldings}
                disabled={loading || !isAuthenticated}
              >
                <Coins className="h-4 w-4 mr-1" />
                Refresh
              </Button>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                {currencies.map((currency) => (
                  <div key={currency.symbol} className="flex items-center gap-1">
                    <span>{currency.symbol}</span>
                    <span className="font-mono">
                      {currency.uiAmount.toLocaleString(undefined, {
                        maximumFractionDigits: currency.decimals,
                      })}
                    </span>
                  </div>
                ))}
                <div className="border-l border-red-600/20 pl-3">
                  <span className="font-mono">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          </div>
          <DialogDescription>View your AI agent holdings</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error ? (
            <div className="text-center text-red-500 py-4 space-y-2">
              <div>{error}</div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchHoldings}
                disabled={loading || !isAuthenticated}
              >
                Try Again
              </Button>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-2">
              <Loader2 className="h-6 w-6 animate-spin text-red-600" />
              <div className="text-sm text-gray-400">Fetching your holdings...</div>
            </div>
          ) : holdings.length > 0 && agentTokens.length > 0 ? (
            <div className="space-y-3">
              <div className="grid gap-3 grid-cols-1">
                {agentTokens
                  .sort((a, b) => b.value - a.value)
                  .map((token) => (
                    <div
                      key={`${token.mintAddress}-${token.symbol}`}
                      className="flex justify-between items-center p-4 rounded-lg bg-gradient-to-r from-red-600/20 to-red-900/20 border border-red-600/30 hover:border-red-600/50 transition-colors"
                    >
                      <div className="space-y-1.5">
                        <div className="font-bold text-lg flex items-center gap-2">
                          {token.symbol}
                          <Link
                            href={`/agent/${token.mintAddress}`}
                            className="text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </div>
                        {token.value > 0 && (
                          <div className="text-sm text-gray-300">
                            ${(token.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-lg">
                          {token.uiAmount.toLocaleString(undefined, {
                            maximumFractionDigits: token.decimals,
                          })}
                        </div>
                        {token.currentPrice > 0 && (
                          <div className="text-sm text-gray-300">
                            ${(token.currentPrice).toFixed(4)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div className="text-center text-gray-400 py-8 space-y-2">
              <div>No AI agents currently owned</div>
              <div className="text-sm">Purchase agent tokens to get started</div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

