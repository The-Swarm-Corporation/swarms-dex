import { NextResponse } from "next/server"
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { createClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"

// Initialize service role client for database operations
const serviceClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function POST() {
  try {
    const cookieStore = cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore })

    // Get the current user before signing out
    const { data: { user } } = await supabase.auth.getUser()
    
    // Sign out
    await supabase.auth.signOut()

    // Log the sign out if we had a user
    if (user) {
      await serviceClient
        .from('activity_logs')
        .insert({
          category: 'auth',
          level: 'info',
          action: 'sign_out',
          user_id: user.id,
          details: {
            method: 'wallet'
          }
        })
    }
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to sign out:", error)

    // Log the error
    await serviceClient
      .from('activity_logs')
      .insert({
        category: 'auth',
        level: 'error',
        action: 'sign_out_error',
        details: {
          error: error instanceof Error ? error.message : "Unknown error"
        }
      })

    return NextResponse.json(
      { error: "Failed to sign out" },
      { status: 500 }
    )
  }
} 