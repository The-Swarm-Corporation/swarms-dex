import { NextRequest, NextResponse } from 'next/server';
import { logActivity } from '@/lib/supabase/logging';
import { getClientIp } from '@/lib/utils';

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const body = await request.json();
    
    await logActivity({
      ...body,
      ip_address: ip
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to log activity:', error);
    return NextResponse.json(
      { error: 'Failed to log activity' },
      { status: 500 }
    );
  }
} 