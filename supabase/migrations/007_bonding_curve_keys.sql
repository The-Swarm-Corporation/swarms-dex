-- Create table for bonding curve keys in secure schema
CREATE TABLE secure.bonding_curve_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES public.web3agents(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL UNIQUE,
    encrypted_private_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT valid_public_key CHECK (LENGTH(public_key) = 44)
);

-- Create index for better query performance
CREATE INDEX idx_bonding_curve_keys_agent ON secure.bonding_curve_keys(agent_id);

-- Add RLS policy
ALTER TABLE secure.bonding_curve_keys ENABLE ROW LEVEL SECURITY;

-- Add comment for documentation
COMMENT ON TABLE secure.bonding_curve_keys IS 'Secure storage for bonding curve keypairs'; 