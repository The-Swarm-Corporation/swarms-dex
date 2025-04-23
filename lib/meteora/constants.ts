import { PublicKey } from "@solana/web3.js"

let FEE_OWNER: PublicKey;

if (!process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS) {
  throw new Error('SWARMS_TOKEN_ADDRESS is undefined');
}

FEE_OWNER = new PublicKey(process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS);

export const METEORA = {
  PROGRAM_ID: new PublicKey("M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K"),
  POOL_SEED: "pool",
  AUTHORITY_SEED: "authority",
  VAULT_SEED: "vault",
  FEE_OWNER: FEE_OWNER,
  // Standard fees (can be adjusted per pool)
  DEFAULT_TRADE_FEE_BPS: 0, // 0.25%
  OWNER_TRADE_FEE_BPS: 0, // 0.05%
  OWNER_WITHDRAW_FEE_BPS: 0, // 0%
}

// Minimum tick size for price impact protection
export const MIN_TICK_SIZE = 0.001 // 0.1%

// Maximum allowed slippage
export const MAX_SLIPPAGE_PERCENT = 5 // 5%

