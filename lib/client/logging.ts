type LogLevel = 'info' | 'warn' | 'error';
type LogCategory = 'auth' | 'wallet' | 'token' | 'trade' | 'system';

interface LogActivity {
  user_id?: string;
  wallet_address?: string;
  category: LogCategory;
  level: LogLevel;
  action: string;
  details?: Record<string, any>;
  error_message?: string;
}

export async function logActivity(activity: LogActivity) {
  try {
    const response = await fetch('/api/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(activity),
    });

    if (!response.ok) {
      console.error('Failed to log activity:', await response.text());
    }
  } catch (error) {
    console.error('Error logging activity:', error);
  }
} 