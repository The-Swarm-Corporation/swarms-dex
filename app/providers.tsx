'use client'

import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { ErrorBoundary } from '@/components/error-boundary'
import { endpoint, wallets } from '@/config/wallet'
import { useMemo } from 'react'

require('@solana/wallet-adapter-react-ui/styles.css')

export function Providers({ children }: { children: React.ReactNode }) {
  // Ensure we're using memo to prevent unnecessary re-renders
  const memorizedEndpoint = useMemo(() => endpoint, [])
  const memorizedWallets = useMemo(() => wallets, [])

  return (
    <ErrorBoundary>
      <ConnectionProvider endpoint={memorizedEndpoint}>
        <WalletProvider wallets={memorizedWallets} autoConnect>
          <WalletModalProvider>{children}</WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </ErrorBoundary>
  )
}

