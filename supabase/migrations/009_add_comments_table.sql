-- Create comments table
CREATE TABLE agent_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES web3agents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES web3users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    parent_id UUID REFERENCES agent_comments(id) ON DELETE CASCADE,
    is_edited BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT content_not_empty CHECK (LENGTH(TRIM(content)) > 0)
);

-- Create indexes for better query performance
CREATE INDEX idx_agent_comments_agent ON agent_comments(agent_id);
CREATE INDEX idx_agent_comments_user ON agent_comments(user_id);
CREATE INDEX idx_agent_comments_parent ON agent_comments(parent_id);
CREATE INDEX idx_agent_comments_created ON agent_comments(created_at);

-- Grant service role access
GRANT ALL PRIVILEGES ON TABLE agent_comments TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Add comment for documentation
COMMENT ON TABLE agent_comments IS 'User comments on agent tokens';

-- Create function to update updated_at on comment edits
CREATE OR REPLACE FUNCTION update_agent_comment_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.is_edited = TRUE;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updating updated_at
CREATE TRIGGER update_agent_comment_timestamp
    BEFORE UPDATE ON agent_comments
    FOR EACH ROW
    WHEN (OLD.content IS DISTINCT FROM NEW.content)
    EXECUTE FUNCTION update_agent_comment_updated_at(); 