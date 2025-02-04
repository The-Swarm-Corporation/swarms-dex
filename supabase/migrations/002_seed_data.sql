-- Insert sample agents
INSERT INTO web3agents (
  name,
  description,
  token_symbol,
  mint_address,
  creator_id,
  initial_supply,
  liquidity_pool_size,
  is_verified,
  twitter_handle,
  telegram_group,
  discord_server
) VALUES
(
  'CyberMind',
  'Advanced AI trading bot with predictive analytics and machine learning capabilities for automated market analysis.',
  'CMIND',
  '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  (SELECT id FROM web3users LIMIT 1),
  1000000,
  50000,
  true,
  'cybermind_ai',
  'cybermind_trading',
  'cybermind'
),
(
  'HiveMind',
  'Decentralized swarm intelligence network leveraging collective AI agents for enhanced decision making.',
  'HIVE',
  '8xLYtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  (SELECT id FROM web3users LIMIT 1),
  2000000,
  75000,
  true,
  'hivemind_dao',
  'hivemind_official',
  'hivemind'
),
(
  'NeuralNet',
  'Self-improving AI agent specializing in real-time market analysis and pattern recognition.',
  'NNET',
  '9xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  (SELECT id FROM web3users LIMIT 1),
  500000,
  30000,
  false,
  'neuralnet_ai',
  null,
  'neuralnet'
);

-- Insert price history for each agent
INSERT INTO agent_prices (
  agent_id,
  price,
  volume_24h,
  market_cap,
  timestamp
)
SELECT 
  a.id,
  1.0 + random() * 2.0,
  10000 + random() * 90000,
  1000000 + random() * 9000000,
  NOW() - (i || ' hours')::interval
FROM web3agents a
CROSS JOIN generate_series(0, 23) i;

-- Insert some trades
INSERT INTO agent_trades (
  agent_id,
  trader_id,
  trade_type,
  amount,
  price,
  total_value,
  transaction_signature
)
SELECT
  a.id,
  (SELECT id FROM web3users LIMIT 1),
  CASE WHEN random() > 0.5 THEN 'buy' ELSE 'sell' END,
  1000 + random() * 9000,
  1.0 + random() * 2.0,
  (1000 + random() * 9000) * (1.0 + random() * 2.0),
  encode(gen_random_bytes(32), 'hex')
FROM web3agents a
CROSS JOIN generate_series(1, 10);

