"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TokenTrading } from "@/lib/solana/trading"
import { MeteoraService } from "@/lib/meteora/service"
import { useSolana } from "@/hooks/use-solana"
import { useAuth } from "@/components/providers/auth-provider"
import { toast } from "sonner"
import { PublicKey } from "@solana/web3.js"
import { logger } from "@/lib/logger"
import { Loader2 } from "lucide-react"
import { logActivity } from "@/lib/supabase/logging"
import { MAX_SLIPPAGE_PERCENT } from "@/lib/meteora/constants"
import { ComputeBudgetProgram } from "@solana/web3.js"
import { Transaction } from "@solana/web3.js"

interface TokenTradingPanelProps {
  mintAddress: string
  symbol: string
  currentPrice: number
  swapsTokenAddress?: string
  poolAddress?: string
  showCreatePool?: boolean
}

export function TokenTradingPanel({
  mintAddress,
  symbol,
  currentPrice: initialPrice,
  swapsTokenAddress,
  poolAddress,
  showCreatePool = false,
}: TokenTradingPanelProps) {
  const { connection } = useSolana()
  const { user } = useAuth()
  const [amount, setAmount] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [currentPrice, setCurrentPrice] = useState(initialPrice)
  const [estimatedCost, setEstimatedCost] = useState(0)
  const [slippage, setSlippage] = useState(MAX_SLIPPAGE_PERCENT)
  const [gasFee, setGasFee] = useState(0.000005) // Default SOL gas fee
  const [trading, setTrading] = useState<TokenTrading | null>(null)
  const [meteoraService, setMeteoraService] = useState<MeteoraService | null>(null)
  const [pool, setPool] = useState<{ address: PublicKey } | null>(null)

  useEffect(() => {
    if (connection) {
      setTrading(new TokenTrading(connection))
      setMeteoraService(new MeteoraService(connection))
    }
  }, [connection])

  // Initialize Meteora pool
  useEffect(() => {
    const initPool = async () => {
      if (!meteoraService || !swapsTokenAddress || !poolAddress) return

      try {
        const tokenMint = new PublicKey(mintAddress)
        const swapsMint = new PublicKey(swapsTokenAddress)
        const poolPublicKey = new PublicKey(poolAddress)
        const pool = await meteoraService.getPool(poolPublicKey)

        if (pool) {
          setPool(pool)
          logger.info("Found Meteora pool", {
            pool: pool.address.toString(),
            tokenA: pool.tokenAMint.toString(),
            tokenB: pool.tokenBMint.toString(),
          })
        }
      } catch (error) {
        logger.error("Failed to initialize Meteora pool", error as Error)
      }
    }

    initPool()
  }, [meteoraService, mintAddress, swapsTokenAddress, poolAddress])

  useEffect(() => {
    let interval: NodeJS.Timeout

    const updatePrice = async () => {
      if (trading) {
        try {
          const price = await trading.getCurrentPrice(mintAddress)
          setCurrentPrice(price)
        } catch (error) {
          logger.error("Failed to update price", error as Error)
        }
      }
    }

    if (trading) {
      interval = setInterval(updatePrice, 10000)
      updatePrice()
    }

    return () => {
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [trading, mintAddress])

  const handleSlippageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    if (!isNaN(value) && value >= 0.1 && value <= 100) {
      setSlippage(value)
    }
  }

  const handleGasFeeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    if (!isNaN(value) && value >= 0.000005) {
      setGasFee(value)
    }
  }

  const handleSwap = async (action: "buy" | "sell") => {
    try {
      if (!connection) {
        toast.error("Connection not initialized")
        return
      }

      if (!user) {
        toast.error("Please connect your wallet to trade")
        return
      }

      const walletAddress = user.user_metadata?.wallet_address
      if (!walletAddress) {
        toast.error("Wallet address not found")
        return
      }

      if (!amount || isNaN(Number.parseFloat(amount))) {
        toast.error("Please enter a valid amount")
        await logActivity({
          category: "trade",
          level: "warn",
          action: "trade_validation",
          details: {
            symbol,
            error: "Invalid amount",
          },
          wallet_address: walletAddress,
        })
        return
      }

      setIsLoading(true)
      const amountBigInt = BigInt(Math.floor(Number.parseFloat(amount) * 1e9))
      const toastId = toast.loading(`Processing ${action} order...`)

      try {
        // Call our trading API
        const response = await fetch('/api/solana/trade', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userPublicKey: walletAddress,
            tokenMint: mintAddress,
            amount: amountBigInt.toString(),
            action,
            maxPrice: action === "buy" ? currentPrice * (1 + slippage/100) : undefined,
            minPrice: action === "sell" ? currentPrice * (1 - slippage/100) : undefined,
          }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Trade failed')
        }

        const result = await response.json()

        await logActivity({
          category: "trade",
          level: "info",
          action: "trade_complete",
          details: {
            type: action,
            symbol,
            amount: Number.parseFloat(amount),
            price: result.price,
            signature: result.signature,
          },
          wallet_address: walletAddress,
        })

        toast.success(`${action.toUpperCase()} order completed!`, {
          id: toastId,
          description: (
            <div className="mt-2 text-xs font-mono break-all">
              <div>
                Amount: {amount} {action === "buy" ? symbol : "SWARMS"}
              </div>
              <div>Price: ${result.price.toFixed(6)}</div>
              <div>
                <a
                  href={`https://explorer.solana.com/tx/${result.signature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-600"
                >
                  View transaction
                </a>
              </div>
            </div>
          ),
        })

        setAmount("")
      } catch (error) {
        logger.error(`${action} order failed`, error as Error)

        await logActivity({
          category: "trade",
          level: "error",
          action: "trade_error",
          details: {
            type: action,
            symbol,
            amount: Number.parseFloat(amount),
            price: currentPrice,
          },
          error_message: error instanceof Error ? error.message : "Unknown error",
          wallet_address: walletAddress,
        })

        toast.error(`Failed to ${action}: ${error instanceof Error ? error.message : "Unknown error"}`, {
          id: toastId,
        })
      }
    } catch (error) {
      logger.error("Swap handling failed", error as Error)
      toast.error("Swap failed to process")
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreatePool = async () => {
    try {
      if (!connection) {
        toast.error("Connection not initialized")
        return
      }

      if (!user) {
        toast.error("Please connect your wallet to create pool")
        return
      }

      const walletAddress = user.user_metadata?.wallet_address
      if (!walletAddress) {
        toast.error("Wallet address not found")
        return
      }

      setIsLoading(true)
      const toastId = toast.loading("Creating pool...")

      try {
        // Call create-pool API with all required fields
        const response = await fetch('/api/solana/create-pool', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userPublicKey: walletAddress,
            tokenMint: mintAddress,
            swarmsAmount: 0  // No additional SWARMS for now
          }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to create pool')
        }

        const result = await response.json()

        // Sign the transaction
        // @ts-ignore - Phantom wallet type
        const provider = window?.phantom?.solana
        if (!provider) {
          throw new Error("Phantom wallet not found")
        }

        toast.loading("Please sign the transaction in your wallet...", { id: toastId })

        // Sign the transaction
        const tx = Transaction.from(Buffer.from(result.transaction, 'base64'))
        const signedTx = await provider.signTransaction(tx)

        // Send signed transaction back
        const confirmResponse = await fetch('/api/solana/create-pool', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            signedTransaction: signedTx.serialize().toString('base64'),
            tokenMint: mintAddress,
            poolKeys: result.poolKeys,
            swarmsAmount: 0
          }),
        })

        if (!confirmResponse.ok) {
          const error = await confirmResponse.json()
          throw new Error(error.error || 'Failed to confirm pool')
        }

        const { signature } = await confirmResponse.json()

        toast.success("Pool created successfully!", {
          id: toastId,
          description: (
            <div className="mt-2 text-xs font-mono break-all">
              <div>Token: {symbol}</div>
              <div>
                <a
                  href={`https://explorer.solana.com/tx/${signature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-600"
                >
                  View transaction
                </a>
              </div>
            </div>
          ),
        })

        // Refresh the page to show the new pool
        window.location.reload()

      } catch (error) {
        logger.error("Pool creation failed", error as Error)
        toast.error(error instanceof Error ? error.message : "Failed to create pool", { id: toastId })
      }
    } catch (error) {
      logger.error("Pool creation handling failed", error as Error)
      toast.error("Pool creation failed to process")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="bg-black/50 border-red-600/20">
      <CardHeader>
        <CardTitle className="text-xl font-bold">Trade {symbol}</CardTitle>
      </CardHeader>
      <CardContent>
        {!poolAddress ? (
          <div className="space-y-4">
            {showCreatePool ? (
              <>
                <p className="text-sm text-gray-400">No liquidity pool exists for this token yet. As the token creator, you can create one to enable trading.</p>
                <Button
                  onClick={handleCreatePool}
                  disabled={isLoading}
                  className="w-full"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating Pool...
                    </>
                  ) : (
                    "Create Pool"
                  )}
                </Button>
              </>
            ) : (
              <p className="text-sm text-gray-400">No liquidity pool has been established for this token yet. Trading will be enabled once the token creator creates a pool.</p>
            )}
          </div>
        ) : (
          <Tabs defaultValue="buy">
            <TabsList className="grid w-full grid-cols-2 bg-black/50">
              <TabsTrigger value="buy" className="data-[state=active]:bg-red-600">
                Buy
              </TabsTrigger>
              <TabsTrigger value="sell" className="data-[state=active]:bg-gray-600">
                Sell
              </TabsTrigger>
            </TabsList>
            <TabsContent value="buy">
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Amount (SWARMS)</Label>
                  <Input
                    type="number"
                    placeholder="Enter SWARMS amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="bg-black/50 border-red-600/20 focus:border-red-600"
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-gray-400">Slippage:</p>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          value={slippage}
                          onChange={handleSlippageChange}
                          className="w-16 h-6 text-xs bg-black/50 border-red-600/20 focus:border-red-600"
                          min="0.1"
                          max="100"
                          step="0.1"
                        />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-gray-400">Gas (SOL):</p>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          value={gasFee}
                          onChange={handleGasFeeChange}
                          className="w-24 h-6 text-xs bg-black/50 border-red-600/20 focus:border-red-600"
                          min="0.000005"
                          step="0.000001"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <Button
                  className="w-full bg-red-600 hover:bg-red-700"
                  onClick={() => handleSwap("buy")}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    `Buy ${symbol} with SWARMS`
                  )}
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="sell">
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Amount ({symbol})</Label>
                  <Input
                    type="number"
                    placeholder={`Enter ${symbol} amount`}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="bg-black/50 border-gray-600/20 focus:border-gray-600"
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-gray-400">Slippage:</p>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          value={slippage}
                          onChange={handleSlippageChange}
                          className="w-16 h-6 text-xs bg-black/50 border-red-600/20 focus:border-red-600"
                          min="0.1"
                          max="100"
                          step="0.1"
                        />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-gray-400">Gas (SOL):</p>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          value={gasFee}
                          onChange={handleGasFeeChange}
                          className="w-24 h-6 text-xs bg-black/50 border-red-600/20 focus:border-red-600"
                          min="0.000005"
                          step="0.000001"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <Button
                  className="w-full bg-gray-600 hover:bg-gray-700"
                  onClick={() => handleSwap("sell")}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    `Sell ${symbol} for SWARMS`
                  )}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  )
}

