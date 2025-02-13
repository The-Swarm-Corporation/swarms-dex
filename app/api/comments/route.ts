import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/service-role'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const agentId = searchParams.get('agent_id')

  if (!agentId) {
    return NextResponse.json({ error: 'Missing agent_id' }, { status: 400 })
  }

  const { data, error } = await supabaseServiceRole
    .from('agent_comments')
    .select(`
      id,
      content,
      created_at,
      updated_at,
      is_edited,
      parent_id,
      user:user_id (
        id,
        username,
        wallet_address,
        avatar_url
      )
    `)
    .eq('agent_id', agentId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const { agent_id, content, parent_id, wallet_address } = await request.json()

  if (!wallet_address || !agent_id || !content) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Get the web3user directly using service role client
  const { data: web3user, error: userError } = await supabaseServiceRole
    .from('web3users')
    .select('id')
    .ilike('wallet_address', wallet_address)
    .single()

  if (userError) {
    console.error('Error finding web3user:', userError)
    return NextResponse.json({ error: 'Error finding user: ' + userError.message }, { status: 500 })
  }

  if (!web3user) {
    console.error('No web3user found for wallet:', wallet_address)
    return NextResponse.json({ error: 'User not found for wallet: ' + wallet_address }, { status: 404 })
  }

  const { data, error } = await supabaseServiceRole
    .from('agent_comments')
    .insert({
      agent_id,
      user_id: web3user.id,
      content,
      parent_id: parent_id || null
    })
    .select(`
      id,
      content,
      created_at,
      updated_at,
      is_edited,
      parent_id,
      user:user_id (
        id,
        username,
        wallet_address,
        avatar_url
      )
    `)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
} 