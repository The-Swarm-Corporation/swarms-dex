import type { Web3Agent } from "@/lib/supabase/types"
import { getSupabaseClient } from "@/lib/supabase/client"
import { logger } from "@/lib/logger"

export async function listTokens(limit = 10, offset = 0, search?: string): Promise<Web3Agent[]> {
  const supabase = getSupabaseClient()
  logger.info("Fetching tokens list", { limit, offset, search })

  try {
    let query = supabase
      .from("web3agents")
      .select(`
        *,
        creator:creator_id(wallet_address),
        prices:agent_prices(
          price,
          volume_24h,
          market_cap,
          timestamp
        )
      `)
      .order("created_at", { ascending: false })

    if (search) {
      query = query.or(`name.ilike.%${search}%,token_symbol.ilike.%${search}%`)
    }

    const { data, error } = await query.range(offset, offset + limit - 1)

    if (error) {
      logger.error("Failed to fetch tokens", error as Error)
      throw error
    }

    // Process and format the data
    const formattedData = data.map((agent) => {
      const latestPrice = agent.prices?.[0]
      const previousPrice = agent.prices?.[1]
      const priceChange =
        latestPrice && previousPrice ? ((latestPrice.price - previousPrice.price) / previousPrice.price) * 100 : 0

      return {
        ...agent,
        is_swarm: agent.is_swarm || false, // Provide default value
        current_price: latestPrice?.price || 0,
        price_change_24h: priceChange,
        volume_24h: latestPrice?.volume_24h || 0,
        market_cap: latestPrice?.market_cap || 0,
      }
    })

    logger.info("Successfully fetched tokens", {
      count: formattedData.length,
      hasSearch: !!search,
    })

    return formattedData
  } catch (error) {
    logger.error("Error in listTokens", error as Error)

    // If the error is related to the missing column, return empty array
    if (error instanceof Error && error.message.includes('column "is_swarm" does not exist')) {
      logger.warn("is_swarm column not found, returning empty array")
      return []
    }

    throw error
  }
}

export async function getTrendingTokens(limit = 3): Promise<Web3Agent[]> {
  const supabase = getSupabaseClient()
  logger.info("Fetching trending tokens", { limit })

  try {
    const { data, error } = await supabase
      .from("web3agents")
      .select(`
        *,
        creator:creator_id(wallet_address),
        prices:agent_prices(
          price,
          volume_24h,
          market_cap,
          timestamp
        )
      `)
      .order("volume_24h", { ascending: false })
      .limit(limit)

    

    if (error) {
      logger.error("Failed to fetch trending tokens", error as Error)
      throw error
    }

    // Process and format the data
    const formattedData = data.map((agent) => {
      const latestPrice = agent.prices?.[0]
      const previousPrice = agent.prices?.[1]
      const priceChange =
        latestPrice && previousPrice ? ((latestPrice.price - previousPrice.price) / previousPrice.price) * 100 : 0

      return {
        ...agent,
        is_swarm: agent.is_swarm || false,
        current_price: latestPrice?.price || 0,
        price_change_24h: priceChange,
        volume_24h: latestPrice?.volume_24h || 0,
        market_cap: latestPrice?.market_cap || 0,
      }
    })

    logger.info("Successfully fetched trending tokens", {
      count: formattedData.length,
    })

    return formattedData
  } catch (error) {
    logger.error("Error in getTrendingTokens", error as Error)

    // If the error is related to the missing column, return empty array
    if (error instanceof Error && error.message.includes('column "is_swarm" does not exist')) {
      logger.warn("is_swarm column not found, returning empty array")
      return []
    }

    throw error
  }
}

export async function getWeb3AgentByMint(mintAddress: string): Promise<Web3Agent | null> {
  const supabase = getSupabaseClient()
  logger.info("Fetching agent by mint address", { mintAddress })

  try {
    const { data, error } = await supabase
      .from("web3agents")
      .select(`
        *,
        creator:creator_id(wallet_address),
        prices:agent_prices(
          price,
          volume_24h,
          market_cap,
          timestamp
        )
      `)
      .eq("mint_address", mintAddress)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        // PGRST116 is the error code for no rows returned
        logger.info("No agent found for mint address", { mintAddress })
        return null
      }
      logger.error("Failed to fetch agent by mint", error as Error)
      throw error
    }

    // Process and format the data
    const latestPrice = data.prices?.[0]
    const previousPrice = data.prices?.[1]
    const priceChange =
      latestPrice && previousPrice ? ((latestPrice.price - previousPrice.price) / previousPrice.price) * 100 : 0

    const formattedData = {
      ...data,
      is_swarm: data.is_swarm || false,
      current_price: latestPrice?.price || 0,
      price_change_24h: priceChange,
      volume_24h: latestPrice?.volume_24h || 0,
      market_cap: latestPrice?.market_cap || 0,
    }

    logger.info("Successfully fetched agent by mint", {
      mintAddress,
      symbol: formattedData.token_symbol,
    })

    return formattedData
  } catch (error) {
    logger.error("Error in getWeb3AgentByMint", error as Error)

    // If the error is related to the missing column, return null
    if (error instanceof Error && error.message.includes('column "is_swarm" does not exist')) {
      logger.warn("is_swarm column not found, returning null")
      return null
    }

    throw error
  }
}

export async function createWeb3Agent(agent: Omit<Web3Agent, "id" | "created_at" | "updated_at">): Promise<Web3Agent> {
  const supabase = getSupabaseClient()
  logger.info("Creating new web3 agent", { symbol: agent.token_symbol })

  try {
    const { data, error } = await supabase
      .from("web3agents")
      .insert({
        ...agent,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      logger.error("Failed to create web3 agent", error as Error)
      throw error
    }

    logger.info("Successfully created web3 agent", {
      id: data.id,
      symbol: data.token_symbol,
    })

    return data
  } catch (error) {
    logger.error("Error in createWeb3Agent", error as Error)
    throw error
  }
}

