import { Web3Agent, Web3User } from "./supabase/types"
import { logger } from "./logger"
import { cache } from "./cache"

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || ""

// Cache TTLs in milliseconds
const CACHE_TTL = {
  USER: 5 * 60 * 1000,        // 5 minutes
  TOKEN_LIST: 1 * 60 * 1000,  // 1 minute
  TRENDING: 2 * 60 * 1000,    // 2 minutes
  TOKEN: 3 * 60 * 1000,       // 3 minutes
}

interface ListTokensParams {
  limit?: number
  offset?: number
  search?: string
  orderBy?: string
  isSwarm?: boolean
  include_market_data?: boolean
}

// User API
export async function getUser(walletAddress: string): Promise<Web3User | null> {
  const cacheKey = `user:${walletAddress}`
  const cachedUser = cache.get<Web3User>(cacheKey)
  if (cachedUser) return cachedUser

  try {
    const response = await fetch(`${API_BASE_URL}/api/users?wallet=${walletAddress}`, {
      headers: { 'Cache-Control': 'no-cache' }
    })
    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const user = await response.json()
    if (user) cache.set(cacheKey, user, CACHE_TTL.USER)
    return user
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
      headers: { 
        "Content-Type": "application/json",
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify(data),
    })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const user = await response.json()
    
    // Update cache with new user data
    cache.set(`user:${data.walletAddress}`, user, CACHE_TTL.USER)
    return user
  } catch (error) {
    logger.error("Error in createOrUpdateUser", error as Error)
    throw error
  }
}

// Tokens API
export async function listTokens(params: ListTokensParams = {}): Promise<Web3Agent[]> {
  const cacheKey = `tokens:${JSON.stringify(params)}`
  const cachedTokens = cache.get<Web3Agent[]>(cacheKey)
  if (cachedTokens) return cachedTokens

  try {
    const searchParams = new URLSearchParams()
    if (params.limit) searchParams.append("limit", params.limit.toString())
    if (params.offset) searchParams.append("offset", params.offset.toString())
    if (params.search) searchParams.append("search", params.search)
    if (params.orderBy) searchParams.append("orderBy", params.orderBy)
    if (params.isSwarm !== undefined) searchParams.append("isSwarm", params.isSwarm.toString())
    if (params.include_market_data !== undefined) searchParams.append("include_market_data", params.include_market_data.toString())

    const response = await fetch(`${API_BASE_URL}/api/tokens/list?${searchParams.toString()}`, {
      headers: { 'Cache-Control': 'no-cache' }
    })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

    const data = await response.json()
    logger.info("Successfully fetched tokens", { count: data.length })
    cache.set(cacheKey, data, CACHE_TTL.TOKEN_LIST)
    return data
  } catch (error) {
    logger.error("Error in listTokens", error as Error)
    throw error
  }
}

export async function getTrendingTokens(limit = 3): Promise<Web3Agent[]> {
  const cacheKey = `trending:${limit}`
  const cachedTrending = cache.get<Web3Agent[]>(cacheKey)
  if (cachedTrending) return cachedTrending

  try {
    const response = await fetch(`${API_BASE_URL}/api/tokens/trending?limit=${limit}`, {
      headers: { 'Cache-Control': 'no-cache' }
    })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

    const data = await response.json()
    logger.info("Successfully fetched trending tokens", { count: data.length })
    cache.set(cacheKey, data, CACHE_TTL.TRENDING)
    return data
  } catch (error) {
    logger.error("Error in getTrendingTokens", error as Error)
    throw error
  }
}

export async function getTokenByMint(mintAddress: string): Promise<Web3Agent | null> {
  if (!mintAddress) return null
  
  const cacheKey = `token:${mintAddress}`
  const cachedToken = cache.get<Web3Agent>(cacheKey)
  if (cachedToken) return cachedToken

  try {
    const response = await fetch(`${API_BASE_URL}/api/agent/${mintAddress}`, {
      headers: { 'Cache-Control': 'no-cache' }
    })
    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const token = await response.json()
    if (token) cache.set(cacheKey, token, CACHE_TTL.TOKEN)
    return token
  } catch (error) {
    logger.error("Error in getTokenByMint", error as Error)
    throw error
  }
} 