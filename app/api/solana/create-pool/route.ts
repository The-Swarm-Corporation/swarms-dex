import { Connection, PublicKey, Transaction, Keypair, SystemProgram } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { 
  getAssociatedTokenAddress, 
  TOKEN_PROGRAM_ID, 
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { decrypt } from '@/lib/crypto';
import { 
  Liquidity,
  TxVersion,
  LIQUIDITY_STATE_LAYOUT_V4
} from '@raydium-io/raydium-sdk';
import { RAYDIUM_PROGRAM_ID } from '@/lib/raydium/constants';
import { BN } from '@project-serum/anchor';
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { Clmm } from '@raydium-io/raydium-sdk';
import Decimal from 'decimal.js';
import { ComputeBudgetProgram } from '@solana/web3.js';

const RPC_URL = process.env.RPC_URL as string;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Initialize PublicKeys
const SWARMS_PUMP_ADDRESS = new PublicKey(process.env.NEXT_PUBLIC_SWARMS_PLATFORM_TEST_ADDRESS!);
const SWARMS_TOKEN_ADDRESS = new PublicKey(process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS!);
const RAYDIUM_V4_FEE_ACCOUNT = new PublicKey("7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// Constants
const TOKEN_DECIMALS = 6;
const INITIAL_VIRTUAL_SWARMS = 500; // 500 SWARMS virtual reserve
const INITIAL_TOKEN_SUPPLY = 1_073_000_191; // 1,073,000,191 tokens
const K_VALUE = INITIAL_TOKEN_SUPPLY * INITIAL_VIRTUAL_SWARMS; // k = 1,073,000,191 * 500

// Calculate price for given SWARMS amount using bonding curve formula
function calculatePrice(swarmsAmount: number): number {
  // Price is the derivative of the bonding curve y = INITIAL_TOKEN_SUPPLY - K_VALUE/(INITIAL_VIRTUAL_SWARMS + x)
  // dy/dx = K_VALUE/(INITIAL_VIRTUAL_SWARMS + x)^2
  const price = K_VALUE / Math.pow(INITIAL_VIRTUAL_SWARMS + swarmsAmount, 2);
  console.log('Price calculation:', {
    swarmsAmount,
    price,
    formula: `${K_VALUE}/(${INITIAL_VIRTUAL_SWARMS} + ${swarmsAmount})^2`,
    initialVirtualSwarms: INITIAL_VIRTUAL_SWARMS,
    kValue: K_VALUE
  });
  return Math.max(price, 0.000001); // Ensure minimum positive price
}

// Calculate tokens for given SWARMS amount using bonding curve formula
function calculateTokenAmount(swarmsAmount: number): number {
  // y = INITIAL_TOKEN_SUPPLY - K_VALUE/(INITIAL_VIRTUAL_SWARMS + x)
  return INITIAL_TOKEN_SUPPLY - (K_VALUE / (INITIAL_VIRTUAL_SWARMS + swarmsAmount));
}

export async function POST(req: Request) {
  try {
    const { 
      userPublicKey,
      tokenMint,
      swarmsAmount  // Optional additional SWARMS
    } = await req.json();

    if (!userPublicKey || !tokenMint) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    const connection = new Connection(RPC_URL, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 180000
    });

    // Get bonding curve keys from database
    console.log('Looking for bonding curve keys for token:', tokenMint);
    const { data: bondingCurveKeys, error: keysError } = await supabase
      .from('bonding_curve_keys')
      .select('*')
      .eq('metadata->>mint_address', tokenMint)
      .maybeSingle();


    if (keysError) {
      console.error('Database error when retrieving bonding curve keys:', keysError);
      throw new Error('Database error when retrieving bonding curve keys');
    }

    if (!bondingCurveKeys) {
      console.error('No bonding curve keys found for token:', tokenMint);
      throw new Error('No bonding curve keys found for this token. Please ensure the token was created properly.');
    }

    console.log('Found bonding curve key:', bondingCurveKeys.public_key);

    // Decrypt private key and create keypair
    const privateKeyBase64 = await decrypt(bondingCurveKeys.encrypted_private_key);
    const privateKey = Buffer.from(privateKeyBase64, 'base64');
    const bondingCurveKeypair = Keypair.fromSecretKey(privateKey);

    // Get all ATAs
    const userPubkey = new PublicKey(userPublicKey);
    const bondingCurveSwarmsATA = await getAssociatedTokenAddress(
      SWARMS_TOKEN_ADDRESS,
      bondingCurveKeypair.publicKey
    );
    const bondingCurveTokenATA = await getAssociatedTokenAddress(
      new PublicKey(tokenMint),
      bondingCurveKeypair.publicKey
    );

    // Create transaction
    const transaction = new Transaction();
    transaction.feePayer = userPubkey;

    // Check if ATAs exist and create if needed
    let needSwarmsATA = false;
    let needTokenATA = false;

    try {
      await connection.getTokenAccountBalance(bondingCurveSwarmsATA);
    } catch (e) {
      needSwarmsATA = true;
    }

    try {
      await connection.getTokenAccountBalance(bondingCurveTokenATA);
    } catch (e) {
      needTokenATA = true;
    }

    // Add ATA creation instructions if needed
    if (needSwarmsATA) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          userPubkey,
          bondingCurveSwarmsATA,
          bondingCurveKeypair.publicKey,
          SWARMS_TOKEN_ADDRESS
        )
      );
    }

    if (needTokenATA) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          userPubkey,
          bondingCurveTokenATA,
          bondingCurveKeypair.publicKey,
          new PublicKey(tokenMint)
        )
      );
    }

    // Get token balances
    const bondingCurveSwarms = await connection.getTokenAccountBalance(bondingCurveSwarmsATA);
    console.log('Current bonding curve SWARMS:', bondingCurveSwarms.value.uiAmount);

    const bondingCurveTokens = await connection.getTokenAccountBalance(bondingCurveTokenATA);
    console.log('Bonding curve token balance:', bondingCurveTokens.value.uiAmount);

    // Verify we have enough tokens for pool
    if (bondingCurveTokens.value.amount === '0') {
      throw new Error('No tokens available in bonding curve account');
    }

    if (bondingCurveSwarms.value.amount === '0' && (!swarmsAmount || Number(swarmsAmount) === 0)) {
      throw new Error('No SWARMS available and no additional deposit specified');
    }

    // If user wants to add more SWARMS
    let additionalAmount = BigInt(0);
    if (swarmsAmount && Number(swarmsAmount) > 0) {
      // Verify user has enough SWARMS
      const userSwarmsATA = await getAssociatedTokenAddress(
        SWARMS_TOKEN_ADDRESS,
        userPubkey
      );
      
      try {
        const userSwarms = await connection.getTokenAccountBalance(userSwarmsATA);
        if (Number(userSwarms.value.amount) < Number(swarmsAmount) * (10 ** TOKEN_DECIMALS)) {
          throw new Error(`Insufficient SWARMS balance. Required: ${swarmsAmount}, Available: ${userSwarms.value.uiAmount}`);
        }
      } catch (e) {
        throw new Error('Could not verify SWARMS balance. Please ensure you have enough SWARMS tokens.');
      }

      additionalAmount = BigInt(swarmsAmount) * BigInt(10 ** TOKEN_DECIMALS);
      const feeAmount = additionalAmount / BigInt(100); // 1% fee
      const reserveAmount = additionalAmount - feeAmount; // 99% for reserve

      // Get user and pump ATAs
      const pumpSwarmsATA = await getAssociatedTokenAddress(
        SWARMS_TOKEN_ADDRESS,
        SWARMS_PUMP_ADDRESS
      );

      // Add SWARMS transfer instructions
      transaction.add(
        // Transfer 99% to bonding curve
        createTransferInstruction(
          userSwarmsATA,
          bondingCurveSwarmsATA,
          userPubkey,
          reserveAmount
        ),
        // Transfer 1% fee
        createTransferInstruction(
          userSwarmsATA,
          pumpSwarmsATA,
          userPubkey,
          feeAmount
        )
      );
    }

    // Calculate total SWARMS amount (current + additional)
    const totalSwarmsAmount = BigInt(bondingCurveSwarms.value.amount) + 
      (additionalAmount > BigInt(0) ? additionalAmount : BigInt(0));

    // Calculate initial price using bonding curve formula
    const swarmsInPool = Number(totalSwarmsAmount) / (10 ** TOKEN_DECIMALS);
    const initialPrice = calculatePrice(swarmsInPool);
    console.log('Pool creation details:', {
      swarmsInPool,
      initialPrice,
      tokensAvailable: calculateTokenAmount(swarmsInPool)
    });

    // Get latest blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');

    // Create single transaction for everything
    const poolTx = new Transaction();
    poolTx.recentBlockhash = blockhash;
    poolTx.lastValidBlockHeight = lastValidBlockHeight;
    poolTx.feePayer = userPubkey;

    // Add compute budget instruction first
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ 
      units: 1000000 
    });
    poolTx.add(modifyComputeUnits);

    // Get pool creation instructions from SDK
    const poolKeyData = await Clmm.makeCreatePoolInstructionSimple({
      connection,
      makeTxVersion: TxVersion.V0,
      programId: new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"),
      owner: bondingCurveKeypair.publicKey,
      payer: userPubkey,
      mint1: {
        mint: SWARMS_TOKEN_ADDRESS,
        decimals: TOKEN_DECIMALS,
        programId: TOKEN_PROGRAM_ID
      },
      mint2: {
        mint: new PublicKey(tokenMint),
        decimals: TOKEN_DECIMALS,
        programId: TOKEN_PROGRAM_ID
      },
      ammConfig: {
        id: new PublicKey("G95xK9bwrunnb4tLZGnHKe9Xj45eHpQxByVGpBHKKbhh"),  // Standard Raydium mainnet config
        index: 0,
        protocolFeeRate: 0.0025,  // 0.25% protocol fee
        tradeFeeRate: 0.0025,     // 0.25% trade fee
        tickSpacing: 60,          // Standard tick spacing for stable pairs
        fundFeeRate: 0.01,        // Platform fee
        fundOwner: SWARMS_PUMP_ADDRESS.toString(),
        description: "Standard CLMM Pool"
      },
      initialPrice: new Decimal(1),  // Start with 1:1 price ratio
      startTime: new BN(Math.floor(Date.now() / 1000)),
      computeBudgetConfig: {
        units: 400000,
        microLamports: 5000
      }
    });

    // Add pool creation instructions
    for (const ix of poolKeyData.innerTransactions) {
      ix.instructions.forEach((instruction, index) => {
        // Log instruction details for debugging
        console.log(`Instruction ${index}:`, {
          programId: instruction.programId.toString(),
          keys: instruction.keys.map(k => ({
            pubkey: k.pubkey.toString(),
            isSigner: k.isSigner,
            isWritable: k.isWritable
          })),
          data: instruction.data.length > 0 ? 'Has Data' : 'No Data'
            });
            
        // Only add if it's not a System Program instruction with data
        if (instruction.programId.equals(SystemProgram.programId) && instruction.data.length > 0) {
          console.log('Skipping System Program instruction with data');
          return;
          }
          poolTx.add(instruction);
      });
    }

    // Sign with bonding curve keypair
    poolTx.partialSign(bondingCurveKeypair);

    // Log final transaction details
    console.log('Final transaction:', {
      recentBlockhash: blockhash,
      instructions: poolTx.instructions.length,
      sizeInBytes: poolTx.serialize({ requireAllSignatures: false }).length,
      instructionTypes: poolTx.instructions.map(ix => ix.programId.toString())
    });

    // Return transaction for user to sign
    return new Response(JSON.stringify({ 
      transaction: poolTx.serialize({ 
        requireAllSignatures: false,
        verifySignatures: false 
      }).toString('base64'),
      poolKeys: poolKeyData.address,
      swarmsAmount: totalSwarmsAmount.toString()
    }), { status: 200 });

  } catch (error) {
    console.error('Error creating pool transaction:', error);
    logger.error("Error creating pool transaction", error as Error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Failed to create pool transaction" 
    }), { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { 
      signedTransaction,
      tokenMint,
      bondingCurveAddress,
      poolKeys,
      swarmsAmount
    } = await req.json();
    
    const connection = new Connection(RPC_URL, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 180000
    });

    // Send and confirm the single transaction
    const tx = Transaction.from(Buffer.from(signedTransaction, 'base64'));
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 5
      });

    // Confirm with retry logic
    let confirmed = false;
    for (let i = 0; i < 3; i++) {
      try {
        const confirmation = await connection.confirmTransaction({
          signature,
          blockhash: tx.recentBlockhash!,
          lastValidBlockHeight: tx.lastValidBlockHeight!
        }, 'confirmed');
        
        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }
        confirmed = true;
        console.log('Transaction confirmed:', signature);
        break;
      } catch (error) {
        if (i === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!confirmed) {
      throw new Error('Failed to confirm transaction');
    }

    // Update database
    const { error: updateError } = await supabase
      .from('web3agents')
      .update({
        swarms_reserve: swarmsAmount,
        metadata: {
          pool_keys: poolKeys,
          initial_price: INITIAL_TOKEN_SUPPLY,
          initial_virtual_swarms: INITIAL_VIRTUAL_SWARMS,
          initial_token_supply: INITIAL_TOKEN_SUPPLY,
          k_value: K_VALUE
        }
      })
      .eq('mint_address', tokenMint);

    if (updateError) {
      logger.error("Failed to update agent", updateError);
      throw new Error("Failed to update agent");
    }

    return new Response(JSON.stringify({ signature }), { status: 200 });

  } catch (error) {
    console.error('Error processing pool transaction:', error);
    logger.error("Error processing pool transaction", error as Error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Failed to process pool transaction" 
    }), { status: 500 });
  }
} 
