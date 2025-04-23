import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token"
import { BN } from '@project-serum/anchor';
import { METEORA } from "./constants"
import type { SwapParams, CreatePoolParams } from "./types"
import { logger } from "../logger"

export async function createSwapInstruction({
  poolAddress,
  tokenInMint,
  tokenOutMint,
  amountIn,
  minAmountOut,
  userWallet,
}: SwapParams & { userWallet: PublicKey }): Promise<TransactionInstruction> {
  try {
    // Derive pool authority PDA
    const [poolAuthority] = await PublicKey.findProgramAddress(
      [Buffer.from(METEORA.AUTHORITY_SEED), poolAddress.toBuffer()],
      METEORA.PROGRAM_ID,
    )

    // Get token accounts
    const userTokenInAccount = await getAssociatedTokenAddress(
      tokenInMint,
      userWallet,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )

    const userTokenOutAccount = await getAssociatedTokenAddress(
      tokenOutMint,
      userWallet,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )

    const poolTokenInVault = await getAssociatedTokenAddress(
      tokenInMint,
      poolAuthority,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )

    const poolTokenOutVault = await getAssociatedTokenAddress(
      tokenOutMint,
      poolAuthority,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )

    logger.info("Creating swap instruction", {
      pool: poolAddress.toString(),
      tokenIn: tokenInMint.toString(),
      tokenOut: tokenOutMint.toString(),
      amountIn: amountIn.toString(),
      minAmountOut: minAmountOut.toString(),
    })

    // Create the swap instruction
    return new TransactionInstruction({
      programId: METEORA.PROGRAM_ID,
      keys: [
        { pubkey: poolAddress, isSigner: false, isWritable: true },
        { pubkey: poolAuthority, isSigner: false, isWritable: false },
        { pubkey: userWallet, isSigner: true, isWritable: false },
        { pubkey: userTokenInAccount, isSigner: false, isWritable: true },
        { pubkey: userTokenOutAccount, isSigner: false, isWritable: true },
        { pubkey: poolTokenInVault, isSigner: false, isWritable: true },
        { pubkey: poolTokenOutVault, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([
        0x0, // Instruction index for swap
        ...new BN(amountIn.toString()).toArray("le", 8),
        ...new BN(minAmountOut.toString()).toArray("le", 8),
      ]),
    })
  } catch (error) {
    logger.error("Failed to create swap instruction", error as Error)
    throw error
  }
}

export async function createPoolInstruction({
  tokenAMint,
  tokenBMint,
  initialLiquidityA,
  initialLiquidityB,
  userWallet,
}: CreatePoolParams & { userWallet: PublicKey }): Promise<{
  instruction: TransactionInstruction
  poolAddress: PublicKey
}> {
  try {
    // Derive pool address
    const [poolAddress] = await PublicKey.findProgramAddress(
      [Buffer.from(METEORA.POOL_SEED), tokenAMint.toBuffer(), tokenBMint.toBuffer()],
      METEORA.PROGRAM_ID,
    )

    // Derive pool authority
    const [poolAuthority] = await PublicKey.findProgramAddress(
      [Buffer.from(METEORA.AUTHORITY_SEED), poolAddress.toBuffer()],
      METEORA.PROGRAM_ID,
    )

    // Get token accounts
    const userTokenAAccount = await getAssociatedTokenAddress(
      tokenAMint,
      userWallet,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )

    const userTokenBAccount = await getAssociatedTokenAddress(
      tokenBMint,
      userWallet,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )

    const poolTokenAVault = await getAssociatedTokenAddress(
      tokenAMint,
      poolAuthority,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )

    const poolTokenBVault = await getAssociatedTokenAddress(
      tokenBMint,
      poolAuthority,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )

    logger.info("Creating pool instruction", {
      pool: poolAddress.toString(),
      tokenA: tokenAMint.toString(),
      tokenB: tokenBMint.toString(),
      liquidityA: initialLiquidityA.toString(),
      liquidityB: initialLiquidityB.toString(),
    })

    const instruction = new TransactionInstruction({
      programId: METEORA.PROGRAM_ID,
      keys: [
        { pubkey: poolAddress, isSigner: false, isWritable: true },
        { pubkey: poolAuthority, isSigner: false, isWritable: false },
        { pubkey: userWallet, isSigner: true, isWritable: true },
        { pubkey: tokenAMint, isSigner: false, isWritable: false },
        { pubkey: tokenBMint, isSigner: false, isWritable: false },
        { pubkey: userTokenAAccount, isSigner: false, isWritable: true },
        { pubkey: userTokenBAccount, isSigner: false, isWritable: true },
        { pubkey: poolTokenAVault, isSigner: false, isWritable: true },
        { pubkey: poolTokenBVault, isSigner: false, isWritable: true },
        { pubkey: METEORA.FEE_OWNER, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([
        0x1, // Instruction index for create pool
        ...new BN(initialLiquidityA.toString()).toArray("le", 8),
        ...new BN(initialLiquidityB.toString()).toArray("le", 8),
        ...new BN(METEORA.DEFAULT_TRADE_FEE_BPS).toArray("le", 1),
        ...new BN(METEORA.OWNER_TRADE_FEE_BPS).toArray("le", 1),
        ...new BN(METEORA.OWNER_WITHDRAW_FEE_BPS).toArray("le", 1),
      ]),
    })

    return { instruction, poolAddress }
  } catch (error) {
    logger.error("Failed to create pool instruction", error as Error)
    throw error
  }
}

