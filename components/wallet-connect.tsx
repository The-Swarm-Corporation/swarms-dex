'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useSolana } from './providers/solana-provider'

export function WalletConnect() {
  const [mounted, setMounted] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connected, setConnected] = useState(false)
  const { connection } = useSolana()

  useEffect(() => {
    setMounted(true)
  }, [])

  const connectWallet = async () => {
    if (!connection) return

    try {
      setConnecting(true)
      // @ts-ignore - Phantom wallet type
      const provider = window?.phantom?.solana
      
      if (!provider?.isPhantom) {
        window.open('https://phantom.app/', '_blank')
        return
      }

      await provider.connect()
      setConnected(true)
    } catch (error) {
      console.error('Failed to connect:', error)
    } finally {
      setConnecting(false)
    }
  }

  if (!mounted) {
    return null
  }

  return (
    <Button 
      onClick={connectWallet}
      disabled={connecting || !connection}
      className="phantom-button"
    >
      {connecting ? 'Connecting...' : connected ? 'Connected' : 'Connect Phantom'}
    </Button>
  )
}

