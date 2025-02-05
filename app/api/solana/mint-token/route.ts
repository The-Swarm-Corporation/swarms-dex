import { Connection, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram, Keypair, TransactionInstruction, SYSVAR_RENT_PUBKEY, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";
import { createTokenAndMint } from "@/lib/solana/token";
import { logger } from "@/lib/logger";
import { 
  getAssociatedTokenAddress, 
  createTransferInstruction, 
  createInitializeMintInstruction,
  createInitializeAccountInstruction,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  AuthorityType
} from "@solana/spl-token";
import { PinataSDK } from 'pinata-web3';
import { generateSigner, percentAmount, publicKey, transactionBuilder, keypairIdentity } from '@metaplex-foundation/umi';
import { createV1, TokenStandard, MPL_TOKEN_METADATA_PROGRAM_ID } from '@metaplex-foundation/mpl-token-metadata';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { fromWeb3JsInstruction, fromWeb3JsKeypair, fromWeb3JsPublicKey, toWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters';
import { mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { encrypt, decrypt } from '@/lib/crypto';
import { 
  Liquidity,
  LiquidityPoolKeys,
  jsonInfo2PoolKeys,
  LiquidityStateLayout,
  LIQUIDITY_STATE_LAYOUT_V4,
  TxVersion,
  Clmm,
  ClmmPoolInfo,
  ClmmConfigInfo
} from '@raydium-io/raydium-sdk';
import { RAYDIUM_PROGRAM_ID } from '@/lib/raydium/constants';
import { BN } from '@project-serum/anchor';
// Debug prints for environment variables
console.log('ENV CHECK:');
console.log('DAO_TREASURY:', process.env.NEXT_PUBLIC_DAO_TREASURY_ADDRESS);
console.log('SWARMS_PUMP:', process.env.NEXT_PUBLIC_SWARMS_PUMP_ADDRESS);
console.log('SWARMS_TOKEN:', process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS);

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
const INITIAL_SUPPLY = 1_000_000_000;
const INITIAL_VIRTUAL_SWARMS = 500; // 500 SWARMS virtual reserve
const INITIAL_TOKEN_SUPPLY = 1_073_000_191; // 1,073,000,191 tokens
const K_VALUE = INITIAL_TOKEN_SUPPLY * INITIAL_VIRTUAL_SWARMS; // k = initial_supply * initial_virtual_swarms

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
export const config = {
  api: {
    bodyParser: false
  }
}

// Add function to derive pool PDA
async function derivePoolAccount(mint: PublicKey): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), mint.toBuffer()],
    SWARMS_PUMP_ADDRESS
  );
}

// Calculate tokens for given SWARMS amount using PUMP.FUN formula
function calculateTokenAmount(swarmsAmount: number): number {
  return INITIAL_TOKEN_SUPPLY - (K_VALUE / (INITIAL_VIRTUAL_SWARMS + swarmsAmount));
}

// Calculate price for given SWARMS amount
function calculatePrice(swarmsAmount: number): number {
  const currentTokens = calculateTokenAmount(swarmsAmount);
  const nextTokens = calculateTokenAmount(swarmsAmount + 0.000001); // Tiny increment for derivative
  const priceDelta = 0.000001 / (currentTokens - nextTokens);
  return priceDelta;
}

