export interface Database {
  public: {
    Tables: {
      web3agents: {
        Row: {
          id: string
          mint_address: string
          token_symbol: string
          current_price: number | null
          market_cap: number | null
          name: string
          description: string
          is_swarm: boolean
        }
      }
    }
  }
} 