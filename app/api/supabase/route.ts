import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const cookieStore = cookies()
  const supabase = getSupabaseAdmin()

  return NextResponse.json({ status: 'ok' })
}

