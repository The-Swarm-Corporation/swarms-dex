-- Add current_supply column to web3agents table
ALTER TABLE web3agents 
ADD COLUMN IF NOT EXISTS current_supply NUMERIC(20,9);

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_web3agents_current_supply ON web3agents(current_supply);

-- Add comment for documentation
COMMENT ON COLUMN web3agents.current_supply IS 'Current circulating supply of the token'; 