import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

// Get user by wallet address
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const walletAddress = searchParams.get("wallet")

    if (!walletAddress) {
      return NextResponse.json({ error: "Wallet address is required" }, { status: 400 })
    }

    logger.info("Fetching user by wallet", { wallet: walletAddress })

    const { data: user, error } = await supabase
      .from("web3users")
      .select("*")
      .eq("wallet_address", walletAddress)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json({ error: "User not found" }, { status: 404 })
      }
      logger.error("Error fetching user", error)
      return NextResponse.json({ error: "Failed to fetch user" }, { status: 500 })
    }

    return NextResponse.json(user)
  } catch (error) {
    logger.error("Error in GET /api/users", error as Error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Create or update user
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { walletAddress, username, avatarUrl } = body

    if (!walletAddress) {
      return NextResponse.json({ error: "Wallet address is required" }, { status: 400 })
    }

    logger.info("Creating/updating user", { wallet: walletAddress })

    const { data: existingUser } = await supabase
      .from("web3users")
      .select("id")
      .eq("wallet_address", walletAddress)
      .single()

    if (existingUser) {
      // Update existing user
      const { data: user, error } = await supabase
        .from("web3users")
        .update({
          username: username || null,
          avatar_url: avatarUrl || null,
          updated_at: new Date().toISOString()
        })
        .eq("wallet_address", walletAddress)
        .select()
        .single()

      if (error) {
        logger.error("Error updating user", error)
        return NextResponse.json({ error: "Failed to update user" }, { status: 500 })
      }

      return NextResponse.json(user)
    } else {
      // Create new user
      const { data: user, error } = await supabase
        .from("web3users")
        .insert({
          wallet_address: walletAddress,
          username: username || null,
          avatar_url: avatarUrl || null,
          total_trades: 0,
          total_volume: 0
        })
        .select()
        .single()

      if (error) {
        logger.error("Error creating user", error)
        return NextResponse.json({ error: "Failed to create user" }, { status: 500 })
      }

      return NextResponse.json(user)
    }
  } catch (error) {
    logger.error("Error in POST /api/users", error as Error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
} 