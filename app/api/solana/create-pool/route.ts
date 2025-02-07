import { Connection, PublicKey, Transaction, Keypair, SystemProgram, LAMPORTS_PER_SOL, TransactionInstruction } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";
import { 
  getAssociatedTokenAddress, 
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
const POOL_ACCOUNT_SIZE = 180;  // Pool state size
const LP_MINT_SIZE = 82;       // LP token mint size
const METADATA_RENT = 0.0151156 * LAMPORTS_PER_SOL;  // Fixed metadata rent
const BUFFER_MULTIPLIER = 1.2; // 15% buffer for all operations

// Add helper function to simulate and get cost
async function simulatePoolCreationCost(
  connection: Connection,
  bondingCurveKeypair: PublicKey,
  tokenMint: PublicKey,
): Promise<number> {
  // Get bonding curve's token accounts
  const bondingCurveTokenATA = await getAssociatedTokenAddress(
    tokenMint,
    bondingCurveKeypair,
    false
  );

  const bondingCurveSwarmsATA = await getAssociatedTokenAddress(
    SWARMS_TOKEN_ADDRESS,
    bondingCurveKeypair,
    false
  );

  // Get actual token balances
  const baseTokenAccount = await connection.getTokenAccountBalance(bondingCurveTokenATA);
  const quoteTokenAccount = await connection.getTokenAccountBalance(bondingCurveSwarmsATA);

  // Create simulation transaction
  const initPoolTx = await AmmImpl.createCustomizablePermissionlessConstantProductPool(
    connection,
    bondingCurveKeypair,
    tokenMint,
    SWARMS_TOKEN_ADDRESS,
    new BN(baseTokenAccount.value.amount),  // Use actual token amount
    new BN(quoteTokenAccount.value.amount), // Use actual SWARMS amount
    {
      tradeFeeNumerator: new BN(2500),     // 2.5% fee (250 bps)
      tradeFeeDenominator: new BN(10000),  // Standard basis points denominator
      activationType: 1,                    // 1 = Timestamp activation
      activationPoint: null,                // Will activate immediately since null
      hasAlphaVault: false,
      padding: Array(90).fill(0)  // Required padding (90 bytes as per SDK)
    },
    {
      cluster: 'mainnet-beta'
    }
  );

  // Add compute budget instruction
  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 });
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

  // Get exact rent exemption costs for each account:
  // - Pool account: 165 bytes for pool state
  // - LP token mint: 82 bytes for mint account
  // - Metadata account: 607 bytes (exact size from Metaplex v3)
  const poolAccountRent = await connection.getMinimumBalanceForRentExemption(POOL_ACCOUNT_SIZE);
  const lpMintRent = await connection.getMinimumBalanceForRentExemption(LP_MINT_SIZE);
  const metadataRent = METADATA_RENT;  // Exact amount needed for Metaplex metadata
  
  // Total rent needed from the transaction
  const totalRentExempt = (poolAccountRent + lpMintRent + metadataRent) / LAMPORTS_PER_SOL;

  // Add buffer for network fees and metadata program fees
  const bufferMultiplier = BUFFER_MULTIPLIER; // 15% buffer for all operations

  // Return total cost with buffer
  return (estimatedFee + totalRentExempt) * bufferMultiplier;
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
      tokenMint
    } = await req.json();

    if (!userPublicKey || !tokenMint) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    const connection = new Connection(RPC_URL, {
      commitment: 'confirmed'
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

    // Derive pool address
    const poolKey = deriveCustomizablePermissionlessConstantProductPoolAddress(
      new PublicKey(tokenMint),
      SWARMS_TOKEN_ADDRESS,
      createProgram(connection).ammProgram.programId,
    );
    console.log('\nExpected pool address:', poolKey.toString());

    // Check if pool exists
    const poolInfo = await connection.getAccountInfo(poolKey);
    
    if (poolInfo) {
      console.log('Pool already exists, updating database...');
      
      // Update web3agents table with pool address
      const { data: agent, error: agentError } = await supabase
        .from("web3agents")
        .update({
          pool_address: poolKey.toString()
        })
        .eq('mint_address', tokenMint)
        .select()
        .single();

      if (agentError) {
        throw new Error("Failed to update agent record with pool address");
      }

      // Update bonding curve keys with pool address
      await supabase
        .from('bonding_curve_keys')
        .update({ 
          pool_address: poolKey.toString()
        })
        .eq('public_key', bondingCurveKeys.public_key);

      return new Response(JSON.stringify({
        success: true,
        poolAddress: poolKey.toString(),
        details: {
          baseToken: tokenMint,
          quoteToken: SWARMS_TOKEN_ADDRESS.toString()
        }
      }), { status: 200 });
    }

    // Decrypt private key and create keypair
    const privateKeyBase64 = await decrypt(bondingCurveKeys.encrypted_private_key);
    const privateKey = Buffer.from(privateKeyBase64, 'base64');
    const bondingCurveKeypair = Keypair.fromSecretKey(privateKey);

    // Get token decimals
    const baseMintAccount = await getMint(connection, new PublicKey(tokenMint));
    const baseDecimals = 6;
    const quoteDecimals = 6; // SWARMS decimals

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

    // Set up pool parameters using EXACT token amounts from bonding curve
    const baseAmount = new BN(baseTokenAccount.value.amount);  // Exact base token amount
    const quoteAmount = new BN(remainingAmount);  // Exact remaining SWARMS after fee

    console.log('\nPool creation parameters:', {
      baseToken: tokenMint,
      baseDecimals,
      baseAmount: baseAmount.toString(),
      quoteToken: SWARMS_TOKEN_ADDRESS.toString(),
      quoteDecimals,
      quoteAmount: quoteAmount.toString(),
      baseAmountInBN: baseAmount instanceof BN ? 'Valid BN' : 'Not BN',
      quoteAmountInBN: quoteAmount instanceof BN ? 'Valid BN' : 'Not BN',
      baseTokenBalance: baseTokenAccount.value.uiAmount,
      quoteTokenBalance: quoteTokenAccount.value.uiAmount,
      remainingQuoteBalance: Number(remainingAmount) / (10 ** quoteDecimals)
    });

    // Create customization parameters
    const customizeParam = {
      tradeFeeNumerator: new BN(2500),     // 2.5% fee (250 bps)
      tradeFeeDenominator: new BN(10000),  // Standard basis points denominator
      activationType: 1,                    // 1 = Timestamp activation
      activationPoint: null,                // Will activate immediately since null
      hasAlphaVault: false,
      padding: Array(90).fill(0)           // Required padding (90 bytes as per SDK)
    };

    console.log('Pool customization parameters:', {
      tradeFeeNumerator: customizeParam.tradeFeeNumerator.toString(),
      tradeFeeDenominator: customizeParam.tradeFeeDenominator.toString(),
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

    // Add compute budget instructions first
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 });
    initPoolTx.instructions = [modifyComputeUnits, addPriorityFee, ...initPoolTx.instructions];

    // Set version to legacy for compatibility
    initPoolTx.feePayer = bondingCurveKeypair.publicKey;
    
    // Get latest blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
    initPoolTx.recentBlockhash = blockhash;
    initPoolTx.lastValidBlockHeight = lastValidBlockHeight + 150;

    // Get bonding curve balance before simulation
    const bondingCurveBalance = await connection.getBalance(bondingCurveKeypair.publicKey);

    // Simulate to get cost estimate
    const simulation = await connection.simulateTransaction(initPoolTx);
    
    console.log('\nSimulation results:', {
      error: simulation.value.err,
      unitsConsumed: simulation.value.unitsConsumed,
    });
    
    // Log all simulation logs without truncation
    console.log('\nFull simulation logs:');
    simulation.value.logs?.forEach((log, i) => {
      console.log(`${i + 1}: ${log}`);
    });

    // Calculate estimated fees for compute units
    const estimatedFee = simulation.value.unitsConsumed 
      ? (simulation.value.unitsConsumed * 5000) / (1_000_000 * LAMPORTS_PER_SOL)
      : 0.01;
    
    // Get exact rent exemption costs
    const poolAccountRent = await connection.getMinimumBalanceForRentExemption(POOL_ACCOUNT_SIZE);
    const lpMintRent = await connection.getMinimumBalanceForRentExemption(LP_MINT_SIZE);
    
    // Total rent needed from the transaction
    const totalRentExempt = (poolAccountRent + lpMintRent + METADATA_RENT);

    // Check for insufficient SOL error
    if (simulation.value.err) {
      // Calculate total required SOL
      const totalRequired = (estimatedFee + totalRentExempt / LAMPORTS_PER_SOL) * BUFFER_MULTIPLIER;
      const currentBalance = bondingCurveBalance / LAMPORTS_PER_SOL;
      const neededAmount = Math.max(0, totalRequired - currentBalance);

      // Check if this is an insufficient funds error
      const logs = simulation.value.logs || [];
      const isInsufficientFunds = logs.some(log => 
        log.includes('insufficient lamports') || 
        log.includes('Transfer: insufficient')
      );

      if (isInsufficientFunds) {
        console.log('SOL balance details:', {
          currentBalance: `${currentBalance.toFixed(6)} SOL`,
          totalRequired: `${totalRequired.toFixed(6)} SOL`,
          neededAmount: `${neededAmount.toFixed(6)} SOL`,
          estimatedFee: `${estimatedFee.toFixed(6)} SOL`,
          rentExempt: `${(totalRentExempt / LAMPORTS_PER_SOL).toFixed(6)} SOL`
        });

        // Create funding transaction with exact needed amount
        const fundingTx = new Transaction();
        
        // Add transfer instruction
        fundingTx.add(
          SystemProgram.transfer({
            fromPubkey: new PublicKey(userPublicKey),
            toPubkey: bondingCurveKeypair.publicKey,
            lamports: Math.ceil(neededAmount * LAMPORTS_PER_SOL),
          })
        );

        // Get latest blockhash and set fee payer
        const { blockhash } = await connection.getLatestBlockhash('finalized');
        fundingTx.recentBlockhash = blockhash;
        fundingTx.feePayer = new PublicKey(userPublicKey);

        return new Response(JSON.stringify({
          error: "Insufficient SOL for pool creation",
          details: {
            message: `Please fund the bonding curve with ${neededAmount.toFixed(6)} SOL to cover pool creation costs`,
            bondingCurveAddress: bondingCurveKeypair.publicKey.toString(),
            currentBalance: currentBalance,
            requiredBalance: totalRequired,
            neededAmount: neededAmount,
            breakdown: {
              estimatedFee,
              rentExempt: totalRentExempt / LAMPORTS_PER_SOL,
            }
          },
          transaction: fundingTx.serialize({ requireAllSignatures: false }).toString('base64')
        }), { status: 402 });
      }

      // For other errors, throw with original error handling
      throw new Error(`Pool creation simulation failed: ${JSON.stringify(simulation.value.err)}`);
    }

    // If we have enough balance, proceed with pool creation
    console.log('\nProceeding with pool creation...');
    
    // Sign and send the transaction
    initPoolTx.sign(bondingCurveKeypair);
    const signature = await connection.sendRawTransaction(initPoolTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 5
    });

    // Wait for confirmation
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight
    }, 'confirmed');

    if (confirmation.value.err) {
      throw new Error(`Failed to confirm pool creation: ${JSON.stringify(confirmation.value.err)}`);
    }

    // Update web3agents table with pool address
    const { data: agent, error: agentError } = await supabase
      .from("web3agents")
      .update({
        pool_address: poolKey.toString()
      })
      .eq('mint_address', tokenMint)
      .select()
      .single();

    if (agentError) {
      throw new Error("Failed to update agent record with pool address");
    }

    // Return success with pool address and transaction signature
    return new Response(JSON.stringify({
      success: true,
      poolAddress: poolKey.toString(),
      signature,
      details: {
        baseToken: tokenMint,
        quoteToken: SWARMS_TOKEN_ADDRESS.toString(),
        baseAmount: baseAmount.toString(),
        quoteAmount: quoteAmount.toString(),
        tradeFeePercent: '2.5'
      }
    }), { status: 200 });

  } catch (error) {
    console.error('Error creating pool:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Failed to create pool" 
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

// Add endpoint to handle signed transaction
export async function PUT(req: Request) {
  try {
    const { signedTransaction } = await req.json();

    if (!signedTransaction) {
      return new Response(JSON.stringify({ error: "Missing signed transaction" }), { status: 400 });
    }

    const connection = new Connection(RPC_URL, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 180000
    });

    // Deserialize and send the signed transaction
    const recoveredTransaction = Transaction.from(Buffer.from(signedTransaction, 'base64'));
    
    const signature = await connection.sendRawTransaction(recoveredTransaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 5
    });

    return new Response(JSON.stringify({ signature }), { status: 200 });

  } catch (error) {
    console.error('Error submitting signed transaction:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Failed to submit signed transaction" 
    }), { status: 500 });
  }
}