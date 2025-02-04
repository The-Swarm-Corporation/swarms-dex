import { Web3Agent, Web3User } from "./supabase/types"
import { logger } from "./logger"

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || ""

interface ListTokensParams {
  limit?: number
  offset?: number
  search?: string
  orderBy?: string
  isSwarm?: boolean
}

// User API
export async function getUser(walletAddress: string): Promise<Web3User | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/users?wallet=${walletAddress}`)
    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    return await response.json()
  } catch (error) {
    logger.error("Error in getUser", error as Error)
    throw error
  }
}

export async function createOrUpdateUser(data: {
  walletAddress: string
  username?: string
  avatarUrl?: string
}): Promise<Web3User> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    return await response.json()
  } catch (error) {
    logger.error("Error in createOrUpdateUser", error as Error)
    throw error
  }
}

// Tokens API
export async function listTokens(params: ListTokensParams = {}): Promise<Web3Agent[]> {
  try {
    const searchParams = new URLSearchParams()
    if (params.limit) searchParams.append("limit", params.limit.toString())
    if (params.offset) searchParams.append("offset", params.offset.toString())
    if (params.search) searchParams.append("search", params.search)
    if (params.orderBy) searchParams.append("orderBy", params.orderBy)
    if (params.isSwarm !== undefined) searchParams.append("isSwarm", params.isSwarm.toString())

    const response = await fetch(`${API_BASE_URL}/api/tokens/list?${searchParams.toString()}`)
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

    const data = await response.json()
    logger.info("Successfully fetched tokens", { count: data.length })
    return data
  } catch (error) {
    logger.error("Error in listTokens", error as Error)
    throw error
  }
}

export async function getTrendingTokens(limit = 3): Promise<Web3Agent[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tokens/trending?limit=${limit}`)
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

    const data = await response.json()
    logger.info("Successfully fetched trending tokens", { count: data.length })
    return data
  } catch (error) {
    logger.error("Error in getTrendingTokens", error as Error)
    throw error
  }
}

export async function getTokenByMint(mintAddress: string): Promise<Web3Agent | null> {
  try {
    if (!mintAddress) {
      return null
    }
    const response = await fetch(`${API_BASE_URL}/api/agent/${mintAddress}`)
    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    return await response.json()
  } catch (error) {
    logger.error("Error in getTokenByMint", error as Error)
    throw error
  }
} 