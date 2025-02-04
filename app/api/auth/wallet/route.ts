import { NextResponse } from "next/server"
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { createClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import crypto from "crypto"
import { PublicKey } from "@solana/web3.js"
import bs58 from "bs58"
import nacl from "tweetnacl"
import { logActivity } from '@/lib/supabase/logging'
import { getClientIp } from '@/lib/utils'
import { NextRequest } from "next/server"
import { logger } from '@/lib/logger'

// Initialize service role client for database operations
const serviceClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

// Store and retrieve nonces from database
async function storeNonce(nonce: string, timestamp: number) {
  const { error } = await serviceClient
    .from('auth_nonces')
    .insert({
      nonce,
      timestamp,
      attempts: 0
    })
  if (error) throw error
}

async function getNonce(nonce: string) {
  const { data, error } = await serviceClient
    .from('auth_nonces')
    .select('*')
    .eq('nonce', nonce)
    .single()
  
  if (error) return null
  return data
}

async function updateNonceAttempts(nonce: string, attempts: number) {
  const { error } = await serviceClient
    .from('auth_nonces')
    .update({ attempts })
    .eq('nonce', nonce)
  
  if (error) throw error
}

async function deleteNonce(nonce: string) {
  const { error } = await serviceClient
    .from('auth_nonces')
    .delete()
    .eq('nonce', nonce)
  
  if (error) throw error
}

// Rate limiting store (in production, use Redis or similar)
const rateLimitStore = new Map<string, {
  count: number;
  resetTime: number;
}>()

const MAX_ATTEMPTS = 5 // Maximum failed attempts before timeout
const REQUEST_LIMIT = 100
const REQUEST_WINDOW = 60 * 1000 // 1 minute

// Generate a deterministic password for a wallet
function generateWalletPassword(walletAddress: string): string {
  if (!process.env.AUTH_SECRET) {
    throw new Error("AUTH_SECRET environment variable is required")
  }
  
  const key = Buffer.from(process.env.AUTH_SECRET)
  const message = Buffer.from(walletAddress)
  const hmac = require('crypto').createHmac('sha256', key)
  hmac.update(message)
  return hmac.digest('hex')
}

// Check rate limits for an IP
async function checkRateLimit(ip: string): Promise<boolean> {
  const now = Date.now()
  const record = rateLimitStore.get(ip)

  if (!record || now > record.resetTime) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + REQUEST_WINDOW })
    return true
  }

  if (record.count >= REQUEST_LIMIT) {
    return false
  }

  record.count++
  return true
}

