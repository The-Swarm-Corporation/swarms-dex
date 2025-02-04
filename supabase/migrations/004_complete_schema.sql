-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Create custom types
CREATE TYPE trade_type AS ENUM ('buy', 'sell', 'swap');
CREATE TYPE wallet_type AS ENUM ('platform', 'personal');
CREATE TYPE transaction_status AS ENUM ('pending', 'confirmed', 'failed');

-- Create secure schema for sensitive data
CREATE SCHEMA IF NOT EXISTS secure;

-- Platform wallets table (in secure schema)
CREATE TABLE secure.platform_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    public_key TEXT NOT NULL UNIQUE,
    encrypted_private_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    purpose TEXT,
    CONSTRAINT valid_public_key CHECK (LENGTH(public_key) = 44)
);

-- User wallets table
CREATE TABLE web3_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES web3users(id) ON DELETE CASCADE,
    wallet_address TEXT NOT NULL UNIQUE,
    wallet_type wallet_type NOT NULL DEFAULT 'personal',
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ,
    CONSTRAINT valid_wallet_address CHECK (LENGTH(wallet_address) = 44)
);

-- Token holdings table
CREATE TABLE token_holdings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES web3_wallets(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES web3agents(id) ON DELETE CASCADE,
    token_account TEXT NOT NULL,
    balance NUMERIC(20,9) NOT NULL DEFAULT 0,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT positive_balance CHECK (balance >= 0),
    CONSTRAINT valid_token_account CHECK (LENGTH(token_account) = 44)
);

-- Liquidity pools table
CREATE TABLE liquidity_pools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES web3agents(id) ON DELETE CASCADE,
    pool_address TEXT NOT NULL UNIQUE,
    pool_type TEXT NOT NULL DEFAULT 'meteora',
    token_a_mint TEXT NOT NULL,
    token_b_mint TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_liquidity_a NUMERIC(20,9) NOT NULL DEFAULT 0,
    total_liquidity_b NUMERIC(20,9) NOT NULL DEFAULT 0,
    volume_24h NUMERIC(20,9) NOT NULL DEFAULT 0,
    fees_24h NUMERIC(20,9) NOT NULL DEFAULT 0,
    CONSTRAINT valid_pool_address CHECK (LENGTH(pool_address) = 44),
    CONSTRAINT valid_token_mints CHECK (
        LENGTH(token_a_mint) = 44 AND 
        LENGTH(token_b_mint) = 44
    )
);

-- Transaction history table
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES web3users(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES web3agents(id) ON DELETE SET NULL,
    wallet_id UUID NOT NULL REFERENCES web3_wallets(id) ON DELETE CASCADE,
    transaction_type trade_type NOT NULL,
    signature TEXT NOT NULL UNIQUE,
    status transaction_status NOT NULL DEFAULT 'pending',
    amount NUMERIC(20,9) NOT NULL,
    price_per_token NUMERIC(20,9) NOT NULL,
    total_value NUMERIC(20,9) NOT NULL,
    fee NUMERIC(20,9) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    error_message TEXT,
    CONSTRAINT valid_signature CHECK (LENGTH(signature) = 88),
    CONSTRAINT positive_amount CHECK (amount > 0),
    CONSTRAINT positive_price CHECK (price_per_token > 0),
    CONSTRAINT positive_total CHECK (total_value > 0),
    CONSTRAINT non_negative_fee CHECK (fee >= 0)
);

-- Price alerts table
CREATE TABLE price_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES web3users(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES web3agents(id) ON DELETE CASCADE,
    target_price NUMERIC(20,9) NOT NULL,
    condition TEXT NOT NULL CHECK (condition IN ('above', 'below')),
    is_triggered BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    triggered_at TIMESTAMPTZ,
    CONSTRAINT positive_target_price CHECK (target_price > 0)
);

