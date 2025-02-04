import { 
  PublicKey, 
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import { BN } from '@project-serum/anchor';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

export const BONDING_CURVE_PROGRAM_ID = new PublicKey(
  // TODO: Deploy program and replace with actual program ID
  "BCurvxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
);

// PDA seed constants
export const VAULT_SEED = 'vault';
export const CURVE_SEED = 'curve';

export interface BondingCurveConfig {
  basePrice: number;
  reserveRatio: number;
  slope: number;
  supplyMultiplier: number;
}

export async function deriveBondingCurveVault(
  mint: PublicKey
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_SEED), mint.toBuffer()],
    BONDING_CURVE_PROGRAM_ID
  );
}

export async function deriveBondingCurveState(
  mint: PublicKey
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(CURVE_SEED), mint.toBuffer()],
    BONDING_CURVE_PROGRAM_ID
  );
}

export interface InitializeBondingCurveParams {
  mint: PublicKey;
  bondingCurveState: PublicKey;
  bondingCurveVault: PublicKey;
  bondingCurveTokenAccount: PublicKey;
  bondingCurveReserve: PublicKey;
  payer: PublicKey;
  initialSupply: bigint;
  basePrice: number;
  reserveRatio: number;
  slope: number;
  supplyMultiplier: number;
}

export function createInitializeBondingCurveInstruction(
  params: InitializeBondingCurveParams
): TransactionInstruction {
  const keys = [
    { pubkey: params.mint, isSigner: false, isWritable: true },
    { pubkey: params.bondingCurveState, isSigner: false, isWritable: true },
    { pubkey: params.bondingCurveVault, isSigner: false, isWritable: true },
    { pubkey: params.bondingCurveTokenAccount, isSigner: false, isWritable: true },
    { pubkey: params.bondingCurveReserve, isSigner: false, isWritable: true },
    { pubkey: params.payer, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(1 + 8 + 8 + 8 + 8 + 8);
  data.writeUInt8(0, 0); // Instruction index: 0 = initialize
  new BN(params.initialSupply.toString()).toBuffer().copy(data, 1);
  new BN(Math.floor(params.basePrice * 1e9)).toBuffer().copy(data, 9);
  new BN(Math.floor(params.reserveRatio * 1e9)).toBuffer().copy(data, 17);
  new BN(Math.floor(params.slope * 1e9)).toBuffer().copy(data, 25);
  new BN(Math.floor(params.supplyMultiplier * 1e9)).toBuffer().copy(data, 33);

  return new TransactionInstruction({
    keys,
    programId: BONDING_CURVE_PROGRAM_ID,
    data,
  });
}

export interface SwapTokensParams {
  mint: PublicKey;
  bondingCurveState: PublicKey;
  bondingCurveVault: PublicKey;
  bondingCurveTokenAccount: PublicKey;
  bondingCurveReserve: PublicKey;
  userTokenAccount: PublicKey;
  userReserveAccount: PublicKey;
  user: PublicKey;
  amount: bigint;
  minOutput: bigint;
  isBuy: boolean;
}

export function createSwapTokensInstruction(
  params: SwapTokensParams
): TransactionInstruction {
  const keys = [
    { pubkey: params.mint, isSigner: false, isWritable: false },
    { pubkey: params.bondingCurveState, isSigner: false, isWritable: true },
    { pubkey: params.bondingCurveVault, isSigner: false, isWritable: false },
    { pubkey: params.bondingCurveTokenAccount, isSigner: false, isWritable: true },
    { pubkey: params.bondingCurveReserve, isSigner: false, isWritable: true },
    { pubkey: params.userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: params.userReserveAccount, isSigner: false, isWritable: true },
    { pubkey: params.user, isSigner: true, isWritable: false }, // Only user signature needed
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(1 + 8 + 8 + 1);
  data.writeUInt8(1, 0); // Instruction index: 1 = swap
  new BN(params.amount.toString()).toBuffer().copy(data, 1);
  new BN(params.minOutput.toString()).toBuffer().copy(data, 9);
  data.writeUInt8(params.isBuy ? 1 : 0, 17); // 1 for buy, 0 for sell

  return new TransactionInstruction({
    keys,
    programId: BONDING_CURVE_PROGRAM_ID,
    data,
  });
} 