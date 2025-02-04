import { type Connection, PublicKey, Transaction } from "@solana/web3.js"
import { createSwapInstruction, createPoolInstruction } from "./instructions"
import type { SwapParams, CreatePoolParams, MeteoraPool, PoolStats } from "./types"
import { METEORA, MAX_SLIPPAGE_PERCENT } from "./constants"
import { logger } from "../logger"

export class MeteoraService {
  private connection: Connection

  constructor(connection: Connection) {
    this.connection = connection
  }

  async createPool(params: CreatePoolParams & { userWallet: PublicKey }): Promise<{
    transaction: Transaction
    poolAddress: PublicKey
  }> {
    try {
      const { instruction, poolAddress } = await createPoolInstruction(params)

      const transaction = new Transaction()
      transaction.add(instruction)

      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.lastValidBlockHeight = lastValidBlockHeight
      transaction.feePayer = params.userWallet

      logger.info("Pool creation transaction prepared", {
        pool: poolAddress.toString(),
        tokenA: params.tokenAMint.toString(),
        tokenB: params.tokenBMint.toString(),
      })

      return { transaction, poolAddress }
    } catch (error) {
      logger.error("Failed to create pool transaction", error as Error)
      throw error
    }
  }

  async swap(params: SwapParams & { userWallet: PublicKey }): Promise<Transaction> {
    try {
      const instruction = await createSwapInstruction(params)

      const transaction = new Transaction()
      transaction.add(instruction)

      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.lastValidBlockHeight = lastValidBlockHeight
      transaction.feePayer = params.userWallet

      logger.info("Swap transaction prepared", {
        pool: params.poolAddress.toString(),
        tokenIn: params.tokenInMint.toString(),
        tokenOut: params.tokenOutMint.toString(),
        amountIn: params.amountIn.toString(),
      })

      return transaction
    } catch (error) {
      logger.error("Failed to create swap transaction", error as Error)
      throw error
    }
  }

  async getPool(poolAddress: PublicKey): Promise<MeteoraPool | null> {
    try {
      const accountInfo = await this.connection.getAccountInfo(poolAddress)
      if (!accountInfo) return null

      // Parse pool data
      const data = accountInfo.data
      const tokenAMint = new PublicKey(data.slice(0, 32))
      const tokenBMint = new PublicKey(data.slice(32, 64))
      const tokenABalance = data.readBigUInt64LE(64)
      const tokenBBalance = data.readBigUInt64LE(72)
      const tradeFee = data.readUInt16LE(80)
      const ownerTradeFee = data.readUInt16LE(82)
      const ownerWithdrawFee = data.readUInt16LE(84)

      return {
        address: poolAddress,
        tokenAMint,
        tokenBMint,
        tokenABalance,
        tokenBBalance,
        fees: {
          tradeFee,
          ownerTradeFee,
          ownerWithdrawFee,
        },
      }
    } catch (error) {
      logger.error("Failed to fetch pool", error as Error)
      return null
    }
  }

  async getPoolByTokens(tokenAMint: PublicKey, tokenBMint: PublicKey): Promise<MeteoraPool | null> {
    try {
      const [poolAddress] = await PublicKey.findProgramAddress(
        [Buffer.from(METEORA.POOL_SEED), tokenAMint.toBuffer(), tokenBMint.toBuffer()],
        METEORA.PROGRAM_ID,
      )

      return this.getPool(poolAddress)
    } catch (error) {
      logger.error("Failed to fetch pool by tokens", error as Error)
      return null
    }
  }

  async getPoolStats(poolAddress: PublicKey): Promise<PoolStats> {
    try {
      const pool = await this.getPool(poolAddress)
      if (!pool) throw new Error("Pool not found")

      // Calculate pool statistics
      // Note: In production, you would fetch this data from an indexer
      return {
        volume24h: 0, // Placeholder - implement indexer integration
        tvl: 0, // Placeholder - implement indexer integration
        apy: 0, // Placeholder - implement indexer integration
      }
    } catch (error) {
      logger.error("Failed to fetch pool stats", error as Error)
      throw error
    }
  }

  calculateMinimumAmountOut(
    amountIn: bigint,
    spotPrice: number,
    slippagePercent: number = MAX_SLIPPAGE_PERCENT,
  ): bigint {
    const expectedAmount = Number(amountIn) * spotPrice
    const minAmount = expectedAmount * (1 - slippagePercent / 100)
    return BigInt(Math.floor(minAmount))
  }
}

