import { createClient } from '@supabase/supabase-js'
import { Web3User, Web3Agent, AgentTrade, AgentPrice, AgentStatistics } from './types'

type Database = {
  public: {
    Tables: {
      users: {
        Row: Web3User
        Insert: Omit<Web3User, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Web3User, 'id' | 'created_at' | 'updated_at'>>
      }
      agents: {
        Row: Web3Agent
        Insert: Omit<Web3Agent, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Web3Agent, 'id' | 'created_at' | 'updated_at'>>
      }
      trades: {
        Row: AgentTrade
        Insert: Omit<AgentTrade, 'id' | 'created_at'>
        Update: Partial<Omit<AgentTrade, 'id' | 'created_at'>>
      }
      prices: {
        Row: AgentPrice
        Insert: Omit<AgentPrice, 'id'>
        Update: Partial<Omit<AgentPrice, 'id'>>
      }
    }
    Views: {
      agent_statistics: {
        Row: AgentStatistics
      }
    }
    Functions: {
      [key: string]: never
    }
    Enums: {
      [key: string]: never
    }
  }
}

let supabaseAdmin: ReturnType<typeof createClient<Database>> | null = null

export function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('Missing env.NEXT_PUBLIC_SUPABASE_URL')
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing env.SUPABASE_SERVICE_ROLE_KEY')
  }

  supabaseAdmin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )

  return supabaseAdmin
}

