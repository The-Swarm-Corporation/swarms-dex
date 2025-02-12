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
import { Loader2, Info } from "lucide-react"
import { logActivity } from "@/lib/supabase/logging"
import { MAX_SLIPPAGE_PERCENT } from "@/lib/meteora/constants"
import { ComputeBudgetProgram } from "@solana/web3.js"
import { Transaction, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { getAssociatedTokenAddress } from "@solana/spl-token"
import ReactConfetti from 'react-confetti'

// Add Phantom provider type
type PhantomProvider = {
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey }>;
  disconnect: () => Promise<void>;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
  signMessage: (message: Uint8Array, encoding: string) => Promise<{ signature: Uint8Array; publicKey: PublicKey; }>;
  isConnected: boolean;
  isPhantom?: boolean;
}

interface TokenTradingPanelProps {
  mintAddress: string
  symbol: string
  currentPrice: number
  swapsTokenAddress?: string
  poolAddress?: string
  showCreatePool?: boolean
  bondingCurveAddress?: string
  initialSwarmsAmount?: string
  onTradingStateChange?: (isTrading: boolean) => void
  onPoolCreated?: (poolAddress: string) => void
}

export function TokenTradingPanel({
  mintAddress,
  symbol,
  currentPrice: initialPrice,
  swapsTokenAddress,
  poolAddress: initialPoolAddress,
  showCreatePool = false,
  bondingCurveAddress,
  initialSwarmsAmount = "0",
  onTradingStateChange,
  onPoolCreated
}: TokenTradingPanelProps) {
  const { connection } = useSolana()
  const { user } = useAuth()
  const [amount, setAmount] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [currentPrice, setCurrentPrice] = useState(initialPrice)
  const [estimatedCost, setEstimatedCost] = useState(0)
  const [slippage, setSlippage] = useState(MAX_SLIPPAGE_PERCENT)
  const [gasFee, setGasFee] = useState(0.00005) // Default SOL gas fee
  const [trading, setTrading] = useState<TokenTrading | null>(null)
  const [meteoraService, setMeteoraService] = useState<MeteoraService | null>(null)
  const [pool, setPool] = useState<{ address: PublicKey } | null>(null)
  const [currentPoolAddress, setCurrentPoolAddress] = useState<string | null>(initialPoolAddress || null)
  const [showPoolModal, setShowPoolModal] = useState(false)
  const [additionalSwarms, setAdditionalSwarms] = useState('0')
  const [showConfetti, setShowConfetti] = useState(false)
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0
  })

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

  const handlePoolTrade = async (action: "buy" | "sell") => {
    try {
      if (!user || !amount || !connection || !currentPoolAddress || !swapsTokenAddress) {
        toast.error("Please connect your wallet and enter an amount");
        return;
      }

      setIsLoading(true);
      onTradingStateChange?.(true);
      const toastId = toast.loading("Preparing pool trade...");

      const walletAddress = user.user_metadata?.wallet_address;
      if (!walletAddress) {
        toast.error("Wallet address not found");
        return;
      }

      // @ts-ignore - Phantom wallet type
      const provider = window?.phantom?.solana as PhantomProvider;
      if (!provider?.isPhantom) {
        toast.error("Please install Phantom wallet");
        return;
      }

      const response = await fetch("/api/solana/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          amount: parseFloat(amount),
          action,
          tokenMint: mintAddress,
          swapsTokenAddress,
          poolAddress: currentPoolAddress,
          slippage,
          priorityFee: Math.floor(gasFee * LAMPORTS_PER_SOL)
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        if (error.details) {
          const { balance, required, token, decimals = 6 } = error.details;
          const formattedBalance = (balance / Math.pow(10, decimals)).toFixed(decimals);
          const formattedRequired = (required / Math.pow(10, decimals)).toFixed(decimals);
          
          toast.error(
            `Insufficient ${token} balance. Required: ${formattedRequired}, Available: ${formattedBalance}`
          );
        return;
      }
        throw new Error(error.error || "Failed to create transaction");
      }

      const { transaction: serializedTx } = await response.json();

      // Sign with Phantom wallet
      toast.loading("Please approve the transaction...", { id: toastId });
      const tx = Transaction.from(Buffer.from(serializedTx, "base64"));
      const signedTx = await provider.signTransaction(tx);

      // Send signed transaction and wait for confirmation
      toast.loading("Sending and confirming transaction...", { id: toastId });
      const submitResponse = await fetch("/api/solana/trade", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signedTransaction: signedTx.serialize().toString("base64")
        }),
      });

      if (!submitResponse.ok) {
        throw new Error("Failed to submit transaction");
      }

      const { signature, confirmed } = await submitResponse.json();

      if (!confirmed) {
        throw new Error("Transaction failed to confirm");
      }

      // Handle success without triggering refresh
      requestAnimationFrame(() => {
        toast.success(
          <div>
            Pool trade successful!{" "}
            <a
              href={`https://solscan.io/tx/${signature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              View on Solscan
            </a>
          </div>,
          { id: toastId }
        );

        setAmount("");
        setShowConfetti(true);
        
        // Delay turning off trading state to allow confetti to show
        setTimeout(() => {
          setIsLoading(false);
          onTradingStateChange?.(false);
          setTimeout(() => setShowConfetti(false), 5000);
        }, 1000);
      });
      
    } catch (error) {
      console.error("Pool trade failed:", error);
      toast.error(error instanceof Error ? error.message : "Trade failed");
      setIsLoading(false);
      onTradingStateChange?.(false);
    }
  };

  const handleBondingCurveSwap = async (action: "buy" | "sell") => {
    try {
      if (!user || !amount || !connection || !bondingCurveAddress) {
        toast.error("Please connect your wallet and enter an amount");
        return;
      }

      setIsLoading(true);
      onTradingStateChange?.(true);
      const toastId = toast.loading("Preparing bonding curve swap...");

      const walletAddress = user.user_metadata?.wallet_address;
      if (!walletAddress) {
        toast.error("Wallet address not found");
        return;
      }

      // @ts-ignore - Phantom wallet type
      const provider = window?.phantom?.solana as PhantomProvider;
      if (!provider?.isPhantom) {
        toast.error("Please install Phantom wallet");
        return;
      }

      // Get user's token accounts
      const userTokenAccount = await getAssociatedTokenAddress(
        new PublicKey(mintAddress),
        new PublicKey(walletAddress)
      );

      const userSwarmsAccount = await getAssociatedTokenAddress(
        new PublicKey(swapsTokenAddress!),
        new PublicKey(walletAddress)
      );

      // Create transfer transaction
      const response = await fetch('/api/solana/transfer-swarms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          swarmsAmount: amount,
          fromAccount: action === "buy" ? userSwarmsAccount.toString() : userTokenAccount.toString(),
          toAccount: bondingCurveAddress
        })
      });

      if (!response.ok) {
        const error = await response.json();
        if (error.details) {
          const { balance, required, token, decimals = 6 } = error.details;
          const formattedBalance = (balance / Math.pow(10, decimals)).toFixed(decimals);
          const formattedRequired = (required / Math.pow(10, decimals)).toFixed(decimals);
          
          toast.error(
            `Insufficient ${token} balance. Required: ${formattedRequired}, Available: ${formattedBalance}`
          );
          return;
        }
        throw new Error(error.error || "Failed to create transaction");
      }

      const { transaction: serializedTx } = await response.json();

      // Sign with Phantom wallet
      const tx = Transaction.from(Buffer.from(serializedTx, "base64"));
      const signedTx = await provider.signTransaction(tx);

      // Send signed transaction
      const submitResponse = await fetch('/api/solana/transfer-swarms', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signedTransaction: signedTx.serialize().toString("base64")
        })
      });

      if (!submitResponse.ok) {
        throw new Error("Failed to submit transaction");
      }

      const { signature } = await submitResponse.json();

      // Handle success without triggering refresh
      requestAnimationFrame(() => {
        toast.success(
          <div>
            Bonding curve swap successful!{" "}
            <a
              href={`https://solscan.io/tx/${signature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              View on Solscan
            </a>
          </div>,
          { id: toastId }
        );

        setAmount("");
        setShowConfetti(true);
        
        // Delay turning off trading state to allow confetti to show
        setTimeout(() => {
          setIsLoading(false);
          onTradingStateChange?.(false);
          setTimeout(() => setShowConfetti(false), 5000);
        }, 1000);
      });

    } catch (error) {
      console.error("Bonding curve swap failed:", error);
      toast.error(error instanceof Error ? error.message : "Swap failed");
      setIsLoading(false);
      onTradingStateChange?.(false);
    }
  };

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

      onTradingStateChange?.(true);
      setIsLoading(true)
      const toastId = toast.loading("Initializing pool creation...")

      try {
        // Add robust wallet detection with retries
        let provider: PhantomProvider | null = null;
        let retries = 0;
        const maxRetries = 5;

        while (retries < maxRetries) {
          provider = window?.phantom?.solana as PhantomProvider;

          if (provider?.isPhantom) {
            try {
              const connected = await provider.connect({ onlyIfTrusted: true });
              if (connected) break;
            } catch (e) {
              console.warn('Auto-connect failed, will try manual connect:', e);
            }
          }
          
          if (retries === maxRetries - 1) {
            try {
              provider = window?.phantom?.solana as PhantomProvider;
              if (provider?.isPhantom) {
                await provider.connect();
                break;
              }
              throw new Error('Phantom wallet not found');
            } catch (e) {
              toast.error("Please install Phantom wallet or check if it's properly connected");
              return;
            }
          }
          
          retries++;
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        if (!provider?.isConnected) {
          toast.error("Please connect your Phantom wallet")
          return
        }

        // Handle SWARMS deposit first if specified
        if (additionalSwarms && Number(additionalSwarms) > 0) {
          toast.loading("Processing SWARMS deposit...", { id: toastId });
          
          // Get user's SWARMS token account
          const userSwarmsAccount = await getAssociatedTokenAddress(
            new PublicKey(swapsTokenAddress!),
            new PublicKey(walletAddress)
          );

          // Create transfer transaction
          const response = await fetch('/api/solana/transfer-swarms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              walletAddress,
              swarmsAmount: additionalSwarms,
              fromAccount: userSwarmsAccount.toString(),
              toAccount: bondingCurveAddress,
              isBondingCurveDeposit: true,
              currentSwarmsAmount: initialSwarmsAmount,
              symbol,
              mintAddress
            })
          });

          if (!response.ok) {
            const error = await response.json();
            if (error.details) {
              // Handle insufficient balance error with details
              const { required, balance, token, decimals: tokenDecimals = 6 } = error.details;
              toast.error("Insufficient SWARMS balance", {
                description: (
                  <div className="mt-2 text-xs font-mono">
                    <div>Required: {(Number(required) / Math.pow(10, tokenDecimals)).toFixed(6)} {token}</div>
                    <div>Available: {(Number(balance) / Math.pow(10, tokenDecimals)).toFixed(6)} {token}</div>
                  </div>
                )
              });
              return;
            }
            throw new Error(error.error || 'Failed to create SWARMS transfer');
          }

          const { transaction: serializedTx } = await response.json();
          toast.loading("Please approve SWARMS transfer...", { id: toastId });

          const tx = Transaction.from(Buffer.from(serializedTx, 'base64'));
          const signedTx = await provider.signTransaction(tx);
          
          // Send signed transaction
          const submitResponse = await fetch('/api/solana/transfer-swarms', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              signedTransaction: signedTx.serialize().toString('base64')
            })
          });

          if (!submitResponse.ok) {
            throw new Error('Failed to submit SWARMS transfer');
          }

          const { signature } = await submitResponse.json();

          // Wait for confirmation
          toast.loading("Confirming SWARMS transfer...", { id: toastId });
          
          const confirmResponse = await fetch('/api/solana/confirm-transaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ signature })
          });

          if (!confirmResponse.ok) {
            throw new Error('Failed to confirm SWARMS transfer');
          }
        
          toast.success("SWARMS transfer complete", {
            id: toastId,
            description: (
              <div className="mt-2 text-xs font-mono">
                <div>Transferred {additionalSwarms} SWARMS</div>
                <div>
                  <a
                    href={`https://solscan.io/tx/${signature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:text-blue-600"
                  >
                    View transaction
                  </a>
                </div>
              </div>
            )
          });

          // Short delay before proceeding to pool creation
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Proceed with pool creation
        toast.loading("Creating liquidity pool...", { id: toastId });

        const poolResponse = await fetch('/api/solana/create-pool', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userPublicKey: walletAddress,
            tokenMint: mintAddress
          })
        });

        const poolData = await poolResponse.json();

        // If pool creation succeeded immediately
        if (poolResponse.ok) {
          const { signature, poolAddress, details } = poolData;

          toast.success("Pool created successfully!", {
            id: toastId,
            description: (
              <div className="mt-2 text-xs font-mono break-all">
                <div>Pool Address: {poolAddress}</div>
                <div>
                  <a
                    href={`https://solscan.io/tx/${signature}`}
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

          // Log successful pool creation
          await logActivity({
            category: "trade",
            level: "info",
            action: "pool_created",
            details: {
              symbol,
              poolAddress,
              signature,
              additionalSwarms: Number(additionalSwarms) > 0 ? additionalSwarms : undefined,
              ...details
            },
            wallet_address: walletAddress,
          });

          // Update local state
          setCurrentPoolAddress(poolAddress);
          setPool({ address: new PublicKey(poolAddress) });
          setAdditionalSwarms('0');
          setAmount('');
          setShowPoolModal(false);
          
          // Notify parent component
          onPoolCreated?.(poolAddress);
          setShowConfetti(true);
          
          // Delay turning off trading state to allow confetti to show
          setTimeout(() => {
            setIsLoading(false);
            onTradingStateChange?.(false);
            setTimeout(() => setShowConfetti(false), 5000);
          }, 1000);
          return;
        }

        // Check for insufficient SOL error
        if (poolResponse.status === 402) {
          const { details, transaction: fundingTx } = poolData;
          if (!details || !fundingTx) {
            throw new Error('Failed to get funding transaction');
          }
          
          const {
            currentBalance,
            requiredBalance,
            neededAmount,
            breakdown
          } = details;

          // Add extra SOL for the transfer transaction itself
          const transferGasFee = 0.00005; // Base gas fee for transfer
          const totalNeeded = neededAmount + transferGasFee;

          toast.loading(
            <div className="space-y-2">
              <div>Additional SOL needed for pool creation:</div>
              <div className="text-xs font-mono bg-black/20 p-2 rounded space-y-1">
                <div>Current: {currentBalance.toFixed(6)} SOL</div>
                <div>Required: {requiredBalance.toFixed(6)} SOL</div>
                <div>Needed: {totalNeeded.toFixed(6)} SOL</div>
                <div className="text-gray-400">Breakdown:</div>
                <div className="pl-2">
                  <div>• Network Fee: {breakdown.estimatedFee.toFixed(6)} SOL</div>
                  <div>• Rent: {breakdown.rentExempt.toFixed(6)} SOL</div>
                </div>
              </div>
            </div>,
            { id: toastId, duration: 10000 }
          );

          // Sign the prepared transaction
          const tx = Transaction.from(Buffer.from(fundingTx, 'base64'));
          
          try {
            const signedTx = await provider.signTransaction(tx);

            // Submit the signed transaction
            const submitResponse = await fetch('/api/solana/create-pool', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                signedTransaction: signedTx.serialize().toString('base64')
              })
            });

            if (!submitResponse.ok) {
              throw new Error('Failed to submit SOL transfer');
            }

            const { signature } = await submitResponse.json();

            // Wait for confirmation
            const confirmResponse = await fetch('/api/solana/confirm-transaction', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ signature })
            });

            if (!confirmResponse.ok) {
              throw new Error('Failed to confirm SOL transfer');
            }

            toast.success("SOL transfer complete", {
              id: toastId,
              description: (
                <div className="mt-2 text-xs font-mono">
                  <div>Transferred {totalNeeded.toFixed(6)} SOL</div>
                  <div>
                    <a
                      href={`https://solscan.io/tx/${signature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:text-blue-600"
                    >
                      View transaction
                    </a>
                  </div>
                </div>
              )
            });

            // Wait a bit for the transaction to settle
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Retry pool creation
            handleCreatePool();
            return;
          } catch (error) {
            if (error instanceof Error && error.message.includes('User rejected')) {
              toast.error("SOL transfer rejected", { id: toastId });
              return;
            }
            throw error;
          }
        }

        throw new Error(poolData.error || 'Failed to create pool');
      } catch (error) {
        console.error('Pool creation failed:', error);
        toast.error(error instanceof Error ? error.message : "Failed to create pool");
        
        // Log the error
        await logActivity({
          category: "trade",
          level: "error",
          action: "pool_creation_failed",
          details: {
            symbol,
            error: error instanceof Error ? error.message : "Unknown error",
            additionalSwarms: Number(additionalSwarms) > 0 ? additionalSwarms : undefined
          },
          wallet_address: walletAddress,
        });
      }
    } finally {
      setIsLoading(false);
      onTradingStateChange?.(false);
      setShowPoolModal(false);
    }
  };

  const handleButtonClick = async (action: "buy" | "sell", e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isLoading) {
      try {
        await handlePoolTrade(action);
      } catch (error) {
        // Handle error if needed
      }
    }
    return false;
  };

  // Prevent form submission at the form level too
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  };

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight
      })
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div className="relative">
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
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      return false;
                    }} 
                    className="space-y-4" 
                    noValidate
                  >
                    <div className="pt-4">
                        <Label>Additional SWARMS (Optional)</Label>
                        <Input
                          type="number"
                          placeholder="Enter additional SWARMS amount"
                          value={additionalSwarms}
                          onChange={(e) => setAdditionalSwarms(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              e.stopPropagation();
                              return false;
                            }
                          }}
                          className="bg-black/50 border-red-600/20 focus:border-red-600 mt-2"
                        />
                        <div className="text-xs text-gray-400 space-y-1 mt-2">
                          <div>Current SWARMS in bonding curve: {initialSwarmsAmount}</div>
                          {additionalSwarms !== '0' && (
                            <div className="bg-black/20 p-2 rounded">
                              <div>+ {additionalSwarms} SWARMS (new deposit)</div>
                              <div>= {Number(initialSwarmsAmount) + Number(additionalSwarms)} SWARMS total</div>
                            </div>
                          )}
                        </div>
                      <Button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleCreatePool();
                          return false;
                        }}
                        disabled={isLoading}
                        className="w-full mt-4 bg-red-600 hover:bg-red-700"
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {additionalSwarms !== '0' ? 'Depositing SWARMS & Creating Pool...' : 'Creating Pool...'}
                          </>
                        ) : (
                          additionalSwarms !== '0' ? 'Deposit SWARMS & Create Pool' : 'Create Pool'
                        )}
                      </Button>
                    </div>
                  </form>
                </>
              ) : (
                <p className="text-sm text-gray-400">No liquidity pool has been established for this token yet. Trading will be enabled once the token creator creates a pool.</p>
              )}
            </div>
          ) : (
            <form 
              onSubmit={handleFormSubmit}
              className="w-full"
              noValidate
            >
              <Tabs defaultValue="buy" onValueChange={() => setAmount("")}>
                <TabsList className="grid w-full grid-cols-2 bg-black/50">
                  <TabsTrigger 
                    type="button"
                    value="buy" 
                    className="data-[state=active]:bg-red-600"
                    onClick={(e) => e.preventDefault()}
                  >
                    Buy
                  </TabsTrigger>
                  <TabsTrigger 
                    type="button"
                    value="sell" 
                    className="data-[state=active]:bg-gray-600"
                    onClick={(e) => e.preventDefault()}
                  >
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
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                          }
                        }}
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
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  return false;
                                }
                              }}
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
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  return false;
                                }
                              }}
                              className="w-24 h-6 text-xs bg-black/50 border-red-600/20 focus:border-red-600"
                              min="0.000005"
                              step="0.000001"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      className="w-full bg-red-600 hover:bg-red-700"
                      onClick={(e) => handleButtonClick("buy", e)}
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
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            return false;
                          }
                        }}
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
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  return false;
                                }
                              }}
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
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  return false;
                                }
                              }}
                              className="w-24 h-6 text-xs bg-black/50 border-red-600/20 focus:border-red-600"
                              min="0.000005"
                              step="0.000001"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      className="w-full bg-gray-600 hover:bg-gray-700"
                      onClick={(e) => handleButtonClick("sell", e)}
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
            </form>
          )}
        </CardContent>
      </Card>
      {showConfetti && (
        <ReactConfetti
          width={windowSize.width}
          height={windowSize.height}
          recycle={false}
          numberOfPieces={500}
          gravity={0.3}
          colors={['#ef4444', '#dc2626', '#b91c1c', '#7f1d1d', '#fbbf24']}
          style={{ position: 'fixed', top: 0, left: 0, zIndex: 100, pointerEvents: 'none' }}
        />
      )}
    </div>
  )
}