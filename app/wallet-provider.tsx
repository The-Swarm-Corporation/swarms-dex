'use client'

import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets'
import { FC, ReactNode, useCallback, useMemo } from 'react'
import { RPC_ENDPOINT, CONNECTION_CONFIG, network } from '@/config/solana'

require('@solana/wallet-adapter-react-ui/styles.css')

export const WalletProviders: FC<{ children: ReactNode }> = ({ children }) => {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter({ network })],
    []
  )

  const onError = useCallback(
    (error: any) => {
      console.error('Wallet error:', error)
    },
    []
  )

  return (
    <ConnectionProvider 
      endpoint={RPC_ENDPOINT}
      config={CONNECTION_CONFIG}
    >
      <WalletProvider 
        wallets={wallets}
        onError={onError}
        autoConnect={false}
      >
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

