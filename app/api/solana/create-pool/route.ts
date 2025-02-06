import { Connection, PublicKey, Transaction, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AnchorProvider } from "@project-serum/anchor";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { 
  getAssociatedTokenAddress, 
  TOKEN_PROGRAM_ID,
  getMint,
  createTransferInstruction
} from "@solana/spl-token";
import { decrypt } from '@/lib/crypto';
import { AmmImpl } from "@mercurial-finance/dynamic-amm-sdk";
import { 
  deriveCustomizablePermissionlessConstantProductPoolAddress,
  createProgram
} from "@mercurial-finance/dynamic-amm-sdk/dist/cjs/src/amm/utils";
import { BN } from '@project-serum/anchor';
import { ComputeBudgetProgram } from '@solana/web3.js';
import { sendAndConfirmTransaction } from "@solana/web3.js";

const RPC_URL = process.env.RPC_URL as string;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Initialize PublicKeys
const SWARMS_TOKEN_ADDRESS = new PublicKey(process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS!);
const SWARMS_PUMP_ADDRESS = new PublicKey(process.env.NEXT_PUBLIC_SWARMS_PLATFORM_TEST_ADDRESS!);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// Constants
const TOKEN_DECIMALS = 6;
const POOL_CREATION_BUFFER = 1.2; // 20% buffer for network congestion

