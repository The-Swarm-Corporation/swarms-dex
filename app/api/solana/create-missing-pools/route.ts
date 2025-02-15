import { Connection, PublicKey, Transaction, Keypair, ComputeBudgetProgram } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { BN } from '@project-serum/anchor';
import { AmmImpl } from "@mercurial-finance/dynamic-amm-sdk";
import { decrypt } from '@/lib/crypto';

const RPC_URL = process.env.RPC_URL as string;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SWARMS_TOKEN_ADDRESS = new PublicKey(process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS!);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Function to check if pool exists for a mint
async function doesPoolExist(connection: Connection, mint: PublicKey): Promise<boolean> {
  try {
    const [poolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), mint.toBuffer()],
      new PublicKey(process.env.NEXT_PUBLIC_SWARMS_PLATFORM_TEST_ADDRESS!)
    );
    
    const accountInfo = await connection.getAccountInfo(poolPda);
    return accountInfo !== null;
  } catch (error) {
    console.error('Error checking pool existence:', error);
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const connection = new Connection(RPC_URL, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 300000
    });

    // Get all bonding curve keys
    const { data: bondingCurves, error: fetchError } = await supabase
      .from('bonding_curve_keys')
      .select('*');

    if (fetchError) {
      throw new Error(`Failed to fetch bonding curves: ${fetchError.message}`);
    }

    const results = [];
    const errors = [];

    // Process each bonding curve
    for (const curve of bondingCurves) {
      try {
        const mintAddress = curve.metadata?.mint_address;
        if (!mintAddress) {
          errors.push({ curveId: curve.public_key, error: 'Missing mint address' });
          continue;
        }

        const mintPubkey = new PublicKey(mintAddress);
        
        // Check if pool already exists
        const poolExists = await doesPoolExist(connection, mintPubkey);
        if (poolExists) {
          results.push({ 
            curveId: curve.public_key, 
            status: 'skipped', 
            reason: 'Pool already exists' 
          });
          continue;
        }

        // Decrypt private key and create keypair
        const privateKeyBase64 = await decrypt(curve.encrypted_private_key);
        const privateKeyBytes = Buffer.from(privateKeyBase64, 'base64');
        const bondingCurveKeypair = Keypair.fromSecretKey(privateKeyBytes);

        // Set up pool parameters
        const baseDecimals = 6; // TOKEN_DECIMALS
        const quoteDecimals = 6;
        const baseAmount = new BN(100_000).mul(new BN(10 ** baseDecimals));
        const quoteAmount = new BN(100).mul(new BN(10 ** quoteDecimals));

        // Create pool transaction
        const initPoolTx = await AmmImpl.createCustomizablePermissionlessConstantProductPool(
          connection,
          bondingCurveKeypair.publicKey,
          mintPubkey,
          SWARMS_TOKEN_ADDRESS,
          baseAmount,
          quoteAmount,
          {
            tradeFeeNumerator: new BN(30),
            activationType: 0,
            activationPoint: null,
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
        initPoolTx.feePayer = bondingCurveKeypair.publicKey;

        // Get latest blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
        initPoolTx.recentBlockhash = blockhash;
        initPoolTx.lastValidBlockHeight = lastValidBlockHeight + 150;

        // Sign and send transaction
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
          lastValidBlockHeight: lastValidBlockHeight + 150
        });

        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        // Update database with pool creation
        await supabase
          .from('bonding_curve_keys')
          .update({ 
            pool_signature: signature,
            pool_created_at: new Date().toISOString()
          })
          .eq('public_key', curve.public_key);

        results.push({
          curveId: curve.public_key,
          status: 'success',
          signature
        });

      } catch (error) {
        console.error(`Error processing curve ${curve.public_key}:`, error);
        errors.push({
          curveId: curve.public_key,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      results,
      errors,
      totalProcessed: bondingCurves.length,
      successCount: results.filter(r => r.status === 'success').length,
      errorCount: errors.length,
      skippedCount: results.filter(r => r.status === 'skipped').length
    }), { status: 200 });

  } catch (error) {
    logger.error("Error processing pools creation:", error as Error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Failed to process pools creation" 
    }), { status: 500 });
  }
} 