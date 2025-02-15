"use client"

import { Button } from "@/components/ui/button"
import { signInWithWallet, signOut } from "@/lib/auth/wallet"
import { PublicKey } from "@solana/web3.js"
import { Loader2 } from "lucide-react"
import { useAuth } from "./providers/auth-provider"
import { useState } from "react"
import { toast } from "sonner"
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'

require('@solana/wallet-adapter-react-ui/styles.css')

export function WalletButton() {
  const { user, loading } = useAuth()
  const [signing, setSigning] = useState(false)
  const { publicKey, connected, connecting } = useWallet()

  const handleClick = async () => {
    if (signing) return
    
    try {
      setSigning(true)
      
      if (user) {
        await signOut()
        return
      }

      if (!publicKey) {
        toast.error("Please connect your wallet first")
        return
      }

      const success = await signInWithWallet(publicKey)
      
      if (!success) {
        toast.error("Failed to sign in with wallet")
      }
    } catch (error) {
      console.error("Wallet action failed:", error)
      if (error instanceof Error && error.message.includes("User rejected")) {
        toast.error("Wallet connection cancelled")
      } else {
        toast.error("Failed to connect wallet")
      }
    } finally {
      setSigning(false)
    }
  }

  if (loading || connecting) {
    return (
      <Button disabled className="bg-red-600 text-white">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {connecting ? "Connecting..." : "Loading..."}
      </Button>
    )
  }

  if (user) {
    return (
      <Button 
        onClick={handleClick}
        className="bg-red-600 hover:bg-red-700 text-white"
        disabled={signing}
      >
        {signing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Signing Out...
          </>
        ) : (
          user.user_metadata?.wallet_address?.slice(0, 4) + "..." + user.user_metadata?.wallet_address?.slice(-4)
        )}
      </Button>
    )
  }

  if (connected && publicKey && !user) {
    return (
      <Button 
        onClick={handleClick}
        className="bg-red-600 hover:bg-red-700 text-white"
        disabled={signing}
      >
        {signing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Signing In...
          </>
        ) : (
          "Sign In"
        )}
      </Button>
    )
  }

  return <WalletMultiButton className="wallet-button" />
}