-- Update web3agents table with new columns
ALTER TABLE web3agents
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS is_swarm BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS launch_price NUMERIC(20,9),
ADD COLUMN IF NOT EXISTS max_supply NUMERIC(20,9),
ADD COLUMN IF NOT EXISTS website_url TEXT,
ADD COLUMN IF NOT EXISTS github_url TEXT,
ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_token_holdings_wallet ON token_holdings(wallet_id);
CREATE INDEX IF NOT EXISTS idx_token_holdings_agent ON token_holdings(agent_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_agent ON transactions(agent_id);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_signature ON transactions(signature);
CREATE INDEX IF NOT EXISTS idx_liquidity_pools_agent ON liquidity_pools(agent_id);
CREATE INDEX IF NOT EXISTS idx_web3_wallets_user ON web3_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_web3_wallets_address ON web3_wallets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_price_alerts_user ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_agent ON price_alerts(agent_id);

-- Create function to update last_updated_at
CREATE OR REPLACE FUNCTION update_last_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updating timestamps
CREATE TRIGGER update_liquidity_pools_timestamp
    BEFORE UPDATE ON liquidity_pools
    FOR EACH ROW
    EXECUTE FUNCTION update_last_updated_at();

-- Create view for active wallets with holdings
CREATE OR REPLACE VIEW active_wallets_with_holdings AS
SELECT 
    w.id as wallet_id,
    w.user_id,
    w.wallet_address,
    COUNT(DISTINCT h.agent_id) as unique_tokens,
    SUM(h.balance * p.price) as total_value_usd
FROM web3_wallets w
LEFT JOIN token_holdings h ON h.wallet_id = w.id
LEFT JOIN agent_prices p ON p.agent_id = h.agent_id
WHERE w.is_primary = true
GROUP BY w.id, w.user_id, w.wallet_address;

-- Create view for token statistics
CREATE OR REPLACE VIEW token_statistics AS
SELECT 
    a.id as agent_id,
    a.name,
    a.token_symbol,
    a.mint_address,
    COUNT(DISTINCT h.wallet_id) as holder_count,
    SUM(h.balance) as total_supply_in_wallets,
    MAX(p.price) as current_price,
    MAX(p.volume_24h) as volume_24h,
    MAX(p.market_cap) as market_cap
FROM web3agents a
LEFT JOIN token_holdings h ON h.agent_id = a.id
LEFT JOIN agent_prices p ON p.agent_id = a.id
GROUP BY a.id, a.name, a.token_symbol, a.mint_address;

-- Add RLS policies
ALTER TABLE web3_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own wallets"
    ON web3_wallets FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own holdings"
    ON token_holdings FOR SELECT
    USING (
        wallet_id IN (
            SELECT id FROM web3_wallets WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can view their own transactions"
    ON transactions FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can manage their own price alerts"
    ON price_alerts FOR ALL
    USING (user_id = auth.uid());

-- Create function to update token holdings
CREATE OR REPLACE FUNCTION update_token_holdings()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'confirmed' THEN
        -- Update or insert token holdings
        INSERT INTO token_holdings (wallet_id, agent_id, token_account, balance)
        VALUES (
            NEW.wallet_id,
            NEW.agent_id,
            NEW.token_account,
            CASE 
                WHEN NEW.transaction_type = 'buy' THEN NEW.amount
                WHEN NEW.transaction_type = 'sell' THEN -NEW.amount
                ELSE 0
            END
        )
        ON CONFLICT (wallet_id, agent_id) 
        DO UPDATE SET
            balance = token_holdings.balance + 
                CASE 
                    WHEN NEW.transaction_type = 'buy' THEN NEW.amount
                    WHEN NEW.transaction_type = 'sell' THEN -NEW.amount
                    ELSE 0
                END,
            last_updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updating holdings
CREATE TRIGGER update_holdings_on_transaction
    AFTER UPDATE OF status ON transactions
    FOR EACH ROW
    WHEN (NEW.status = 'confirmed')
    EXECUTE FUNCTION update_token_holdings();

-- Add comments for documentation
COMMENT ON TABLE secure.platform_wallets IS 'Stores platform-owned wallet information securely';
COMMENT ON TABLE web3_wallets IS 'User wallets for the platform';
COMMENT ON TABLE token_holdings IS 'Current token balances for each wallet';
COMMENT ON TABLE liquidity_pools IS 'Meteora liquidity pool information';
COMMENT ON TABLE transactions IS 'Historical record of all transactions';
COMMENT ON TABLE price_alerts IS 'User-configured price alerts';

