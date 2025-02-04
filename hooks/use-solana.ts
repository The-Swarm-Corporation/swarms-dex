'use client'

import { useState, useEffect } from 'react'
import { Connection, ConnectionConfig } from '@solana/web3.js'

const endpoint = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com'

const connectionConfig: ConnectionConfig = {
  commitment: 'confirmed',
  disableRetryOnRateLimit: false,
  confirmTransactionInitialTimeout: 60000,
}

export function useSolana() {
  const [connection, setConnection] = useState<Connection | null>(null)

  useEffect(() => {
    const conn = new Connection(endpoint, {
      ...connectionConfig,
      httpHeaders: { 'Content-Type': 'application/json' },
      wsEndpoint: endpoint.replace('https', 'wss'), // Enable websockets for better performance
    })
    setConnection(conn)
  }, [])

  return { connection }
}

