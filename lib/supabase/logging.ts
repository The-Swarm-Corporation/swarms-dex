'use server';

import { createClient } from '@supabase/supabase-js';

// Initialize service role client for logging
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type LogLevel = 'info' | 'warn' | 'error';
type LogCategory = 'auth' | 'wallet' | 'token' | 'trade' | 'system' | 'pool';

interface LogActivity {
  user_id?: string;
  wallet_address?: string;
  category: LogCategory;
  level: LogLevel;
  action: string;
  details?: Record<string, any>;
  error_message?: string;
  ip_address?: string;
}

export async function logActivity({
  user_id,
  wallet_address,
  category,
  level,
  action,
  details = {},
  error_message,
  ip_address,
}: LogActivity) {
  try {
    const { error } = await supabaseAdmin
      .from('activity_logs')
      .insert({
        user_id,
        wallet_address,
        category,
        level,
        action,
        details,
        error_message,
        ip_address,
      });

    if (error) {
      console.error('Failed to log activity:', error);
    }
  } catch (err) {
    console.error('Error logging activity:', err);
  }
}

