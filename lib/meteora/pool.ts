import { Connection, PublicKey, Transaction } from "@solana/web3.js"
import AmmImpl, { MAINNET_POOL } from "@mercurial-finance/dynamic-amm-sdk"
import { BN } from "@project-serum/anchor"
import { logger } from "../logger"

interface CreatePoolParams {
  tokenAMint: PublicKey
  tokenBMint: PublicKey
  initialLiquidityA: bigint
  initialLiquidityB: bigint
  userWallet: PublicKey
}

export async function createPool({
  tokenAMint,
  tokenBMint,
  initialLiquidityA,
  initialLiquidityB,
  userWallet,
}: CreatePoolParams) {
  try {
    const connection = new Connection(process.env.RPC_URL as string, "confirmed")
    const meteoraPool = await AmmImpl.create(connection, MAINNET_POOL.USDC_SOL)

    // Get deposit quote
    const { poolTokenAmountOut, tokenAInAmount, tokenBInAmount } = meteoraPool.getDepositQuote(
      new BN(initialLiquidityA.toString()),
      new BN(initialLiquidityB.toString()),
      false,
      0.01
    )

    // Create pool deposit transaction
    const transaction = new Transaction()
    const depositTx = await meteoraPool.deposit(
      userWallet,
      tokenAInAmount,
      tokenBInAmount,
      poolTokenAmountOut
    )
    transaction.add(depositTx)

    logger.info("Created Meteora pool transaction", {
      tokenA: tokenAMint.toString(),
      tokenB: tokenBMint.toString(),
      liquidityA: initialLiquidityA.toString(),
      liquidityB: initialLiquidityB.toString(),
    })

    return {
      transaction,
      poolAddress: meteoraPool.address,
    }
  } catch (error) {
    logger.error("Failed to create Meteora pool", error as Error)
    throw error
  }
} 