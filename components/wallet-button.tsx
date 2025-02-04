"use client"

import { Button } from "@/components/ui/button"
import { signInWithWallet, signOut } from "@/lib/auth/wallet"
import { PublicKey } from "@solana/web3.js"
import { Loader2 } from "lucide-react"
import { useAuth } from "./providers/auth-provider"
import { useState } from "react"
import { toast } from "sonner"

export function WalletButton() {
  const { user, loading } = useAuth()
  const [signing, setSigning] = useState(false)

  const handleClick = async () => {
    if (signing) return
    
    try {
      setSigning(true)
      
      if (user) {
        await signOut()
        return
      }

      // @ts-ignore - Phantom wallet type
      const provider = window?.phantom?.solana
      if (!provider?.isPhantom) {
        window.open("https://phantom.app/", "_blank")
        return
      }

      const response = await provider.connect()
      const success = await signInWithWallet(new PublicKey(response.publicKey.toString()))
      
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

  if (loading) {
    return (
      <Button disabled className="bg-red-600 text-white">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading...
      </Button>
    )
  }

  return (
    <Button 
      onClick={handleClick}
      className="bg-red-600 hover:bg-red-700 text-white"
      disabled={signing}
    >
      {signing ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {user ? "Signing Out..." : "Signing In..."}
        </>
      ) : user ? (
        user.user_metadata?.wallet_address?.slice(0, 4) + "..." + user.user_metadata?.wallet_address?.slice(-4)
      ) : (
        "Connect Wallet"
      )}
    </Button>
  )
}

