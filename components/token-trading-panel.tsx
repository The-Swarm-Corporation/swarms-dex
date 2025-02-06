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
import { Transaction, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js"

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
  poolAddress: initialPoolAddress,
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
  const [currentPoolAddress, setCurrentPoolAddress] = useState<string | null>(initialPoolAddress || null)

  useEffect(() => {
    if (connection) {
      setTrading(new TokenTrading(connection))
      setMeteoraService(new MeteoraService(connection))
    }
  }, [connection])

  // Initialize Meteora pool
  useEffect(() => {
    const initPool = async () => {
      if (!meteoraService || !swapsTokenAddress || !currentPoolAddress) return

      try {
        const tokenMint = new PublicKey(mintAddress)
        const swapsMint = new PublicKey(swapsTokenAddress)
        const poolPublicKey = new PublicKey(currentPoolAddress)
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
  }, [meteoraService, mintAddress, swapsTokenAddress, currentPoolAddress])

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

      // @ts-ignore - Phantom wallet type
      const provider = window?.phantom?.solana
      if (!provider) {
        toast.error("Phantom wallet not found")
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
        // Call our trading API to get the transaction
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

        const { transaction: serializedTransaction, price } = await response.json()
        
        // Deserialize the transaction
        const transaction = Transaction.from(Buffer.from(serializedTransaction, 'base64'))

        toast.loading("Please approve the transaction in your wallet...", { id: toastId })

        try {
          // Let Phantom handle just the signing
          const signedTransaction = await provider.signTransaction(transaction)
          
          // Send signed transaction back to server for submission
          const submitResponse = await fetch('/api/solana/trade', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              signedTransaction: signedTransaction.serialize().toString('base64'),
              tokenMint: mintAddress,
              action,
            }),
          })

          if (!submitResponse.ok) {
            const error = await submitResponse.json()
            throw new Error(error.error || 'Failed to submit transaction')
          }

          const { signature } = await submitResponse.json()
          
          toast.loading("Confirming transaction...", { id: toastId })

          // Wait for confirmation using our server endpoint
          let confirmed = false
          for (let i = 0; i < 3; i++) {
            try {
              const confirmResponse = await fetch('/api/solana/confirm-transaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ signature })
              })

              if (!confirmResponse.ok) {
                const error = await confirmResponse.json()
                if (error.error?.includes('Please check the transaction status manually')) {
                  if (i === 2) {
                    toast.info("Transaction sent but confirmation pending", {
                      id: toastId,
                      duration: 5000,
                      description: (
                        <div className="mt-2 text-xs font-mono break-all">
                          <div>Amount: {amount} {action === "buy" ? "SWARMS" : symbol}</div>
                          <div>Price: ${price.toFixed(6)}</div>
                          <div>The transaction has been sent but is still processing.</div>
                          <div>
                            <a
                              href={`https://explorer.solana.com/tx/${signature}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-500 hover:text-blue-600"
                            >
                              Check status in Explorer
                            </a>
                          </div>
                        </div>
                      ),
                    })
                    return
                  }
                  await new Promise(resolve => setTimeout(resolve, 2000))
                  continue
                }
                throw new Error(error.error || 'Failed to confirm transaction')
              }

              confirmed = true
              break
            } catch (error) {
              if (i === 2) throw error
              await new Promise(resolve => setTimeout(resolve, 2000))
            }
          }

          if (confirmed) {
            await logActivity({
              category: "trade",
              level: "info",
              action: "trade_complete",
              details: {
                type: action,
                symbol,
                amount: Number.parseFloat(amount),
                price,
                signature,
              },
              wallet_address: walletAddress,
            })

            toast.success(`${action.toUpperCase()} order completed!`, {
              id: toastId,
              description: (
                <div className="mt-2 text-xs font-mono break-all">
                  <div>Amount: {amount} {action === "buy" ? symbol : "SWARMS"}</div>
                  <div>Price: ${price.toFixed(6)}</div>
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
          }
        } catch (signError: any) {
          // Handle user rejection or signing errors specifically
          if (signError.message?.includes('User rejected')) {
            toast.error("Transaction cancelled by user", { id: toastId })
          } else {
            throw signError
          }
        }

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
      const toastId = toast.loading("Checking pool creation requirements...")

      try {
        // Get the cost estimate first
        const response = await fetch('/api/solana/create-pool', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userPublicKey: walletAddress,
            tokenMint: mintAddress,
            swarmsAmount: 0,
            createPool: false
          }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to get pool creation cost')
        }

        const result = await response.json()
        
        // Show cost estimation to user
        if (!result.readyToProceed) {
          toast.error("Insufficient SOL in bonding curve account", {
            id: toastId,
            duration: 8000,
            description: (
              <div className="mt-2 text-xs space-y-2">
                <p>The bonding curve account needs more SOL to create the pool:</p>
                <div className="font-mono">
                  <div>Required: {result.estimatedFeeSol.toFixed(6)} SOL</div>
                  <div>Recommended (with buffer): {result.recommendedSol.toFixed(6)} SOL</div>
                  <div>Current Balance: {result.currentBondingCurveBalance.toFixed(6)} SOL</div>
                  <div>Need to send: {result.additionalSolNeeded.toFixed(6)} SOL</div>
                </div>
                <p>Send SOL to:</p>
                <div className="font-mono break-all">{result.bondingCurveAddress}</div>
                <div className="pt-2">
                  <Button
                    onClick={async () => {
                      try {
                        // @ts-ignore - Phantom wallet type
                        const provider = window?.phantom?.solana
                        if (!provider) {
                          throw new Error("Phantom wallet not found")
                        }

                        // Check if wallet is connected
                        if (!provider.isConnected) {
                          await provider.connect();
                        }

                        const transferAmount = Math.ceil(result.additionalSolNeeded * LAMPORTS_PER_SOL)
                        
                        // Get transfer transaction from server
                        const transferResponse = await fetch('/api/solana/create-pool', {
                          method: 'PATCH',
                          headers: {
                            'Content-Type': 'application/json',
                          },
                          body: JSON.stringify({
                            userPublicKey: walletAddress,
                            bondingCurveAddress: result.bondingCurveAddress,
                            amount: transferAmount
                          }),
                        });

                        if (!transferResponse.ok) {
                          const error = await transferResponse.json();
                          throw new Error(error.error || 'Failed to create transfer transaction');
                        }

                        const { transaction: serializedTransaction } = await transferResponse.json();
                        const transaction = Transaction.from(Buffer.from(serializedTransaction, 'base64'));

                        toast.loading("Please approve the transfer in your wallet...", { id: toastId });

                        try {
                          // Let Phantom handle the transaction sending
                          const { signature } = await provider.signAndSendTransaction(transaction);
                          
                          toast.loading("Confirming transfer...", { id: toastId });
                          
                          // Show explorer link immediately after sending
                          toast.message("Transaction sent", {
                            duration: 0, // Keep until we confirm
                            description: (
                              <div className="mt-2 text-xs font-mono break-all">
                                <div>Amount: {(transferAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL</div>
                                <div>
                                  <a
                                    href={`https://explorer.solana.com/tx/${signature}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-500 hover:text-blue-600"
                                  >
                                    View in Explorer
                                  </a>
                                </div>
                              </div>
                            ),
                          });

                          // Wait for confirmation using our server endpoint
                          let confirmed = false;
                          for (let i = 0; i < 3; i++) {
                            try {
                              const confirmResponse = await fetch('/api/solana/confirm-transaction', {
                                method: 'POST',
                                headers: {
                                  'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({ signature })
                              });

                              if (!confirmResponse.ok) {
                                const error = await confirmResponse.json();
                                // If it's still processing, retry
                                if (error.error?.includes('Please check the transaction status manually')) {
                                  if (i === 2) {
                                    // On last attempt, show pending message
                                    toast.info("Transfer sent but confirmation pending", {
                                      id: toastId,
                                      duration: 5000,
                                      description: (
                                        <div className="mt-2 text-xs font-mono break-all">
                                          <div>Amount: {(transferAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL</div>
                                          <div>The transfer has been sent but is still processing.</div>
                                          <div>
                                            <a
                                              href={`https://explorer.solana.com/tx/${signature}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-blue-500 hover:text-blue-600"
                                            >
                                              Check status in Explorer
                                            </a>
                                          </div>
                                        </div>
                                      ),
                                    });
                                    return;
                                  }
                                  // Wait longer between retries
                                  await new Promise(resolve => setTimeout(resolve, 2000));
                                  continue;
                                }
                                throw new Error(error.error || 'Failed to confirm transfer');
                              }

                              confirmed = true;
                              break;
                            } catch (error) {
                              if (i === 2) throw error;
                              await new Promise(resolve => setTimeout(resolve, 2000));
                            }
                          }

                          if (confirmed) {
                            toast.success("SOL transferred successfully!", {
                              id: toastId,
                              duration: 5000,
                              description: (
                                <div className="mt-2 text-xs font-mono break-all">
                                  <div>Amount: {(transferAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL</div>
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
                            });

                            // Try pool creation again after a short delay
                            setTimeout(() => {
                              handleCreatePool();
                            }, 2000);
                          }

                        } catch (signError: any) {
                          // Handle user rejection or signing errors specifically
                          if (signError.message?.includes('User rejected')) {
                            toast.error("Transfer cancelled by user", { id: toastId });
                          } else {
                            throw signError;
                          }
                        }

                      } catch (error) {
                        console.error('Transfer failed:', error);
                        toast.error(
                          error instanceof Error ? error.message : "Failed to transfer SOL",
                          { id: toastId }
                        );
                      }
                    }}
                    size="sm"
                    className="w-full bg-red-600 hover:bg-red-700"
                  >
                    Transfer {result.additionalSolNeeded.toFixed(6)} SOL
                  </Button>
                </div>
              </div>
            )
          })
          return
        }

        // If we have enough balance, proceed with pool creation
        toast.loading("Creating pool...", { id: toastId })

        // Call create-pool API to create the pool
        const createResponse = await fetch('/api/solana/create-pool', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userPublicKey: walletAddress,
            tokenMint: mintAddress,
            swarmsAmount: 0,
            createPool: true  // Actually create the pool
          }),
        })

        if (!createResponse.ok) {
          const error = await createResponse.json()
          throw new Error(error.error || 'Failed to create pool')
        }

        const { signature, poolAddress, message } = await createResponse.json()

        // Initialize the pool immediately
        if (poolAddress && meteoraService) {
          try {
            const poolPublicKey = new PublicKey(poolAddress)
            const newPool = await meteoraService.getPool(poolPublicKey)
            if (newPool) {
              setPool(newPool)
              setCurrentPoolAddress(poolAddress)
            }
          } catch (error) {
            console.error("Failed to initialize new pool:", error)
          }
        }

        toast.success(message, {
          id: toastId,
          description: (
            <div className="mt-2 text-xs font-mono break-all">
              <div>Token: {symbol}</div>
              {poolAddress && <div>Pool: {poolAddress}</div>}
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
        });

        // No need to reload the page, just update the UI
        setCurrentPoolAddress(poolAddress)

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
        {!currentPoolAddress ? (
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

