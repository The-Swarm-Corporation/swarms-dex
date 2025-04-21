// Web3.js imports
import { 
  Connection, 
  PublicKey, 
  LAMPORTS_PER_SOL, 
  Transaction, 
  SystemProgram, 
  Keypair, 
  SYSVAR_INSTRUCTIONS_PUBKEY, 
  ComputeBudgetProgram 
} from "@solana/web3.js";

// SPL Token imports
import { 
  getAssociatedTokenAddress, 
  createTransferInstruction, 
  createInitializeMintInstruction,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from "@solana/spl-token";

// Metaplex imports
import { 
  generateSigner, 
  percentAmount, 
  publicKey, 
  keypairIdentity 
} from '@metaplex-foundation/umi';
import { 
  createV1, 
  TokenStandard 
} from '@metaplex-foundation/mpl-token-metadata';
import { 
  createUmi 
} from '@metaplex-foundation/umi-bundle-defaults';
import { 
  toWeb3JsInstruction 
} from '@metaplex-foundation/umi-web3js-adapters';
import { 
  mplTokenMetadata 
} from '@metaplex-foundation/mpl-token-metadata';

// Other imports
import { createClient } from "@supabase/supabase-js";
import { PinataSDK } from 'pinata-web3';
import { BN } from '@project-serum/anchor';
import { AmmImpl } from "@mercurial-finance/dynamic-amm-sdk";

// Local imports
import { logger } from "@/lib/logger";
import { encrypt } from '@/lib/crypto';

const RPC_URL = process.env.RPC_URL as string;

// Create all PublicKeys
let DAO_TREASURY_ADDRESS: PublicKey;
let SWARMS_PUMP_ADDRESS: PublicKey;
let SWARMS_TOKEN_ADDRESS: PublicKey;

console.log('Creating DAO Treasury PublicKey...');
try {
  if (!process.env.NEXT_PUBLIC_DAO_TREASURY_ADDRESS) {
    throw new Error('DAO_TREASURY_ADDRESS is undefined');
  }
  DAO_TREASURY_ADDRESS = new PublicKey(process.env.NEXT_PUBLIC_DAO_TREASURY_ADDRESS);
  console.log('DAO Treasury created:', DAO_TREASURY_ADDRESS.toString());
} catch (error) {
  console.error('DAO Treasury failed:', error);
  console.error('Value was:', process.env.NEXT_PUBLIC_DAO_TREASURY_ADDRESS);
  throw error;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PINATA_JWT = process.env.PINATA_JWT as string;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY as string;

if (!PINATA_JWT || !PINATA_GATEWAY) {
  console.error('Missing Pinata config');
  throw new Error('Pinata configuration is required');
}

const pinata = new PinataSDK({
  pinataJwt: PINATA_JWT,
  pinataGateway: PINATA_GATEWAY,
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

console.log('Creating SWARMS Pump PublicKey...');
try {
  if (!process.env.NEXT_PUBLIC_SWARMS_PLATFORM_TEST_ADDRESS) {
    throw new Error('SWARMS_PUMP_ADDRESS is undefined');
  }
  SWARMS_PUMP_ADDRESS = new PublicKey(process.env.NEXT_PUBLIC_SWARMS_PLATFORM_TEST_ADDRESS);
  console.log('SWARMS Pump created:', SWARMS_PUMP_ADDRESS.toString());
} catch (error) {
  console.error('SWARMS Pump failed:', error);
  console.error('Value was:', process.env.NEXT_PUBLIC_SWARMS_PLATFORM_TEST_ADDRESS);
  throw error;
}

const TOKEN_DECIMALS = 6;
const INITIAL_SUPPLY = 1_000_000_000; // 1B actual tokens to mint
const INITIAL_VIRTUAL_SWARMS = 500; // 500 SWARMS virtual reserve
const VIRTUAL_TOKEN_SUPPLY = 1_073_000_191; // Virtual supply used for calculations
// Original K value from PUMP.FUN scaled up by (500/30) to maintain same price dynamics
const K_VALUE = 32_190_005_730 * (500/30); // Scale k value for 500 SWARMS instead of 30 SOL
const POOL_CREATION_SOL = 0.07; // Fixed amount for pool creation

console.log('Creating SWARMS Token PublicKey...');
try {
  if (!process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS) {
    throw new Error('SWARMS_TOKEN_ADDRESS is undefined');
  }
  SWARMS_TOKEN_ADDRESS = new PublicKey(process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS);
  console.log('SWARMS Token created:', SWARMS_TOKEN_ADDRESS.toString());
} catch (error) {
  console.error('SWARMS Token failed:', error);
  console.error('Value was:', process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS);
  throw error;
}

const SWARMS_MINIMUM_BUY_IN = 1;

// Increase payload size limit for file uploads
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Add function to derive pool PDA
async function derivePoolAccount(mint: PublicKey): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), mint.toBuffer()],
    SWARMS_PUMP_ADDRESS
  );
}

