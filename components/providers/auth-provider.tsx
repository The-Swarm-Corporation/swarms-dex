'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import type { User } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'

type AuthContextType = {
  user: User | null
  loading: boolean
  isAuthenticated: boolean
  walletAddress: string | undefined
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAuthenticated: false,
  walletAddress: undefined
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [walletAddress, setWalletAddress] = useState<string | undefined>(undefined)
  const supabase = createClientComponentClient()
  const router = useRouter()

  const updateAuthState = (user: User | null) => {
    setUser(user)
    setIsAuthenticated(!!user)
    setWalletAddress(user?.user_metadata?.wallet_address || undefined)
  }

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        updateAuthState(session.user)
      } else {
        updateAuthState(null)
      }
      setLoading(false)
    }).catch((error) => {
      console.error('Error getting initial session:', error)
      updateAuthState(null)
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        if (session?.user) {
          updateAuthState(session.user)
          router.refresh()
        }
      } else if (event === 'SIGNED_OUT') {
        updateAuthState(null)
        router.refresh()
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase, router])

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      isAuthenticated,
      walletAddress
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
} 