// Raydium official fee accounts
const RAYDIUM_CLMM_FEE_ACCOUNT = new PublicKey("DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8");
const RAYDIUM_V4_FEE_ACCOUNT = new PublicKey("7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5");

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
      swarmsAmount  // Add SWARMS amount parameter
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

    // 3. Create bonding curve account
    const bondingCurveRentExempt = await connection.getMinimumBalanceForRentExemption(165);
    transaction.add(
      SystemProgram.createAccount({
        fromPubkey: userPubkey,  // User pays for account creation
        newAccountPubkey: bondingCurveKeypair.publicKey,
        space: 165,
        lamports: bondingCurveRentExempt,
        programId: TOKEN_PROGRAM_ID
      })
    );

    // 4. Initialize bonding curve token account
    transaction.add(
      createInitializeAccountInstruction(
        bondingCurveKeypair.publicKey,
        mintKeypair.publicKey,
        bondingCurveKeypair.publicKey,
        TOKEN_PROGRAM_ID
      )
    );

    // Create token ATA for bonding curve account
    const bondingCurveTokenATA = await getAssociatedTokenAddress(
      mintKeypair.publicKey,  // New token mint
      bondingCurveKeypair.publicKey, // Owner
      false
    );

    // Create SWARMS ATA for bonding curve account
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

    // Get pump's SWARMS ATA
    const pumpSwarmsATA = await getAssociatedTokenAddress(
      SWARMS_TOKEN_ADDRESS,
      SWARMS_PUMP_ADDRESS
    );

    // Calculate SWARMS amounts
    const totalAmount = BigInt(swarmsAmount) * BigInt(10 ** TOKEN_DECIMALS);
    const feeAmount = totalAmount / BigInt(100); // 1% fee
    const reserveAmount = totalAmount - feeAmount; // 99% for reserve

    // Add ATA creation instructions
    transaction.add(
      // Create ATA for the new token
      createAssociatedTokenAccountInstruction(
        userPubkey,            // Payer
        bondingCurveTokenATA,  // ATA address
        bondingCurveKeypair.publicKey, // Owner
        mintKeypair.publicKey  // Mint
      ),
      // Create ATA for SWARMS token
      createAssociatedTokenAccountInstruction(
        userPubkey,            // Payer
        bondingCurveSwarmsATA, // ATA address
        bondingCurveKeypair.publicKey, // Owner
        SWARMS_TOKEN_ADDRESS   // Mint
      )
    );

    // Add SWARMS transfer instructions
    transaction.add(
      // Transfer 99% to bonding curve
      createTransferInstruction(
        userSwarmsATA,
        bondingCurveSwarmsATA,
        userPubkey,
        BigInt(reserveAmount)
      ),
      // Transfer 1% fee
      createTransferInstruction(
        userSwarmsATA,
        pumpSwarmsATA,
        userPubkey,
        BigInt(feeAmount)
      )
    );

    // 5. Mint initial supply to bonding curve's token ATA
    const initialSupply = BigInt(INITIAL_SUPPLY) * BigInt(10 ** TOKEN_DECIMALS);
    transaction.add(
      createMintToInstruction(
        mintKeypair.publicKey,       // Mint
        bondingCurveTokenATA,        // Destination (owned by bonding curve)
        mintKeypair.publicKey,       // Mint Authority (mint keypair)
        initialSupply                // Amount
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
      primarySaleHappened: false,
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

    // 8. Finally, remove mint authority (mint keypair transfers to null)
    transaction.add(
      createSetAuthorityInstruction(
        mintKeypair.publicKey,       // Mint account
        mintKeypair.publicKey,       // Current authority (mint keypair)
        AuthorityType.MintTokens,    // Authority type
        null                         // New authority (null means no one)
      )
    );

    // Get latest blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;

    // Partial sign with mint keypair and bonding curve keypair
    transaction.partialSign(mintKeypair, bondingCurveKeypair);

    // Log transaction signers for debugging
    console.log('Transaction requires signatures from:', {
      feePayer: transaction.feePayer?.toBase58(),
      signers: transaction.signatures.map(s => ({
        publicKey: s.publicKey.toBase58(),
        signature: s.signature ? 'signed' : 'unsigned'
      }))
    });

    // Serialize token creation transaction
    const tokenCreationTx = transaction.serialize({ 
      requireAllSignatures: false,
      verifySignatures: false 
    }).toString('base64');

    // Encrypt private keys
    const encryptedBondingCurvePrivateKey = await encrypt(
      Buffer.from(bondingCurveKeypair.secretKey).toString('base64')
    );

    // Store bonding curve keypair in database
    const { error: dbError } = await supabase
      .from('bonding_curve_keys')
      .insert({
        public_key: bondingCurveKeypair.publicKey.toString(),
        encrypted_private_key: encryptedBondingCurvePrivateKey,
        metadata: {
          mint_address: mintKeypair.publicKey.toString(),
          user_public_key: userPublicKey
        }
      });

    if (dbError) {
      logger.error("Failed to store bonding curve keys", dbError);
      throw new Error("Failed to store bonding curve keys");
    }

    // Return transaction for signing
    return new Response(JSON.stringify({ 
      tokenCreationTx,
      tokenMint: mintKeypair.publicKey.toString(),
      bondingCurveAddress: bondingCurveKeypair.publicKey.toString(),
      imageUrl
    }), { status: 200 });

  } catch (error) {
    logger.error("Error creating token transaction", error as Error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
}

// Handle signed token creation transaction and update database
export async function PUT(req: Request) {
  try {
    const { 
      signedTokenTx,
      tokenMint,
      bondingCurveAddress,
      userPublicKey,
      tokenName,
      tickerSymbol,
      description,
      twitterHandle,
      telegramGroup,
      discordServer,
      imageUrl
    } = await req.json();
    
    const connection = new Connection(RPC_URL, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 180000 // 3 minute timeout
    });

    // Deserialize the signed transaction
    const tokenTx = Transaction.from(Buffer.from(signedTokenTx, 'base64'));
    
    // Send with retry logic
    let tokenSignature = '';
    let retryCount = 0;
    const MAX_RETRIES = 3;

    while (retryCount < MAX_RETRIES) {
      try {
        console.log(`Attempt ${retryCount + 1} to send token creation transaction...`);
        
        // Send the transaction without modifying it
        tokenSignature = await connection.sendRawTransaction(tokenTx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3
        });
        console.log('Token creation sent:', tokenSignature);

        // Wait for confirmation with patience
        console.log('Waiting for confirmation (up to 3 minutes)...');
        let confirmationStatus = null;
        const startTime = Date.now();
        const TIMEOUT = 180000; // 3 minutes

        while (Date.now() - startTime < TIMEOUT) {
          try {
            const response = await connection.getSignatureStatus(tokenSignature);
            confirmationStatus = response.value?.confirmationStatus;
            
            if (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized') {
              console.log(`Transaction ${confirmationStatus} after ${((Date.now() - startTime)/1000).toFixed(1)} seconds`);
              
              if (response.value?.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(response.value.err)}`);
              }
              
              // Successfully confirmed
              break;
            }
            
            // Still pending, wait a bit before checking again
            await new Promise(resolve => setTimeout(resolve, 2000));
            process.stdout.write('.');  // Show progress
            
          } catch (checkError) {
            console.log('Error checking status:', checkError);
            // Don't throw here, just continue waiting
          }
        }

        if (!confirmationStatus || (confirmationStatus !== 'confirmed' && confirmationStatus !== 'finalized')) {
          throw new Error('Transaction confirmation timed out');
        }

        // If we get here, transaction was successful
        console.log('\nTransaction confirmed successfully');
        break;

      } catch (error) {
        retryCount++;
        console.log(`Attempt ${retryCount} failed:`, error);
        
        if (retryCount === MAX_RETRIES) {
          throw error;
        }
        
        // Wait before retrying with exponential backoff
        const backoffTime = 1000 * Math.pow(2, retryCount);
        console.log(`Waiting ${backoffTime/1000} seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }

    // Create initial database entry
    console.log('Creating database entry...');
    const { data: agent, error: agentError } = await supabase
      .from("web3agents")
      .insert({
        name: tokenName,
        description: description,
        token_symbol: tickerSymbol,
        mint_address: tokenMint,
        bonding_curve_address: bondingCurveAddress,
        graduated: false,
        creator_wallet: userPublicKey,
        created_at: new Date(),
        twitter_handle: twitterHandle,
        telegram_group: telegramGroup,
        discord_server: discordServer,
        image_url: imageUrl,
        initial_supply: INITIAL_SUPPLY,
        liquidity_pool_size: 0, // Will be updated after pool creation
        metadata: {
          uri: imageUrl,
          image: imageUrl,
          initial_token_supply: INITIAL_TOKEN_SUPPLY,
          created_at: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (agentError) {
      logger.error("Failed to create agent record", agentError);
      throw new Error("Failed to create agent record");
    }

    // Update bonding curve keys
    const { error: updateError } = await supabase
      .from('bonding_curve_keys')
      .update({ 
        agent_id: agent.id,
        token_signature: tokenSignature
      })
      .eq('public_key', bondingCurveAddress);

    if (updateError) {
      logger.error("Failed to update bonding curve keys", updateError);
      throw new Error("Failed to update bonding curve keys");
    }

    return new Response(JSON.stringify({ 
      success: true,
      tokenSignature,
      tokenMint,
      bondingCurveAddress,
      agentId: agent.id
    }), { status: 200 });

  } catch (error) {
    console.error('Error processing transaction:', error);
    logger.error("Error processing transaction", error as Error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Failed to process transaction" 
    }), { status: 500 });
  }
}