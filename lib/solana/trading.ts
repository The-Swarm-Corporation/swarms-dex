import { 
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ParsedAccountData
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import { logger } from '../logger'
import { 
  deriveBondingCurveVault, 
  deriveBondingCurveState,
  createSwapTokensInstruction,
  BONDING_CURVE_PROGRAM_ID
} from './bonding-curve'

interface BondingCurveConfig {
  basePrice: number
  reserveRatio: number
  slope: number
  supplyMultiplier: number
}

export const DEFAULT_BONDING_CURVE: BondingCurveConfig = {
  basePrice: 0.00001,
  reserveRatio: 0.2,
  slope: 0.0000001,
  supplyMultiplier: 0.0000001
}

interface ParsedMintInfo {
  data: {
    parsed: {
      info: {
        supply: string;
      };
      type: string;
    };
    program: string;
    space: number;
  };
}

function isParsedMintInfo(data: any): data is ParsedMintInfo {
  return data?.data?.parsed?.info?.supply !== undefined;
}

export class TokenTrading {
  private connection: Connection
  private bondingCurve: BondingCurveConfig

  constructor(
    connection: Connection,
    bondingCurve: BondingCurveConfig = DEFAULT_BONDING_CURVE
  ) {
    this.connection = connection
    this.bondingCurve = bondingCurve
  }

  calculatePrice(currentSupply: bigint, buyAmount: bigint = BigInt(0)): number {
    const INITIAL_SUPPLY = BigInt(1_000_000_000)
    const supplyRatio = Number(currentSupply + buyAmount) / Number(INITIAL_SUPPLY)
    const { basePrice, slope, supplyMultiplier, reserveRatio } = this.bondingCurve
    
    const demandImpact = supplyRatio * supplyMultiplier
    const price = basePrice * 
      Math.pow(1 + (supplyRatio * slope), reserveRatio) * 
      (1 + demandImpact)

    return price
  }

  async buyTokens(
    mintAddress: string,
    buyer: PublicKey,
    amount: bigint,
    maxPrice: number
  ): Promise<{ transaction: Transaction; price: number }> {
    try {
      logger.info('Processing buy order', { 
        buyer: buyer.toString(),
        mint: mintAddress,
        amount: amount.toString() 
      })

      const mintPubkey = new PublicKey(mintAddress)

      // Get current supply
      const mintInfo = await this.connection.getParsedAccountInfo(mintPubkey)
      if (!mintInfo.value || !isParsedMintInfo(mintInfo.value)) {
        throw new Error('Invalid mint account data')
      }

      const supply = BigInt(mintInfo.value.data.parsed.info.supply)
      const price = this.calculatePrice(supply, amount)
      
      if (price > maxPrice) {
        throw new Error(`Price ${price} exceeds max price ${maxPrice}`)
      }

      // Get PDA accounts
      const [vaultPubkey] = await deriveBondingCurveVault(mintPubkey)
      const [statePubkey] = await deriveBondingCurveState(mintPubkey)
      
      // Get token accounts
      const userTokenAccount = await getAssociatedTokenAddress(
        mintPubkey,
        buyer
      )
      
      const bondingCurveTokenAccount = await getAssociatedTokenAddress(
        mintPubkey,
        vaultPubkey,
        true
      )

      const bondingCurveReserve = await getAssociatedTokenAddress(
        mintPubkey,
        vaultPubkey,
        true
      )

      // Create transaction
      const transaction = new Transaction()
      
      transaction.add(
        createSwapTokensInstruction({
          mint: mintPubkey,
          bondingCurveState: statePubkey,
          bondingCurveVault: vaultPubkey,
          bondingCurveTokenAccount,
          bondingCurveReserve,
          userTokenAccount,
          userReserveAccount: buyer,
          user: buyer,
          amount,
          minOutput: BigInt(Math.floor(price * Number(amount) * 0.95)), // 5% slippage
          isBuy: true
        })
      )

      // Get blockhash
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.lastValidBlockHeight = lastValidBlockHeight

      logger.info('Buy transaction prepared', {
        price,
        amount: amount.toString(),
        mint: mintAddress
      })

      return {
        transaction,
        price
      }
    } catch (error) {
      logger.error('Error processing buy order', error instanceof Error ? error : new Error('Unknown error'))
      throw error
    }
  }

  async sellTokens(
    mintAddress: string,
    seller: PublicKey,
    amount: bigint,
    minPrice: number
  ): Promise<{ transaction: Transaction; price: number }> {
    try {
      logger.info('Processing sell order', {
        seller: seller.toString(),
        mint: mintAddress,
        amount: amount.toString()
      })

      const mintPubkey = new PublicKey(mintAddress)

      // Get current supply
      const mintInfo = await this.connection.getParsedAccountInfo(mintPubkey)
      if (!mintInfo.value || !isParsedMintInfo(mintInfo.value)) {
        throw new Error('Invalid mint account data')
      }

      const supply = BigInt(mintInfo.value.data.parsed.info.supply)
      const price = this.calculatePrice(supply - amount) * 0.95 // 5% slippage
      
      if (price < minPrice) {
        throw new Error(`Price ${price} below min price ${minPrice}`)
      }

      // Get PDA accounts
      const [vaultPubkey] = await deriveBondingCurveVault(mintPubkey)
      const [statePubkey] = await deriveBondingCurveState(mintPubkey)
      
      // Get token accounts
      const userTokenAccount = await getAssociatedTokenAddress(
        mintPubkey,
        seller
      )
      
      const bondingCurveTokenAccount = await getAssociatedTokenAddress(
        mintPubkey,
        vaultPubkey,
        true
      )

      const bondingCurveReserve = await getAssociatedTokenAddress(
        mintPubkey,
        vaultPubkey,
        true
      )

      // Create transaction
      const transaction = new Transaction()
      
      transaction.add(
        createSwapTokensInstruction({
          mint: mintPubkey,
          bondingCurveState: statePubkey,
          bondingCurveVault: vaultPubkey,
          bondingCurveTokenAccount,
          bondingCurveReserve,
          userTokenAccount,
          userReserveAccount: seller,
          user: seller,
          amount,
          minOutput: BigInt(Math.floor(price * Number(amount))),
          isBuy: false
        })
      )

      // Get blockhash
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.lastValidBlockHeight = lastValidBlockHeight

      logger.info('Sell transaction prepared', {
        price,
        amount: amount.toString(),
        mint: mintAddress
      })

      return {
        transaction,
        price
      }
    } catch (error) {
      logger.error('Error processing sell order', error instanceof Error ? error : new Error('Unknown error'))
      throw error
    }
  }

  async getCurrentPrice(mintAddress: string): Promise<number> {
    try {
      const mintInfo = await this.connection.getParsedAccountInfo(new PublicKey(mintAddress))
      if (!mintInfo.value || !isParsedMintInfo(mintInfo.value)) {
        throw new Error('Invalid mint account data')
      }

      const supply = BigInt(mintInfo.value.data.parsed.info.supply)
      return this.calculatePrice(supply)
    } catch (error) {
      logger.error('Error getting current price', error instanceof Error ? error : new Error('Unknown error'))
      throw error
    }
  }
}

