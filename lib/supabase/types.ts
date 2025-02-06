export interface Web3User {
  id: string
  wallet_address: string
  created_at: string
  updated_at: string
  username: string | null
  avatar_url: string | null
  total_trades: number
  total_volume: number
}

export interface Web3Agent {
  volume24h: number
  pool_address: string | undefined
  id: string
  creator_id: string
  name: string
  description: string
  token_symbol: string
  mint_address: string
  created_at: string
  updated_at: string
  twitter_handle: string | null
  telegram_group: string | null
  discord_server: string | null
  initial_supply: number
  liquidity_pool_size: number
  is_verified: boolean
  is_swarm: boolean
  current_price?: number
  price_change_24h?: number
  volume_24h?: number
  creator_wallet?: string
  bonding_curve_address?: string
  metadata?: {
    pool_created_at?: string
    pool_signature?: string
    pool_address?: string
  }
  market_cap?: number
  creator?: Web3User
  prices?: AgentPrice[]
  trades?: AgentTrade[]
}

export interface AgentTrade {
  id: string
  agent_id: string
  trader_id: string
  trade_type: 'buy' | 'sell'
  amount: number
  price: number
  total_value: number
  transaction_signature: string
  created_at: string
}

export interface AgentPrice {
  id: string
  agent_id: string
  price: number
  volume_24h: number
  market_cap: number
  timestamp: string
}

export interface AgentStatistics {
  agent_id: string
  name: string
  token_symbol: string
  unique_traders: number
  total_buy_volume: number
  total_sell_volume: number
  total_trades: number
  current_price: number
}

