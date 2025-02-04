-- Add is_swarm column to web3agents table
ALTER TABLE web3agents 
ADD COLUMN is_swarm boolean DEFAULT false;

-- Update existing records
UPDATE web3agents 
SET is_swarm = false;

