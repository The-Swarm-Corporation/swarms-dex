-- Drop existing activity_logs table if it exists
DROP TABLE IF EXISTS activity_logs;

-- Create activity_logs table with correct schema
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES web3users(id) ON DELETE SET NULL,
    wallet_address TEXT,
    category TEXT NOT NULL CHECK (category IN ('auth', 'wallet', 'token', 'trade', 'system')),
    level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
    action TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT valid_wallet_address CHECK (
        wallet_address IS NULL OR LENGTH(wallet_address) = 44
    )
);

-- Create indexes for better query performance
CREATE INDEX idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_wallet ON activity_logs(wallet_address);
CREATE INDEX idx_activity_logs_category ON activity_logs(category);
CREATE INDEX idx_activity_logs_level ON activity_logs(level);
CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at);

-- Add RLS policies
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Allow service role to insert logs
CREATE POLICY "Service role can insert logs"
    ON activity_logs FOR INSERT
    WITH CHECK (true);

-- Users can view their own logs
CREATE POLICY "Users can view their own logs"
    ON activity_logs FOR SELECT
    USING (
        auth.uid() = user_id OR
        auth.uid()::text IN (
            SELECT user_id::text 
            FROM web3_wallets 
            WHERE wallet_address = activity_logs.wallet_address
        )
    ); 