import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Initialize service role client for database operations
const serviceClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })

  try {
    // Refresh the session - this will update all session cookies
    const { data: { session }, error } = await supabase.auth.getSession()
    if (error) throw error

    // If we have a session, ensure all cookies are properly set
    if (session) {
      const { access_token, refresh_token } = session
      const walletAddress = session.user?.user_metadata?.wallet_address

      // If we have a wallet address, ensure web3users record exists
      if (walletAddress) {
        const { error: web3UserError } = await serviceClient
          .from('web3users')
          .upsert({ 
            wallet_address: walletAddress,
            total_trades: 0,
            total_volume: 0
          }, { 
            onConflict: 'wallet_address',
            ignoreDuplicates: true 
          })

        if (web3UserError) {
          console.error('Error upserting web3user in middleware:', web3UserError)
        }
      }

      // Ensure both tokens are set in cookies with proper settings
      res.cookies.set('sb-access-token', access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
      })

      res.cookies.set('sb-refresh-token', refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
      })
    }

    return res
  } catch (error) {
    console.error('Session refresh error:', error)
    return res
  }
}

// This ensures middleware runs for all routes except static files
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
} 