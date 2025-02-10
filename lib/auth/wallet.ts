import type { PublicKey } from "@solana/web3.js"
import { toast } from "sonner"
import { logger } from "../logger"
import { logActivity } from "../client/logging"
import bs58 from "bs58"
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

// Phantom wallet types
declare global {
  interface Window {
    phantom?: {
      solana?: {
        signMessage(message: Uint8Array, encoding: string): Promise<{
          signature: Uint8Array;
          publicKey: PublicKey;
        }>;
        connect(): Promise<{ publicKey: PublicKey }>;
        isPhantom?: boolean;
      };
    };
  }
}

export async function signInWithWallet(publicKey: PublicKey) {
  const supabase = createClientComponentClient()
  
  try {
    // First get a nonce from the server
    const nonceResponse = await fetch('/api/auth/wallet')
    if (!nonceResponse.ok) {
      throw new Error("Failed to get authentication challenge")
    }

    const { nonce } = await nonceResponse.json()
    const message = `Sign this message to authenticate with swarms Marketplace: ${nonce}`
    const encodedMessage = new TextEncoder().encode(message)

    // Check if Phantom wallet is available
    if (!window.phantom?.solana) {
      throw new Error("Phantom wallet is not installed")
    }

    try {
      // Request wallet signature
      const signResult = await window.phantom.solana.signMessage(
        encodedMessage,
        'utf8'
      )

      if (!signResult?.signature) {
        throw new Error("Failed to get signature from wallet")
      }

      // Convert signature to base58 string
      const signature = bs58.encode(signResult.signature)

      // Authenticate with our API endpoint
      const response = await fetch("/api/auth/wallet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          publicKey: publicKey.toString(),
          signature,
          nonce
        }),
        credentials: 'include' // Important for cookie handling
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Authentication failed")
      }

      // Refresh the session
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (!session) throw new Error("No session found after authentication")

      // Force a router refresh
      window.location.reload()

      // Log successful authentication
      await logActivity({
        category: "auth",
        level: "info",
        action: "sign_in",
        details: {
          method: "wallet",
          wallet_address: publicKey.toString()
        },
      })

      toast.success("Successfully signed in with wallet")
      return true
    } catch (signError) {
      // Handle user rejection or signing errors specifically
      if (signError instanceof Error && signError.message.includes('User rejected')) {
        toast.error("Wallet signing was rejected")
      } else {
        throw signError
      }
      return false
    }
  } catch (error) {
    console.error("Failed to sign in with wallet:", error)
    logger.error("Wallet authentication failed", error as Error)
    toast.error(error instanceof Error ? error.message : "Failed to sign in with wallet")
    return false
  }
}

export async function signOut() {
  const supabase = createClientComponentClient()
  
  try {
    const { error } = await supabase.auth.signOut()
    if (error) throw error

    await logActivity({
      category: "auth",
      level: "info",
      action: "sign_out",
      details: {
        method: "wallet",
      },
    })

    toast.success("Successfully signed out")
  } catch (error) {
    logger.error("Failed to sign out", error as Error)
    toast.error("Failed to sign out")
  }
}

