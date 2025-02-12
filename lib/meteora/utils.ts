import { PublicKey } from "@solana/web3.js"
import { METEORA } from "./constants"

export function deriveCustomizablePermissionlessConstantProductPoolAddress(
  tokenAMint: PublicKey,
  tokenBMint: PublicKey,
  programId: PublicKey
): PublicKey {
  const [poolAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from(METEORA.POOL_SEED), tokenAMint.toBuffer(), tokenBMint.toBuffer()],
    programId
  )
  return poolAddress
}

export function calculatePoolPrice(
  tokenABalance: number,
  tokenBBalance: number,
  tokenADecimals: number = 6,
  tokenBDecimals: number = 6
): number {
  if (tokenABalance === 0) return 0
  
  const normalizedTokenA = tokenABalance / Math.pow(10, tokenADecimals)
  const normalizedTokenB = tokenBBalance / Math.pow(10, tokenBDecimals)
  
  return normalizedTokenB / normalizedTokenA
}

export function calculatePriceImpact(
  inputAmount: number,
  outputAmount: number,
  spotPrice: number
): number {
  const expectedOutput = inputAmount * spotPrice
  return ((expectedOutput - outputAmount) / expectedOutput) * 100
}

export function validatePoolPrice(
  poolPrice: number,
  recentTxPrice: number,
  threshold: number = 0.1 // 10% threshold
): boolean {
  if (poolPrice === 0 || recentTxPrice === 0) return false
  return Math.abs((poolPrice - recentTxPrice) / recentTxPrice) <= threshold
} 