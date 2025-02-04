-- Add auth-related columns to web3users if they don't exist
ALTER TABLE web3users
ADD COLUMN IF NOT EXISTS email TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Add RLS policies for authentication
ALTER TABLE web3users ENABLE ROW LEVEL SECURITY;

-- Users can read their own data
CREATE POLICY "Users can view their own data"
    ON web3users FOR SELECT
    USING (
        auth.uid()::text = id::text OR
        auth.uid()::text IN (
            SELECT user_id::text 
            FROM web3_wallets 
            WHERE wallet_address = web3users.wallet_address
        )
    );

-- Users can update their own data
CREATE POLICY "Users can update their own data"
    ON web3users FOR UPDATE
    USING (
        auth.uid()::text = id::text OR
        auth.uid()::text IN (
            SELECT user_id::text 
            FROM web3_wallets 
            WHERE wallet_address = web3users.wallet_address
        )
    );