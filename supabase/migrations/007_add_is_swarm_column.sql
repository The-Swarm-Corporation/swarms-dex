-- Add is_swarm column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'web3agents' 
        AND column_name = 'is_swarm'
    ) THEN
        ALTER TABLE web3agents ADD COLUMN is_swarm boolean DEFAULT false;
    END IF;
END $$;

-- Update existing records
UPDATE web3agents 
SET is_swarm = false 
WHERE is_swarm IS NULL;

-- Add a comment explaining the column
COMMENT ON COLUMN web3agents.is_swarm IS 'Indicates if the agent is part of a swarm network';

