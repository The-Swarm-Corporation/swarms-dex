import { PublicKey } from "@solana/web3.js"

export const METEORA = {
  PROGRAM_ID: new PublicKey("M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K"),
  POOL_SEED: "pool",
  AUTHORITY_SEED: "authority",
  VAULT_SEED: "vault",
  FEE_OWNER: new PublicKey("3XMrhbv989VxAMi3DErLV9eJht1pHppW5LbKxe9fkEFR"),
  // Standard fees (can be adjusted per pool)
  DEFAULT_TRADE_FEE_BPS: 25, // 0.25%
  OWNER_TRADE_FEE_BPS: 5, // 0.05%
  OWNER_WITHDRAW_FEE_BPS: 0, // 0%
}

// Minimum tick size for price impact protection
export const MIN_TICK_SIZE = 0.001 // 0.1%

// Maximum allowed slippage
export const MAX_SLIPPAGE_PERCENT = 5 // 5%

