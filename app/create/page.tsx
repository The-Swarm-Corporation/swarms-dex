"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { logger } from "@/lib/logger"
import { useSolana } from "@/hooks/use-solana"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle, ImageIcon, Loader2 } from "lucide-react"
import { logActivity } from "@/lib/supabase/logging"
import { useAuth } from "@/components/providers/auth-provider"
import { useRouter } from "next/navigation"
import { PublicKey, Transaction } from "@solana/web3.js"
import { useWallet } from '@solana/wallet-adapter-react'

interface FormData {
  name: string
  description: string
  tokenSymbol: string
  twitter: string
  telegram: string
  discord: string
  swarmsAmount: string
  image?: File
  priorityFee: string
}

const initialFormData: FormData = {
  name: "",
  description: "",
  tokenSymbol: "",
  twitter: "",
  telegram: "",
  discord: "",
  swarmsAmount: "10",
  priorityFee: "50000"
}

interface FormError {
  message: string
  fields?: Record<string, string>
}

const SWARMS_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS as string
const SWARMS_PUMP_ADDRESS = process.env.NEXT_PUBLIC_SWARMS_PLATFORM_TEST_ADDRESS as string
const SWARMS_MINIMUM_BUY_IN = 1
export default function CreateAgent() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { connection } = useSolana()
  const { publicKey, signTransaction, connected } = useWallet()
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState<FormData>(initialFormData)
  const [error, setError] = useState<FormError | null>(null)
  const [mounted, setMounted] = useState(false)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [tokenCreated, setTokenCreated] = useState(false)
  const [tokenMint, setTokenMint] = useState<string>('')
  const [bondingCurveAddress, setBondingCurveAddress] = useState<string>('')
  const [showPoolModal, setShowPoolModal] = useState(false)
  const [poolSwarmsAmount, setPoolSwarmsAmount] = useState('')

  useEffect(() => {
    setMounted(true)
  }, [])

  // Check auth state and redirect if needed
  useEffect(() => {
    if (!mounted || authLoading) return

    // If auth is loaded and no user, redirect
    if (!user) {
      router.replace('/')
      toast.error("Please connect your wallet to create an agent")
    }
  }, [mounted, authLoading, user, router])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }))
    // Clear field-specific error when user starts typing
    if (error?.fields?.[name]) {
      setError((prev) =>
        prev
          ? {
              ...prev,
              fields: {
                ...prev.fields,
                [name]: "",
              },
            }
          : null,
      )
    }
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setError(prev => ({
          message: "Invalid file type",
          fields: { ...prev?.fields, image: "Please upload an image file" }
        }))
        return
      }
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError(prev => ({
          message: "File too large",
          fields: { ...prev?.fields, image: "Image must be less than 5MB" }
        }))
        return
      }

      // Create preview URL
      const previewUrl = URL.createObjectURL(file)
      setImagePreview(previewUrl)
      
      setFormData(prev => ({ ...prev, image: file }))
      // Clear error if exists
      if (error?.fields?.image) {
        setError(prev => prev ? {
          ...prev,
          fields: { ...prev.fields, image: "" }
        } : null)
      }
    }
  }

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {}

    if (!formData.name.trim()) {
      errors.name = "Name is required"
    }

    if (!formData.description.trim()) {
      errors.description = "Description is required"
    }

    if (!formData.tokenSymbol.trim()) {
      errors.tokenSymbol = "Token symbol is required"
    } else if (!/^[A-Z0-9]{2,10}$/.test(formData.tokenSymbol)) {
      errors.tokenSymbol = "Token symbol must be 2-10 uppercase letters/numbers"
    }

    if (!formData.image) {
      errors.image = "Agent image is required"
    }

    const swarmsAmount = Number(formData.swarmsAmount)
    if (isNaN(swarmsAmount)) {
      errors.swarmsAmount = "Please enter a valid number"
    } else if (swarmsAmount < SWARMS_MINIMUM_BUY_IN) {
      errors.swarmsAmount = `Minimum ${SWARMS_MINIMUM_BUY_IN.toLocaleString()} SWARMS required`
    }

    if (Object.keys(errors).length > 0) {
      setError({ message: "Please fix the following errors:", fields: errors })
      return false
    }

    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!mounted || !connection) {
      setError({ message: "Please wait for connection to initialize" })
      return
    }

    if (!user?.user_metadata?.wallet_address) {
      toast.error("Please connect your wallet first")
      return
    }

    const walletAddress = user.user_metadata.wallet_address

    if (!connected || !publicKey || !signTransaction) {
      toast.error("Please connect your wallet")
      return
    }

    // Verify the connected wallet matches the authenticated wallet
    if (publicKey.toString() !== walletAddress) {
      toast.error("Connected wallet does not match authenticated wallet. Please connect the correct wallet.")
      return
    }

    if (!validateForm()) {
      return
    }

    const toastId = toast.loading("Preparing token creation...")

    try {
      setIsLoading(true)
      logger.info("Starting token creation process", {
        name: formData.name,
        symbol: formData.tokenSymbol,
        wallet: walletAddress
      })

      // Check balances through our API
      const balanceResponse = await fetch('/api/solana/check-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: publicKey.toString()
        })
      })

      if (!balanceResponse.ok) {
        const error = await balanceResponse.json()
        throw new Error(error.error || 'Failed to check balances')
      }

      const { sol, swarms } = await balanceResponse.json()
      console.log("Balances:", { sol, swarms })

      // Verify minimum SOL
      if (sol < 0.05) {
        throw new Error(`Insufficient SOL balance. You need at least 0.05 SOL (current: ${sol.toFixed(4)} SOL)`)
      }

      // Call the mint-token API with form data and image
      const mintFormData = new FormData()
      mintFormData.append('image', formData.image!)
      mintFormData.append('data', JSON.stringify({
        userPublicKey: publicKey.toString(),
        tokenName: formData.name,
        tickerSymbol: formData.tokenSymbol,
        description: formData.description,
        twitterHandle: formData.twitter || null,
        telegramGroup: formData.telegram || null,
        discordServer: formData.discord || null,
        swarmsAmount: formData.swarmsAmount
      }))

      // Get token creation transaction
      const response = await fetch('/api/solana/mint-token', {
        method: 'POST',
        body: mintFormData
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create token')
      }

      const { 
        tokenCreationTx, 
        tokenMint, 
        bondingCurveAddress, 
        imageUrl
      } = await response.json()

      try {
        // Show simpler transaction preview
        const previewToastId = toast.message(
          <div className="space-y-4">
            <div className="font-semibold">Transaction Preview</div>
            
            <div className="space-y-2 text-xs">
              <div className="font-semibold">Token Details</div>
              <div className="bg-black/20 p-2 rounded space-y-1">
                <div>Name: {formData.name}</div>
                <div>Symbol: {formData.tokenSymbol}</div>
                <div>SWARMS Amount: {formData.swarmsAmount}</div>
              </div>
            </div>

            <div className="pt-4 space-y-2">
              <Button
                onClick={async () => {
                  toast.dismiss(previewToastId);
                  toast.loading("Please sign the transaction in your wallet...", { id: toastId });

                  // Sign token creation transaction
                  const tokenTx = Transaction.from(Buffer.from(tokenCreationTx, 'base64'));
                  
                  // Log signature verification
                  console.log('Transaction signers before user:', {
                    feePayer: tokenTx.feePayer?.toBase58(),
                    signatures: tokenTx.signatures.map(s => ({
                      publicKey: s.publicKey.toBase58(),
                      signature: s.signature ? 'signed' : 'unsigned'
                    }))
                  });

                  try {
                    // Sign with the user's wallet using wallet adapter
                    const signedTokenTx = await signTransaction(tokenTx);

                    // Send signed transaction through backend
                    const confirmResponse = await fetch('/api/solana/mint-token', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        signedTokenTx: signedTokenTx.serialize().toString('base64'),
                        tokenMint,
                        bondingCurveAddress,
                        userPublicKey: publicKey.toString(),
                        tokenName: formData.name,
                        tickerSymbol: formData.tokenSymbol,
                        description: formData.description,
                        twitterHandle: formData.twitter || null,
                        telegramGroup: formData.telegram || null,
                        discordServer: formData.discord || null,
                        imageUrl
                      })
                    });

                    if (!confirmResponse.ok) {
                      const error = await confirmResponse.json();
                      throw new Error(error.error || 'Failed to create token');
                    }

                    const { signature: tokenSignature } = await confirmResponse.json()

                    logger.info("Token creation completed", {
                      signature: tokenSignature,
                      mint: tokenMint
                    })
            
                    // Automatically create pool
                    toast.loading("Creating liquidity pool...", { id: toastId })
            
                    try {
                      // First check if we have enough SOL for pool creation
                      const poolSimResponse = await fetch('/api/solana/create-pool', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          tokenMint,
                          userPublicKey: publicKey.toString(),
                          createPool: false // Just simulate first
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
                          `Pool creation needs ${simResult.recommendedSol.toFixed(4)} SOL. Please send SOL to your bonding curve account and try again from your agent page.`, 
                          { id: toastId, duration: 8000 }
                        );
                        // Show bonding curve address for easy copy
                        toast.info(
                          <div className="mt-2 text-xs font-mono break-all">
                            <div>Bonding Curve Address:</div>
                            <div>{bondingCurveAddress}</div>
                          </div>,
                          { duration: 15000 }
                        );
                        router.push(`/agent/${tokenMint}`);
                        return;
                      }
            
                      // If we have enough SOL, proceed with pool creation
                      const poolResponse = await fetch('/api/solana/create-pool', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          tokenMint,
                          userPublicKey: publicKey.toString(),
                          createPool: true
                        })
                      });
            
                      if (!poolResponse.ok) {
                        const error = await poolResponse.json();
                        throw new Error(error.error || 'Failed to create pool');
                      }
            
                      const { signature: poolSignature, poolAddress } = await poolResponse.json();
            
                      toast.success("Agent created successfully!", { 
                        id: toastId,
                        duration: 5000,
                        description: (
                          <div className="mt-2 text-xs font-mono break-all">
                            <div>Token: {formData.tokenSymbol}</div>
                            <div>Pool: {poolAddress}</div>
                            <div>
                              <a
                                href={`https://explorer.solana.com/tx/${poolSignature}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:text-blue-600"
                              >
                                View Pool Creation
                              </a>
                            </div>
                          </div>
                        ),
                      });
            
                      router.push(`/agent/${tokenMint}`);
                                
                  } catch (error) {
                    logger.error("Pool creation failed", error as Error);
                    toast.error(
                      "Token created", 
                      { id: toastId, duration: 8000 }
                    );
                    // Show bonding curve address for easy copy
                    toast.info(
                      <div className="mt-2 text-xs font-mono break-all">
                        <div>Bonding Curve Address:</div>
                        <div>{bondingCurveAddress}</div>
                      </div>,
                      { duration: 15000 }
                    );
                    router.push(`/agent/${tokenMint}`);
                  }
                  } catch (error) {
                    if (error instanceof Error && error.message.includes('User rejected')) {
                      toast.error("Transaction was rejected by user", { id: toastId });
                    } else {
                      toast.error("Failed to create token", { id: toastId });
                      logger.error("Token creation failed", error as Error);
                    }
                    throw error;
                  }
                }}
                className="w-full bg-red-600 hover:bg-red-700"
              >
                Proceed with Token Creation
              </Button>
              <Button
                onClick={() => {
                  toast.dismiss(previewToastId);
                  toast.error("Token creation cancelled", { id: toastId });
                }}
                variant="outline"
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          </div>,
          {
            duration: Infinity,
            className: "w-[400px]"
          }
        );

      } catch (error) {
        if (error instanceof Error && error.message.includes('User rejected')) {
          toast.error("Transaction was rejected by user", { id: toastId })
        } else {
          toast.error("Failed to create token", { id: toastId })
          logger.error("Token creation failed", error as Error)
        }
        throw error;
      }

    } catch (error) {
      logger.error("Token creation failed", error as Error)
      
      if (user?.user_metadata?.wallet_address) {
        await logActivity({
          category: "token",
          level: "error",
          action: "token_creation_failed",
          details: {
            name: formData.name,
            symbol: formData.tokenSymbol,
            error: error instanceof Error ? error.message : "Unknown error"
          },
          error_message: error instanceof Error ? error.message : "Unknown error",
          wallet_address: user.user_metadata.wallet_address
        })
      }

      toast.error(error instanceof Error ? error.message : "Failed to create token", { id: toastId })
    } finally {
      setIsLoading(false)
    }
  }

  // Don't render until auth is loaded and we have a user
  if (!mounted || authLoading) return null
  if (!user) return null

  return (
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-4xl font-bold text-red-600">Create AI Agent</h1>
          <p className="text-gray-200 mt-2">Launch your own AI agent with Swarms token backing</p>
          <div className="mt-4 p-4 bg-black/20 rounded-lg border border-red-500/20">
            <h3 className="text-sm font-semibold text-red-500">Requirements</h3>
            <ul className="mt-2 text-sm text-gray-200 space-y-1">
              <li>• Minimum {SWARMS_MINIMUM_BUY_IN.toLocaleString()} SWARMS tokens required</li>
              <li>• Minimum 0.05 SOL for transaction fees</li>
              <li>• Connected Phantom wallet</li>
            </ul>
            <p className="mt-4 text-sm text-gray-200">
              Your token allocation will be determined by the amount of SWARMS tokens you provide and our bonding curve formula.
              The more SWARMS you provide, the more tokens you'll receive from the 1 billion total supply.
            </p>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription className="text-gray-200">
              {error.message}
              {error.fields && (
                <ul className="mt-2 list-disc list-inside">
                  {Object.entries(error.fields).map(
                    ([field, message]) =>
                      message && (
                        <li key={field} className="text-sm">
                          {message}
                        </li>
                      ),
                  )}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="image" className="text-gray-200">Agent Image *</Label>
            <div className="flex items-center gap-4">
              <div className="relative w-32 h-32 border-2 border-dashed border-red-600/20 rounded-lg overflow-hidden">
                {imagePreview ? (
                  <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <ImageIcon className="w-8 h-8 text-gray-400" />
                  </div>
                )}
                <input
                  type="file"
                  id="image"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </div>
              <div className="flex-1">
                <p className="text-sm text-gray-200">Upload your agent's image (max 5MB)</p>
                {error?.fields?.image && (
                  <p className="text-sm text-red-500 mt-1">{error.fields.image}</p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name" className="text-gray-200">Agent Name *</Label>
            <Input
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="CyberMind"
              required
              className={`bg-black/50 border-red-600/20 focus:border-red-600 text-gray-200 ${
                error?.fields?.name ? "border-red-500" : ""
              }`}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-gray-200">Description *</Label>
            <Textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Describe your AI agent..."
              required
              className={`bg-black/50 border-red-600/20 focus:border-red-600 min-h-[100px] text-gray-200 ${
                error?.fields?.description ? "border-red-500" : ""
              }`}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="swarmsAmount" className="text-gray-200">Initial SWARMS Amount *</Label>
            <Input
              id="swarmsAmount"
              name="swarmsAmount"
              type="number"
              min={SWARMS_MINIMUM_BUY_IN}
              value={formData.swarmsAmount}
              onChange={handleChange}
              placeholder={`Minimum ${SWARMS_MINIMUM_BUY_IN.toLocaleString()} SWARMS`}
              className={`bg-black/50 border-red-600/20 focus:border-red-600 text-gray-200 ${
                error?.fields?.swarmsAmount ? "border-red-500" : ""
              }`}
            />
            <div className="text-sm text-gray-200 space-y-1">
              <p>• Minimum {SWARMS_MINIMUM_BUY_IN.toLocaleString()} SWARMS required</p>
              <p>• 99% will be used as reserve for the bonding curve</p>
              <p>• 1% goes to the platform fee</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tokenSymbol" className="text-gray-200">Token Symbol *</Label>
            <Input
              id="tokenSymbol"
              name="tokenSymbol"
              value={formData.tokenSymbol}
              onChange={handleChange}
              placeholder="CMIND"
              required
              className={`bg-black/50 border-red-600/20 focus:border-red-600 text-gray-200 ${
                error?.fields?.tokenSymbol ? "border-red-500" : ""
              }`}
            />
            <p className="text-xs text-gray-200">2-10 characters, uppercase letters and numbers only</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="twitter" className="text-gray-200">Twitter Handle</Label>
              <Input
                id="twitter"
                name="twitter"
                value={formData.twitter}
                onChange={handleChange}
                placeholder="@handle"
                className="bg-black/50 border-red-600/20 focus:border-red-600 text-gray-200"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="telegram" className="text-gray-200">Telegram Group</Label>
              <Input
                id="telegram"
                name="telegram"
                value={formData.telegram}
                onChange={handleChange}
                placeholder="group_name"
                className="bg-black/50 border-red-600/20 focus:border-red-600 text-gray-200"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="discord" className="text-gray-200">Discord Server</Label>
            <Input
              id="discord"
              name="discord"
              value={formData.discord}
              onChange={handleChange}
              placeholder="discord.gg/..."
              className="bg-black/50 border-red-600/20 focus:border-red-600 text-gray-200"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="priorityFee" className="text-gray-200">
              Transaction Priority Fee
              <span className="ml-2 text-xs text-gray-400">(Optional)</span>
            </Label>
            <div className="grid grid-cols-2 gap-4">
              <Input
                id="priorityFee"
                name="priorityFee"
                type="number"
                min="0"
                value={formData.priorityFee}
                onChange={handleChange}
                className="bg-black/50 border-red-600/20 focus:border-red-600 text-gray-200"
              />
              <select 
                className="bg-black/50 border border-red-600/20 focus:border-red-600 text-gray-200 rounded-md"
                onChange={(e) => {
                  setFormData(prev => ({
                    ...prev,
                    priorityFee: e.target.value
                  }))
                }}
              >
                <option value="50000">Normal (50k)</option>
                <option value="100000">Fast (100k)</option>
                <option value="500000">Faster (500k)</option>
                <option value="1000000">Fastest (1M)</option>
              </select>
            </div>
            <p className="text-xs text-gray-400">Higher priority = faster processing but costs more SOL. Default: 50,000 microLamports.</p>
          </div>

          <Button
            type="submit"
            disabled={isLoading || !connection}
            className="w-full bg-red-600 hover:bg-red-700 text-white"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Agent"
            )}
          </Button>
        </form>
      </div>
  )
}
