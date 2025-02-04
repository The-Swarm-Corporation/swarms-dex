'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { getConnection } from '@/lib/solana'
import { Connection } from '@solana/web3.js'

interface SolanaContextType {
  connection: Connection | null
}

const SolanaContext = createContext<SolanaContextType>({ connection: null })

export function SolanaProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<Connection | null>(null)

  useEffect(() => {
    const conn = getConnection()
    setConnection(conn)
  }, [])

  return (
    <SolanaContext.Provider value={{ connection }}>
      {children}
    </SolanaContext.Provider>
  )
}

export const useSolana = () => useContext(SolanaContext)