// Add helper function to simulate and get cost
async function simulatePoolCreationCost(
  connection: Connection,
  bondingCurveKeypair: PublicKey,
  tokenMint: PublicKey,
): Promise<number> {
  // Set up pool parameters
  const baseDecimals = 6; // TOKEN_DECIMALS
  const quoteDecimals = 9; // SOL decimals
  const baseAmount = new BN(100).mul(new BN(10 ** baseDecimals)); // 100 base tokens
  const quoteAmount = new BN(0.001 * 10 ** quoteDecimals); // 0.001 SOL

  // Create simulation transaction
  const initPoolTx = await AmmImpl.createCustomizablePermissionlessConstantProductPool(
    connection,
    bondingCurveKeypair,
    tokenMint,
    SWARMS_TOKEN_ADDRESS,
    baseAmount,
    quoteAmount,
    {
      tradeFeeNumerator: new BN(2500),     // 0.25% fee (2500/10000)
      tradeFeeDenominator: new BN(10000),  // Setting denominator to 10,000 for percentage-based fees
      activationType: 1,                    // 1 = Timestamp activation
      activationPoint: null,                // Will activate immediately since null
      hasAlphaVault: false,
      padding: Array(32).fill(0)
    },
    {
      cluster: 'mainnet-beta'
    }
  );

  // Add compute budget instruction
  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 });
  initPoolTx.instructions = [modifyComputeUnits, ...initPoolTx.instructions];
  initPoolTx.feePayer = bondingCurveKeypair;

  // Get latest blockhash
  const { blockhash } = await connection.getLatestBlockhash('finalized');
  initPoolTx.recentBlockhash = blockhash;

  // Simulate transaction
  const simulation = await connection.simulateTransaction(initPoolTx);
  
  if (simulation.value.err) {
    throw new Error(`Pool creation simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }

  // Calculate required SOL based on simulation
  const estimatedFee = simulation.value.unitsConsumed 
    ? (simulation.value.unitsConsumed * 5000) / 10 ** 6  // Assuming default 5000 microlamports per CU
    : 0.01; // Fallback estimate of 0.01 SOL

  // Add rent exemption costs for any accounts that will be created
  const rentExempt = await connection.getMinimumBalanceForRentExemption(1024); // Approximate size for pool accounts
  const totalRentExempt = (rentExempt * 3) / LAMPORTS_PER_SOL; // Multiple accounts might be created

  // Return total cost with buffer
  return (estimatedFee + totalRentExempt) * POOL_CREATION_BUFFER;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tokenMint = searchParams.get('tokenMint');
    const userPublicKey = searchParams.get('userPublicKey');

    if (!tokenMint || !userPublicKey) {
      return new Response(JSON.stringify({ error: "Missing required parameters" }), { status: 400 });
    }

    const connection = new Connection(RPC_URL, {
      commitment: 'confirmed'
    });

    // Get bonding curve keys from database
    const { data: bondingCurveKeys, error: keysError } = await supabase
      .from('bonding_curve_keys')
      .select('*')
      .eq('metadata->>mint_address', tokenMint)
      .maybeSingle();

    if (keysError || !bondingCurveKeys) {
      throw new Error('Failed to retrieve bonding curve keys');
    }

    // Get cost estimate
    const estimatedCost = await simulatePoolCreationCost(
      connection,
      new PublicKey(bondingCurveKeys.public_key),
      new PublicKey(tokenMint)
    );

    return new Response(JSON.stringify({ 
      estimatedCost,
      minimumRequired: estimatedCost,
      recommendedAmount: estimatedCost * 1.1 // Add 10% extra buffer
    }), { status: 200 });

  } catch (error) {
    console.error('Error estimating pool creation cost:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Failed to estimate pool creation cost" 
    }), { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { 
      userPublicKey,
      tokenMint,
      swarmsAmount,  // Optional additional SWARMS
      createPool     // Flag to indicate if we should create the pool
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

    if (keysError || !bondingCurveKeys) {
      throw new Error('Failed to retrieve bonding curve keys');
    }

    // Decrypt private key and create keypair
    const privateKeyBase64 = await decrypt(bondingCurveKeys.encrypted_private_key);
    const privateKey = Buffer.from(privateKeyBase64, 'base64');
    const bondingCurveKeypair = Keypair.fromSecretKey(privateKey);

    // Get token decimals
    const baseMintAccount = await getMint(connection, new PublicKey(tokenMint));
    const baseDecimals = baseMintAccount.decimals;
    const quoteDecimals = TOKEN_DECIMALS; // SWARMS decimals

    // Get bonding curve's token accounts
    const bondingCurveTokenATA = await getAssociatedTokenAddress(
      new PublicKey(tokenMint),
      bondingCurveKeypair.publicKey,
      false
    );

    const bondingCurveSwarmsATA = await getAssociatedTokenAddress(
      SWARMS_TOKEN_ADDRESS,
      bondingCurveKeypair.publicKey,
      false
    );

    // Get token account balances
    const baseTokenAccount = await connection.getTokenAccountBalance(bondingCurveTokenATA);
    const quoteTokenAccount = await connection.getTokenAccountBalance(bondingCurveSwarmsATA);

    // Calculate and transfer 1% fee before pool creation
    const pumpSwarmsATA = await getAssociatedTokenAddress(
      SWARMS_TOKEN_ADDRESS,
      SWARMS_PUMP_ADDRESS,
      false
    );

    const swarmsBalance = new BN(quoteTokenAccount.value.amount);
    const feeAmount = swarmsBalance.divn(100); // 1% fee
    const remainingAmount = swarmsBalance.sub(feeAmount);

    // Create transaction for fee transfer
    const feeTx = new Transaction();
    
    // Add compute budget instructions
    const feeComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 });
    const feePriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 });
    feeTx.add(feeComputeUnits, feePriorityFee);

    // Transfer 1% fee to pump
    feeTx.add(
      createTransferInstruction(
        bondingCurveSwarmsATA,
        pumpSwarmsATA,
        bondingCurveKeypair.publicKey,
        feeAmount.toNumber()
      )
    );

    // Send and confirm fee transaction
    feeTx.feePayer = bondingCurveKeypair.publicKey;
    feeTx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;
    
    const feeTxSignature = await sendAndConfirmTransaction(
      connection,
      feeTx,
      [bondingCurveKeypair],
      { commitment: 'confirmed' }
    );

    console.log('Fee transfer complete:', {
      signature: feeTxSignature,
      feeAmount: feeAmount.toString(),
      remainingAmount: remainingAmount.toString()
    });

    // Set up pool parameters using remaining balance after fee
    const baseAmount = new BN(baseTokenAccount.value.amount);
    const quoteAmount = remainingAmount; // Use remaining amount after fee

    console.log('\nPool creation parameters:', {
      baseToken: tokenMint,
      baseDecimals,
      baseAmount: baseAmount.toString(),
      quoteToken: SWARMS_TOKEN_ADDRESS.toString(),
      quoteDecimals,
      quoteAmount: quoteAmount.toString(),
      baseAmountInBN: baseAmount instanceof BN ? 'Valid BN' : 'Not BN',
      quoteAmountInBN: quoteAmount instanceof BN ? 'Valid BN' : 'Not BN'
    });

    // Create customization parameters
    const customizeParam = {
      tradeFeeNumerator: new BN(2500),     // 0.25% fee (2500/10000)
      tradeFeeDenominator: new BN(10000),  // Setting denominator to 10,000 for percentage-based fees
      activationType: 1,                    // 1 = Timestamp activation
      activationPoint: null,                // Will activate immediately since null
      hasAlphaVault: false,
      padding: Array(90).fill(0)           // Required padding (90 bytes as per SDK)
    };

    console.log('Pool customization parameters:', {
      tradeFeeNumerator: customizeParam.tradeFeeNumerator.toString(),
      feePercentage: `${(Number(customizeParam.tradeFeeNumerator) / 10000 * 100).toFixed(4)}%`,
      activationType: customizeParam.activationType,
      activationPoint: customizeParam.activationPoint,
      hasAlphaVault: customizeParam.hasAlphaVault
    });

    // Create pool initialization transaction
    const initPoolTx = await AmmImpl.createCustomizablePermissionlessConstantProductPool(
      connection,
      bondingCurveKeypair.publicKey,
      new PublicKey(tokenMint),
      SWARMS_TOKEN_ADDRESS,
      baseAmount,
      quoteAmount,
      customizeParam,
      {
        cluster: 'mainnet-beta'
      }
    );

    // Derive and log pool address
    const poolKey = deriveCustomizablePermissionlessConstantProductPoolAddress(
      new PublicKey(tokenMint),
      SWARMS_TOKEN_ADDRESS,
      createProgram(connection).ammProgram.programId,
    );
    console.log('\nExpected pool address:', poolKey.toString());

    // Add compute budget instructions first
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 });
    initPoolTx.instructions = [modifyComputeUnits, addPriorityFee, ...initPoolTx.instructions];

    // Set version to legacy for compatibility
    initPoolTx.feePayer = bondingCurveKeypair.publicKey;
    
    // Get latest blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
    initPoolTx.recentBlockhash = blockhash;
    initPoolTx.lastValidBlockHeight = lastValidBlockHeight + 150;

    // Simulate to get cost estimate
    const simulation = await connection.simulateTransaction(initPoolTx);
    
    console.log('\nSimulation results:', {
      error: simulation.value.err,
      unitsConsumed: simulation.value.unitsConsumed,
      logs: simulation.value.logs,
    });

    if (simulation.value.err) {
      throw new Error(`Pool creation simulation failed: ${JSON.stringify(simulation.value.err)}`);
    }
    
    // Calculate estimated fees
    // Each compute unit costs 5000 microlamports (0.000005 lamports)
    const estimatedFee = simulation.value.unitsConsumed 
      ? (simulation.value.unitsConsumed * 5000 / 1_000_000) / LAMPORTS_PER_SOL  // First convert microlamports to lamports, then to SOL
      : 0.01; // Fallback estimate of 0.01 SOL
    
    // Add rent exemption costs for any accounts that will be created
    // Pool account needs about 165 bytes, token accounts need about 165 bytes each
    const poolAccountRent = await connection.getMinimumBalanceForRentExemption(165);
    const tokenAccountRent = await connection.getMinimumBalanceForRentExemption(165);
    
    // We need rent for: 1 pool account + 2 token accounts
    const totalRentExempt = (poolAccountRent + (tokenAccountRent * 2)) / LAMPORTS_PER_SOL;

    // Add 20% buffer for potential congestion
    const bufferMultiplier = 1.2;
    const totalRequired = (estimatedFee + totalRentExempt) * bufferMultiplier;
    const bondingCurveBalance = await connection.getBalance(bondingCurveKeypair.publicKey);
    const hasEnoughBalance = bondingCurveBalance >= totalRequired * LAMPORTS_PER_SOL;

    // Log the cost breakdown
    console.log('\nPool creation cost breakdown:', {
      computeUnits: simulation.value.unitsConsumed,
      estimatedFee: estimatedFee.toFixed(6),
      rentExempt: totalRentExempt.toFixed(6),
      totalRequired: totalRequired.toFixed(6),
      currentBalance: (bondingCurveBalance / LAMPORTS_PER_SOL).toFixed(6),
      hasEnoughBalance
    });

    // If this is just a simulation request
    if (!createPool) {
      const costInfo = {
        bondingCurveAddress: bondingCurveKeypair.publicKey.toString(),
        estimatedFeeSol: estimatedFee,
        rentExemptSol: totalRentExempt,
        recommendedSol: totalRequired,
        currentBondingCurveBalance: bondingCurveBalance / LAMPORTS_PER_SOL,
        additionalSolNeeded: Math.max(0, (totalRequired * LAMPORTS_PER_SOL - bondingCurveBalance) / LAMPORTS_PER_SOL),
        readyToProceed: hasEnoughBalance,
        simulationStatus: 'Success'
      };

      return new Response(JSON.stringify(costInfo), { status: 200 });
    }

    // Check if we have enough balance to proceed
    if (!hasEnoughBalance) {
      const additionalSolNeeded = (totalRequired * LAMPORTS_PER_SOL - bondingCurveBalance) / LAMPORTS_PER_SOL;
      return new Response(JSON.stringify({ 
        error: `Insufficient SOL balance. Need ${totalRequired.toFixed(4)} SOL but have ${(bondingCurveBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
        additionalSolNeeded,
        costBreakdown: {
          estimatedFee: estimatedFee.toFixed(6),
          rentExempt: totalRentExempt.toFixed(6),
          totalRequired: totalRequired.toFixed(6),
          currentBalance: (bondingCurveBalance / LAMPORTS_PER_SOL).toFixed(6)
        }
      }), { status: 402 }); // 402 Payment Required
    }

    // If we have enough SOL, proceed with pool creation
    console.log('\nProceeding with pool creation...');
    
    // Derive the expected pool address before sending transaction
    const expectedPoolKey = deriveCustomizablePermissionlessConstantProductPoolAddress(
      new PublicKey(tokenMint),
      SWARMS_TOKEN_ADDRESS,
      createProgram(connection).ammProgram.programId,
    );
    console.log('Expected pool address:', expectedPoolKey.toString());

    // Sign and send the transaction
    const signature = await sendAndConfirmTransaction(
      connection,
      initPoolTx,
      [bondingCurveKeypair],
      {
        commitment: 'confirmed',
        maxRetries: 5
      }
    );

    // Get the transaction info
    const txInfo = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });

    if (!txInfo?.meta) {
      throw new Error("Failed to get transaction info");
    }

    // Check if transaction succeeded (no errors in meta)
    if (txInfo.meta.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(txInfo.meta.err)}`);
    }

    // Since transaction succeeded, use the derived pool address
    const poolAddress = expectedPoolKey.toString();
    console.log('Using derived pool address:', poolAddress);

    // Verify the pool exists
    try {
      const poolAccount = await connection.getAccountInfo(new PublicKey(poolAddress));
      if (!poolAccount) {
        throw new Error("Pool account not found");
      }
      console.log('Pool account verified:', poolAddress);

      // Update database with pool creation and pool address
      const { error: updateError } = await supabase
        .from('web3agents')
        .update({
          metadata: {
            pool_created_at: new Date().toISOString(),
            pool_signature: signature,
            pool_address: poolAddress
          },
          pool_address: poolAddress
        })
        .eq('mint_address', tokenMint);

      if (updateError) {
        console.error('Failed to update agent metadata:', updateError);
        // Don't throw here, as pool was created successfully
      }

      return new Response(JSON.stringify({ 
        signature,
        poolAddress,
        message: "Pool created successfully"
      }), { status: 200 });

    } catch (error) {
      console.error('Failed to verify pool account:', error);
      throw new Error("Pool creation may have failed - could not verify pool account");
    }

  } catch (error) {
    console.error('Error creating pool:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Failed to create pool" 
    }), { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { 
      signedTransaction,
      tokenMint,
      vaultAddresses
    } = await req.json();
    
    const connection = new Connection(RPC_URL, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 180000
    });

    // Send and confirm transaction
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
        metadata: {
          vault_addresses: vaultAddresses,
          created_at: new Date().toISOString()
        }
      })
      .eq('mint_address', tokenMint);

    if (updateError) {
      throw new Error("Failed to update agent");
    }

    return new Response(JSON.stringify({ signature }), { status: 200 });

  } catch (error) {
    console.error('Error processing vault transaction:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Failed to process vault transaction" 
    }), { status: 500 });
  }
}

// Add new endpoint for transferring SOL
export async function PATCH(req: Request) {
  try {
    const { 
      userPublicKey,
      bondingCurveAddress,
      amount  // Amount in lamports
    } = await req.json();

    if (!userPublicKey || !bondingCurveAddress || !amount) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    const connection = new Connection(RPC_URL, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 180000
    });

    // Create transfer transaction
    const transaction = new Transaction();
    
    // Add transfer instruction
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(userPublicKey),
        toPubkey: new PublicKey(bondingCurveAddress),
        lamports: amount,
      })
    );

    // Get latest blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = new PublicKey(userPublicKey);

    // Return the transaction for user to sign
    return new Response(JSON.stringify({ 
      transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64')
    }), { status: 200 });

  } catch (error) {
    console.error('Error creating transfer transaction:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Failed to create transfer transaction" 
    }), { status: 500 });
  }
}
