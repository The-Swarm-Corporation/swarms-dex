import type { PublicKey } from "@solana/web3.js"
import { toast } from "sonner"
import { logger } from "../logger"
import { logActivity } from "../client/logging"
import bs58 from "bs58"
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

export async function signInWithWallet(publicKey: PublicKey) {
  const supabase = createClientComponentClient()
  
  try {
    // First get a nonce from the server
    const nonceResponse = await fetch(`/api/auth/wallet?publicKey=${publicKey.toString()}`)
    if (!nonceResponse.ok) {
      throw new Error("Failed to get authentication challenge")
    }

    const { nonce } = await nonceResponse.json()
    const message = `Sign this message to authenticate with swarms Marketplace: ${nonce}`

    // Sign the message
    // @ts-ignore - Phantom wallet type
    const signResult = await window.phantom?.solana?.signMessage(
      new TextEncoder().encode(message),
      "utf8"
    )

    if (!signResult) {
      throw new Error("Failed to sign message")
    }

    // Convert signature to base58 string
    const signature = bs58.encode(Buffer.from(signResult.signature))

    console.log("Sending auth request with:", {
      publicKey: publicKey.toString(),
      signature,
      nonce
    })

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
    })

    const authData = await response.json()
    console.log("Auth response:", authData)

    if (!response.ok) {
      throw new Error(authData.error || "Authentication failed")
    }

    if (!authData.session) {
      console.error("No session in auth response")
      throw new Error("No session in authentication response")
    }

    console.log("Setting session with:", {
      access_token: authData.session.access_token?.slice(0, 10) + "...",
      refresh_token: authData.session.refresh_token?.slice(0, 10) + "..."
    })

    // Manually set the session in Supabase
    const { error: setSessionError } = await supabase.auth.setSession({
      access_token: authData.session.access_token,
      refresh_token: authData.session.refresh_token
    })

    if (setSessionError) {
      console.error("Error setting session:", setSessionError)
      throw setSessionError
    }

    console.log("Verifying session...")
    // Verify the session was set
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError) {
      console.error("Error getting session:", sessionError)
      throw sessionError
    }
    
    if (!session) {
      console.error("No session after verification")
      throw new Error("No session after authentication")
    }

    console.log("Session verified:", {
      user_id: session.user.id,
      wallet: session.user.user_metadata?.wallet_address
    })

    toast.success("Successfully signed in with wallet")
    return true
  } catch (error) {
    console.error("Failed to sign in with wallet:", error)
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

