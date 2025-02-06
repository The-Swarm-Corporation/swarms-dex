export interface Web3Agent {
  mint_address: string;
  token_symbol: string;
  name: string;
  description: string;
  current_price?: number;
  price_change_24h?: number;
  market_cap?: number;
  is_swarm: boolean;
  pool_address?: string;
  creator_wallet?: string;
  bonding_curve_address?: string;
  metadata?: {
    pool_created_at?: string;
    pool_signature?: string;
  };
} 