// Generate a nonce for the challenge
export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    
    if (!await checkRateLimit(ip)) {
      await logActivity({
        category: 'auth',
        level: 'warn',
        action: 'rate_limit_exceeded',
        ip_address: ip,
        details: { endpoint: 'GET /api/auth/wallet' }
      })
      
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429 }
      )
    }

    const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
    const timestamp = Date.now()

    await storeNonce(nonce, timestamp)

    await logActivity({
      category: 'auth',
      level: 'info',
      action: 'nonce_generated',
      ip_address: ip,
      details: { timestamp }
    })

    return NextResponse.json({ nonce })
  } catch (error) {
    await logActivity({
      category: 'auth',
      level: 'error',
      action: 'nonce_generation_failed',
      ip_address: getClientIp(request),
      error_message: (error as Error).message,
      details: { error: (error as Error).stack }
    })

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  
  try {
    const { publicKey, signature, nonce } = await request.json()

    // Validate nonce
    const nonceData = await getNonce(nonce)
    if (!nonceData) {
      return NextResponse.json(
        { error: 'Invalid or expired nonce' },
        { status: 400 }
      )
    }

    // Delete nonce after use
    await deleteNonce(nonce)

    // Validate the signature
    const messageUint8 = new TextEncoder().encode(`Sign this message to authenticate with swarms Marketplace: ${nonce}`)
    const pubKeyUint8 = new PublicKey(publicKey).toBytes()
    const signatureUint8 = bs58.decode(signature)

    const isValid = nacl.sign.detached.verify(
      messageUint8,
      signatureUint8,
      pubKeyUint8
    )

    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 400 }
      )
    }

    // Try to sign in
    let signInData = null
    const { data: initialSignInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: `${publicKey}@phantom.wallet`,
      password: generateWalletPassword(publicKey)
    })
    signInData = initialSignInData

    // Handle different sign in scenarios
    if (signInError) {
      // Case 1: Email not confirmed - use admin API to confirm and retry sign in
      if (signInError.message.includes('Email not confirmed')) {
        // Get user from auth.users table
        const { data: user, error: getUserError } = await serviceClient
          .from('auth.users')
          .select('id, email')
          .eq('email', `${publicKey}@phantom.wallet`)
          .single()
        
        if (getUserError) {
          console.error('Error getting user:', getUserError)
          throw getUserError
        }

        if (!user) {
          throw new Error('User not found')
        }

        // Confirm email using admin API
        const { error: confirmError } = await serviceClient.auth.admin.updateUserById(
          user.id,
          { email_confirm: true }
        )

        if (confirmError) throw confirmError

        // Retry sign in after confirmation
        const { data: retrySignInData, error: retrySignInError } = await supabase.auth.signInWithPassword({
          email: `${publicKey}@phantom.wallet`,
          password: generateWalletPassword(publicKey)
        })

        if (retrySignInError) throw retrySignInError
        if (!retrySignInData?.session) throw new Error('No session created during retry sign in')

        signInData = retrySignInData
      }
      // Case 2: Invalid credentials - create new user
      else if (signInError.message.includes('Invalid login credentials')) {
        // Use service role client for signup to bypass email confirmation
        const { data: signUpData, error: signUpError } = await serviceClient.auth.admin.createUser({
          email: `${publicKey}@phantom.wallet`,
          password: generateWalletPassword(publicKey),
          email_confirm: true,
          user_metadata: { wallet_address: publicKey }
        })

        if (signUpError) {
          console.error('Sign up error:', signUpError)
          throw signUpError
        }

        if (!signUpData?.user) {
          throw new Error('No user created during signup')
        }

        // Create web3users record if it doesn't exist
        const { error: web3UserError } = await serviceClient
          .from('web3users')
          .upsert({ 
            wallet_address: publicKey,
            total_trades: 0,
            total_volume: 0
          }, { 
            onConflict: 'wallet_address',
            ignoreDuplicates: true 
          })

        if (web3UserError) {
          console.error('Error upserting web3user:', web3UserError)
          throw web3UserError
        }

        // After signup, explicitly sign in to get a session
        const { data: signInAfterSignupData, error: signInAfterSignupError } = await supabase.auth.signInWithPassword({
          email: `${publicKey}@phantom.wallet`,
          password: generateWalletPassword(publicKey)
        })

        if (signInAfterSignupError) {
          console.error('Sign in after signup error:', signInAfterSignupError)
          throw signInAfterSignupError
        }
        
        if (!signInAfterSignupData?.session) {
          throw new Error('No session created after signup')
        }

        const response = NextResponse.json({
          user: signInAfterSignupData.user,
          session: signInAfterSignupData.session
        })

        response.cookies.set('sb-access-token', signInAfterSignupData.session.access_token, {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 7 // 1 week
        })

        response.cookies.set('sb-refresh-token', signInAfterSignupData.session.refresh_token, {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 7 // 1 week
        })

        return response
      } else {
        // If it's any other error, throw it
        throw signInError
      }
    }

    // Ensure we have session data
    if (!signInData?.session) {
      throw new Error('No session created during sign in')
    }

    // Update wallet address if needed
    let user = signInData.user
    if (!user?.user_metadata?.wallet_address) {
      const { data: { user: updatedUser }, error: updateError } = await supabase.auth.updateUser({
        data: { wallet_address: publicKey }
      })
      if (updateError) throw updateError
      if (updatedUser) user = updatedUser
    }

    // Ensure web3users record exists
    const { error: web3UserError } = await serviceClient
      .from('web3users')
      .upsert({ 
        wallet_address: publicKey,
        total_trades: 0,
        total_volume: 0
      }, { 
        onConflict: 'wallet_address',
        ignoreDuplicates: true 
      })

    if (web3UserError) {
      console.error('Error upserting web3user:', web3UserError)
      throw web3UserError
    }

    const response = NextResponse.json({ 
      user,
      session: signInData.session
    })

    response.cookies.set('sb-access-token', signInData.session.access_token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7 // 1 week
    })

    response.cookies.set('sb-refresh-token', signInData.session.refresh_token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7 // 1 week
    })

    return response
  } catch (error) {
    console.error('Authentication error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Authentication failed' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const cookieStore = cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore })

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError) {
      await logActivity({
        category: 'auth',
        level: 'error',
        action: 'get_user_failed',
        ip_address: ip,
        error_message: userError.message,
        details: { error: userError }
      })
    }

    const { error: signOutError } = await supabase.auth.signOut()

    if (signOutError) {
      await logActivity({
        category: 'auth',
        level: 'error',
        action: 'sign_out_failed',
        user_id: user?.id,
        ip_address: ip,
        error_message: signOutError.message,
        details: { error: signOutError }
      })
      
      return NextResponse.json(
        { error: 'Sign out failed' },
        { status: 500 }
      )
    }

    await logActivity({
      category: 'auth',
      level: 'info',
      action: 'sign_out_success',
      user_id: user?.id,
      ip_address: ip
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    await logActivity({
      category: 'auth',
      level: 'error',
      action: 'sign_out_error',
      ip_address: getClientIp(request),
      error_message: (error as Error).message,
      details: { error: (error as Error).stack }
    })

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 