// Calculate tokens for given SWARMS amount using PUMP.FUN formula
function calculateTokenAmount(swarmsAmount: number): number {
  // Use PUMP.FUN formula but with 500 SWARMS base: y = 1073000191 - (32190005730 * 500/30)/(500+x)
  const virtualTokens = VIRTUAL_TOKEN_SUPPLY - (K_VALUE / (INITIAL_VIRTUAL_SWARMS + swarmsAmount));
  // Scale down to actual supply (1B)
  return (virtualTokens / VIRTUAL_TOKEN_SUPPLY) * INITIAL_SUPPLY;
}

// Add helper function to simulate pool creation cost
async function simulatePoolCreationCost(
  connection: Connection,
  bondingCurveKeypair: PublicKey,
  mintKeypair: PublicKey,
): Promise<number> {
  // Set up pool parameters
  const baseDecimals = TOKEN_DECIMALS;
  const quoteDecimals = TOKEN_DECIMALS;
  const baseAmount = new BN(100_000).mul(new BN(10 ** baseDecimals));
  const quoteAmount = new BN(100).mul(new BN(10 ** quoteDecimals));

  // Create simulation transaction
  const initPoolTx = await AmmImpl.createCustomizablePermissionlessConstantProductPool(
    connection,
    bondingCurveKeypair,
    mintKeypair,
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
  return (estimatedFee + totalRentExempt) * 1.2; // 20% buffer
}

// Add function to calculate total required SOL
async function calculateRequiredSol(
  connection: Connection,
  userPubkey: PublicKey,
  mintKeypair: PublicKey,
  bondingCurveKeypair: PublicKey
): Promise<number> {
  // 1. Calculate rent exemptions
  const accountRentExempt = await connection.getMinimumBalanceForRentExemption(0);
  const mintRentExempt = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const ataRentExempt = await connection.getMinimumBalanceForRentExemption(165); // Standard ATA size
  
  // 2. Simulate pool creation cost
  const poolCreationCost = await simulatePoolCreationCost(
    connection,
    bondingCurveKeypair,
    mintKeypair
  );

  // 3. Calculate total with all components
  const totalCost = (
    accountRentExempt +    // Bonding curve account rent
    mintRentExempt +       // Mint account rent
    (ataRentExempt * 2) +  // Two ATAs (token and SWARMS)
    poolCreationCost       // Pool creation cost (includes its own buffer)
  ) / LAMPORTS_PER_SOL;

  console.log('Cost breakdown:', {
    accountRent: accountRentExempt / LAMPORTS_PER_SOL,
    mintRent: mintRentExempt / LAMPORTS_PER_SOL,
    ataRent: (ataRentExempt * 2) / LAMPORTS_PER_SOL,
    poolCreation: poolCreationCost,
    total: totalCost
  });

  return totalCost;
}

export async function POST(req: Request) {
  try {
    // Parse form data for file upload
    const formData = await req.formData();
    const image = formData.get('image') as File;
    const data = JSON.parse(formData.get('data') as string);
    
    const { 
      userPublicKey, 
      tokenName, 
      tickerSymbol,
      description,
      twitterHandle,
      telegramGroup,
      discordServer,
      swarmsAmount,
      priorityFee = 50000    // Default to 50k microlamports
    } = data;
    
    if (!userPublicKey || !tokenName || !tickerSymbol || !image || !swarmsAmount) {
      return new Response(JSON.stringify({ error: "Invalid Request - Missing required fields" }), { status: 400 });
    }

    // Upload image to IPFS first
    logger.info('Uploading image to Pinata');
    const imageUpload = await pinata.upload.file(image);
    const imageUrl = `https://${PINATA_GATEWAY}/ipfs/${imageUpload.IpfsHash}`;
    logger.info('Image upload successful:', imageUpload.IpfsHash);

    const connection = new Connection(RPC_URL, "confirmed");
    const userPubkey = new PublicKey(userPublicKey);

    // Create transaction for user to sign
    const transaction = new Transaction();
    
    // Generate mint keypair
    const mintKeypair = Keypair.generate();
    console.log('Generated mint keypair:', mintKeypair.publicKey.toString());

    // Generate bonding curve keypair
    const bondingCurveKeypair = Keypair.generate();
    console.log('Generated bonding curve keypair:', bondingCurveKeypair.publicKey.toString());

    // Set the fee payer explicitly
    transaction.feePayer = userPubkey;

    // 1. Create mint account
    const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    transaction.add(
      SystemProgram.createAccount({
        fromPubkey: userPubkey,  // User pays for account creation
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports: rentExemptBalance,
        programId: TOKEN_PROGRAM_ID,
      })
    );
    
    // 2. Initialize mint with mint keypair as temporary authority
    transaction.add(
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        TOKEN_DECIMALS,
        mintKeypair.publicKey, // Mint keypair is the authority
        null,
        TOKEN_PROGRAM_ID
      )
    );

    // Calculate exact required SOL amount
    const bondingCurveRentExempt = await connection.getMinimumBalanceForRentExemption(0);
    const initialSolAmount = POOL_CREATION_SOL * LAMPORTS_PER_SOL;
    
    transaction.add(
      SystemProgram.createAccount({
        fromPubkey: userPubkey,
        newAccountPubkey: bondingCurveKeypair.publicKey,
        space: 0,  // No data needed for a wallet account
        lamports: bondingCurveRentExempt + initialSolAmount, // Add 0.12 SOL for pool creation
        programId: SystemProgram.programId  // Make it a system account
      })
    );

    // Create token ATAs for bonding curve
    const bondingCurveTokenATA = await getAssociatedTokenAddress(
      mintKeypair.publicKey,  // New token mint
      bondingCurveKeypair.publicKey, // Owner
      false
    );

    const bondingCurveSwarmsATA = await getAssociatedTokenAddress(
      SWARMS_TOKEN_ADDRESS,
      bondingCurveKeypair.publicKey,
      false
    );

    // Get user's SWARMS ATA
    const userSwarmsATA = await getAssociatedTokenAddress(
      SWARMS_TOKEN_ADDRESS,
      userPubkey
    );

    // Get user's token ATA
    const userTokenATA = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      userPubkey,
      false
    );

    // Calculate SWARMS amounts
    const totalAmount = BigInt(swarmsAmount) * BigInt(10 ** TOKEN_DECIMALS);
    const treasuryFeeAmount = totalAmount * BigInt(1) / BigInt(100); // 1% fee to treasury
    const reserveAmount = totalAmount - treasuryFeeAmount; // Remaining SWARMS go to bonding curve

    // Get treasury ATA
    const treasuryTokenATA = await getAssociatedTokenAddress(
      SWARMS_TOKEN_ADDRESS,
      new PublicKey(data.treasuryAddress),
      true
    );

    // Add treasury fee transfer
    transaction.add(
      createTransferInstruction(
        userSwarmsATA,
        treasuryTokenATA,
        userPubkey,
        Number(treasuryFeeAmount)
      )
    );

    // Calculate creator's initial token allocation based on remaining SWARMS amount
    const creatorTokens = calculateTokenAmount(Number(reserveAmount) / (10 ** TOKEN_DECIMALS));
    console.log('Token allocation calculation:', {
      swarmsAmount,
      creatorTokens,
      initialSupply: INITIAL_SUPPLY,
      initialTokenSupply: VIRTUAL_TOKEN_SUPPLY
    });

    // Convert to BigInt with decimals and ensure we don't exceed total supply
    const creatorAllocation = BigInt(Math.floor(creatorTokens)) * BigInt(10 ** TOKEN_DECIMALS);
    const totalSupplyWithDecimals = BigInt(INITIAL_SUPPLY) * BigInt(10 ** TOKEN_DECIMALS);
    
    // Ensure bonding curve gets remaining supply
    const bondingCurveAllocation = totalSupplyWithDecimals - creatorAllocation;

    console.log('Final allocations:', {
      creatorAllocation: creatorAllocation.toString(),
      bondingCurveAllocation: bondingCurveAllocation.toString(),
      totalSupply: totalSupplyWithDecimals.toString()
    });

    // Verify allocations add up to total supply
    if (creatorAllocation + bondingCurveAllocation !== totalSupplyWithDecimals) {
      throw new Error('Token allocation mismatch');
    }

    // Create ATAs
    transaction.add(
      createAssociatedTokenAccountInstruction(
        userPubkey,            // Payer
        bondingCurveTokenATA,  // ATA address
        bondingCurveKeypair.publicKey, // Owner
        mintKeypair.publicKey  // Mint
      ),
      createAssociatedTokenAccountInstruction(
        userPubkey,            // Payer
        bondingCurveSwarmsATA, // ATA address
        bondingCurveKeypair.publicKey, // Owner
        SWARMS_TOKEN_ADDRESS   // Mint
      ),
      createAssociatedTokenAccountInstruction(
        userPubkey,            // Payer
        userTokenATA,          // ATA address
        userPubkey,            // Owner
        mintKeypair.publicKey  // Mint
      )
    );

    // Transfer all SWARMS to bonding curve
    transaction.add(
      createTransferInstruction(
        userSwarmsATA,
        bondingCurveSwarmsATA,
        userPubkey,
        BigInt(reserveAmount)
      )
    );

    // Mint initial supply - split between bonding curve and creator
    transaction.add(
      // Mint to bonding curve
      createMintToInstruction(
        mintKeypair.publicKey,       // Mint
        bondingCurveTokenATA,        // Destination (bonding curve's ATA)
        mintKeypair.publicKey,       // Mint Authority
        bondingCurveAllocation       // Amount
      ),
      // Mint to creator
      createMintToInstruction(
        mintKeypair.publicKey,       // Mint
        userTokenATA,                // Destination (creator's ATA)
        mintKeypair.publicKey,       // Mint Authority
        creatorAllocation            // Amount
      )
    );

    // 6. Create metadata
    console.log('Adding metadata instruction...');
    const umi = createUmi(RPC_URL)
      .use(mplTokenMetadata())
      
    // Create a signer from mint keypair
    const mintUmiKeypair = generateSigner(umi);
    mintUmiKeypair.publicKey = publicKey(mintKeypair.publicKey.toBase58());
    umi.use(keypairIdentity(mintUmiKeypair));

    // Create metadata instruction
    console.log('Adding metadata instruction...', {
      mint: mintKeypair.publicKey.toBase58(),
      authority: mintKeypair.publicKey.toBase58(),
      payer: userPublicKey,
      name: tokenName,
      symbol: tickerSymbol,
      uri: imageUrl
    });

    const metadataBuilder = createV1(umi, {
      mint: publicKey(mintKeypair.publicKey.toBase58()),
      authority: mintUmiKeypair,  // Use the UMI identity as signer
      payer: publicKey(userPublicKey),  // User pays for the transaction
      updateAuthority: mintUmiKeypair,  // User can update metadata later
      systemProgram: publicKey(SystemProgram.programId.toBase58()),
      sysvarInstructions: publicKey(SYSVAR_INSTRUCTIONS_PUBKEY.toBase58()),
      splTokenProgram: publicKey(TOKEN_PROGRAM_ID.toBase58()),
      name: tokenName,
      symbol: tickerSymbol,
      uri: imageUrl,
      sellerFeeBasisPoints: percentAmount(0),
      creators: [{
        address: publicKey(userPublicKey),
        verified: false,
        share: 100,
      }],
      primarySaleHappened: true,
      isMutable: true,
      tokenStandard: TokenStandard.Fungible,
      collection: null,
      uses: null,
      collectionDetails: null,
      ruleSet: null,
      decimals: TOKEN_DECIMALS,
      printSupply: null,
    });

    // Add metadata instruction to transaction
    const metadataInstructions = metadataBuilder.getInstructions();
    metadataInstructions.forEach(ix => {
      transaction.add(toWeb3JsInstruction(ix));
    });
    console.log("Added metadata")

    // Add compute budget instructions
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }); // Fixed compute limit
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ 
      microLamports: priorityFee 
    });
    transaction.add(modifyComputeUnits, addPriorityFee);

    // Get latest blockhash and set a longer validity window
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
    transaction.recentBlockhash = blockhash;
    // Add 150 blocks to the validity window (roughly ~1-2 minutes extra)
    transaction.lastValidBlockHeight = lastValidBlockHeight + 150;

    // Sign with required signers:
    // 1. Mint keypair signs for:
    //    - Its own account creation
    //    - As mint authority
    //    - As metadata authority
    // 2. Bonding curve keypair signs for:
    //    - Its own account creation only
    transaction.sign(mintKeypair, bondingCurveKeypair);

    // Store bonding curve keypair in database
    const { error: dbError } = await supabase
      .from('bonding_curve_keys')
      .insert({
        public_key: bondingCurveKeypair.publicKey.toString(),
        encrypted_private_key: await encrypt(Buffer.from(bondingCurveKeypair.secretKey).toString('base64')),
        metadata: {
          mint_address: mintKeypair.publicKey.toString(),
          user_public_key: userPublicKey
        }
      });

    if (dbError) {
      logger.error("Failed to store bonding curve keys", dbError);
      throw new Error("Failed to store bonding curve keys");
    }

    // Return unsigned transaction and addresses
    return new Response(JSON.stringify({ 
      tokenCreationTx: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
      tokenMint: mintKeypair.publicKey.toString(),
      bondingCurveAddress: bondingCurveKeypair.publicKey.toString(),
      imageUrl
    }), { status: 200 });

  } catch (error) {
    logger.error("Error creating token transaction", error as Error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
}

// Handle signed token creation transaction
export async function PUT(req: Request) {
  try {
    const { signedTokenTx, tokenMint, bondingCurveAddress, userPublicKey, ...metadata } = await req.json();

    const connection = new Connection(RPC_URL, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 300000  // Increase to 5 minutes
    });

    // Send and confirm transaction - user has signed their part client-side
    const tx = Transaction.from(Buffer.from(signedTokenTx, 'base64'));

    console.log('Sending transaction with details:', {
      signers: tx.signatures.map(s => ({
        publicKey: s.publicKey.toString(),
        signature: s.signature ? 'signed' : 'unsigned'
      })),
      blockhash: tx.recentBlockhash,
      lastValidBlockHeight: tx.lastValidBlockHeight
    });

    // Simulate transaction first
    console.log('Simulating transaction...');
    const simulation = await connection.simulateTransaction(tx);
    
    if (simulation.value.err) {
      console.error('Simulation failed:', {
        error: simulation.value.err,
        logs: simulation.value.logs
      });
      throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}\nLogs: ${simulation.value.logs?.join('\n')}`);
    }

    console.log('Simulation successful:', {
      unitsConsumed: simulation.value.unitsConsumed,
      logs: simulation.value.logs
    });

    // Send with retries
    let signature;
    for (let i = 0; i < 3; i++) {
      try {
        signature = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 5
        });
        console.log(`Attempt ${i + 1} successful, signature:`, signature);
        break;
      } catch (error) {
        console.error(`Send attempt ${i + 1} failed:`, error);
        if (i === 2) throw error;
        console.log('Retrying in 2 seconds...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (!signature) {
      throw new Error('Failed to send transaction after retries');
    }

    console.log('Transaction sent:', signature);

    // Confirm with longer timeout and more retries
    console.log('Waiting for confirmation...');
    let confirmed = false;
    let totalWaitTime = 0;
    const MAX_WAIT_TIME = 600000; // 10 minutes total max wait
    const RETRY_INTERVAL = 5000;  // Check every 5 seconds

    while (!confirmed && totalWaitTime < MAX_WAIT_TIME) {
      try {
        // First try normal confirmation
        const confirmation = await connection.confirmTransaction({
          signature,
          blockhash: tx.recentBlockhash!,
          lastValidBlockHeight: tx.lastValidBlockHeight!
        }, 'confirmed');

        console.log('Confirmation attempt result:', {
          err: confirmation.value.err,
          slot: confirmation.context.slot
        });

        if (!confirmation.value.err) {
          confirmed = true;
          break;
        }
      } catch (error) {
        // On any error, check transaction status directly
        console.log('Checking transaction status directly...');
        const status = await connection.getSignatureStatus(signature);
        
        console.log('Transaction status:', {
          status: status.value?.confirmationStatus,
          err: status.value?.err,
          confirmations: status.value?.confirmations
        });

        if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') {
          console.log('Transaction confirmed through status check');
          confirmed = true;
          break;
        }

        if (status.value?.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
        }
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
      totalWaitTime += RETRY_INTERVAL;
      console.log(`Waited ${totalWaitTime/1000} seconds for confirmation...`);
    }

    if (!confirmed) {
      // One final status check before giving up
      const finalStatus = await connection.getSignatureStatus(signature);
      if (finalStatus.value?.confirmationStatus === 'confirmed' || finalStatus.value?.confirmationStatus === 'finalized') {
        console.log('Transaction confirmed in final status check');
        confirmed = true;
      } else {
        console.error('Final transaction status:', finalStatus);
        throw new Error(`Transaction confirmation timed out after ${MAX_WAIT_TIME/1000} seconds. Check status manually with signature: ${signature}`);
      }
    }

    // Create database entry
    const { data: agent, error: agentError } = await supabase
      .from("web3agents")
      .insert({
        name: metadata.tokenName,
        description: metadata.description,
        token_symbol: metadata.tickerSymbol,
        mint_address: tokenMint,
        bonding_curve_address: bondingCurveAddress,
        graduated: false,
        creator_wallet: userPublicKey,
        created_at: new Date(),
        twitter_handle: metadata.twitterHandle,
        telegram_group: metadata.telegramGroup,
        discord_server: metadata.discordServer,
        image_url: metadata.imageUrl,
        initial_supply: INITIAL_SUPPLY,
        liquidity_pool_size: 0,
        metadata: {
          uri: metadata.imageUrl,
          image: metadata.imageUrl,
          initial_token_supply: VIRTUAL_TOKEN_SUPPLY,
          created_at: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (agentError) {
      throw new Error("Failed to create agent record");
    }

    // Update bonding curve keys
    await supabase
      .from('bonding_curve_keys')
      .update({ 
        agent_id: agent.id,
        token_signature: signature
      })
      .eq('public_key', bondingCurveAddress);

    return new Response(JSON.stringify({ 
      success: true,
      signature,
      tokenMint,
      bondingCurveAddress,
      agentId: agent.id
    }), { status: 200 });

  } catch (error) {
    console.error('Error processing transaction:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Failed to process transaction" 
    }), { status: 500 });
  }
}