import { PublicKey } from "@solana/web3.js";

// Raydium Program IDs
export const RAYDIUM_PROGRAM_ID = new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");

// Seeds for PDA derivation
export const AMM_CONFIG_SEED = Buffer.from("amm_config");
export const LIQUIDITY_SEED = Buffer.from("liquidity");
export const LP_MINT_SEED = Buffer.from("lp_mint");
export const OPEN_ORDER_SEED = Buffer.from("open_orders");
export const TARGET_SEED = Buffer.from("target");
export const WITHDRAW_QUEUE_SEED = Buffer.from("withdraw_queue");
export const TEMP_LP_TOKEN_ACCOUNT_SEED = Buffer.from("temp_lp_token_account");

// Layout for liquidity state account
export const LIQUIDITY_STATE_LAYOUT_V4 = {
  version: 4,
  isInitialized: true,
  nonce: 0,
  // Add other layout fields as needed
}; 