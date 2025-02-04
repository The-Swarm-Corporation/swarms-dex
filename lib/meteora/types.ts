import type { PublicKey } from "@solana/web3.js"

export interface MeteoraPool {
  address: PublicKey
  tokenAMint: PublicKey
  tokenBMint: PublicKey
  tokenABalance: bigint
  tokenBBalance: bigint
  fees: {
    tradeFee: number
    ownerTradeFee: number
    ownerWithdrawFee: number
  }
}

export interface SwapParams {
  poolAddress: PublicKey
  tokenInMint: PublicKey
  tokenOutMint: PublicKey
  amountIn: bigint
  minAmountOut: bigint
}

export interface CreatePoolParams {
  tokenAMint: PublicKey
  tokenBMint: PublicKey
  initialLiquidityA: bigint
  initialLiquidityB: bigint
}

export interface PoolStats {
  volume24h: number
  tvl: number
  apy: number
}

