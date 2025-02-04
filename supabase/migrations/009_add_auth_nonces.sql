-- Create auth_nonces table
CREATE TABLE auth_nonces (
    nonce TEXT PRIMARY KEY,
    timestamp BIGINT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for timestamp to help with cleanup
CREATE INDEX idx_auth_nonces_timestamp ON auth_nonces(timestamp);

-- Add RLS policies
ALTER TABLE auth_nonces ENABLE ROW LEVEL SECURITY;

-- Only allow service role to access nonces
CREATE POLICY "Service role can manage nonces"
    ON auth_nonces
    USING (auth.role() = 'service_role');

-- Create function to clean up expired nonces (older than 5 minutes)
CREATE OR REPLACE FUNCTION cleanup_expired_nonces()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM auth_nonces
    WHERE timestamp < (EXTRACT(EPOCH FROM NOW()) * 1000 - 5 * 60 * 1000);
END;
$$; 