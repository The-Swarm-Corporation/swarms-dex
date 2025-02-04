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

// Constants for bonding curve
const INITIAL_VIRTUAL_SWARMS = 30_000_000; // 30 SWARMS with 6 decimals
const INITIAL_TOKEN_SUPPLY = 1_073_000_191_000_000; // 1,073,000,191 tokens with 6 decimals
const K_VALUE = 32_190_005_730_000_000; // K = initial_supply * (initial_virtual_swarms)

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
      swarmsAmount
    } = data;
    
    if (!userPublicKey || !tokenName || !tickerSymbol || !swarmsAmount || !image) {
      return new Response(JSON.stringify({ error: "Invalid Request - Missing required fields" }), { status: 400 });
    }

    // Upload image to IPFS first
    logger.info('Uploading image to Pinata');
    const imageUpload = await pinata.upload.file(image);
    const imageUrl = `https://${PINATA_GATEWAY}/ipfs/${imageUpload.IpfsHash}`;
    logger.info('Image upload successful:', imageUpload.IpfsHash);

    const connection = new Connection(RPC_URL, "confirmed");
    const userPubkey = new PublicKey(userPublicKey);

    // Get user's SWARMS token account
    const userTokenAccount = await getAssociatedTokenAddress(
      SWARMS_TOKEN_ADDRESS,
      userPubkey
    );

    // Create transaction for user to sign
    const transaction = new Transaction();
    
    // Generate mint keypair
    const mintKeypair = Keypair.generate();
    console.log('Generated mint keypair:', mintKeypair.publicKey.toString());

    // Generate bonding curve keypair
    const bondingCurveKeypair = Keypair.generate();
    console.log('Generated bonding curve keypair:', bondingCurveKeypair.publicKey.toString());

    // Calculate fee and reserve amounts
    const totalAmount = BigInt(swarmsAmount) * BigInt(10 ** 6); // SWARMS has 6 decimals
    const feeAmount = totalAmount / BigInt(100); // 1% fee
    const reserveAmount = totalAmount - feeAmount; // 99% for reserve

    // 1. Transfer 1% fee to pump's SWARMS account
    const pumpSwarmsFeeAccount = await getAssociatedTokenAddress(
      SWARMS_TOKEN_ADDRESS,
      SWARMS_PUMP_ADDRESS
    );

    transaction.add(
      createTransferInstruction(
        new PublicKey(userTokenAccount),
        pumpSwarmsFeeAccount,
        userPubkey,
        feeAmount
      )
    );

    // 2. Create mint account
    const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    transaction.add(
      SystemProgram.createAccount({
        fromPubkey: userPubkey,
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports: rentExemptBalance,
        programId: TOKEN_PROGRAM_ID,
      })
    );
    
    // 3. Initialize mint with mint keypair as temporary authority
    transaction.add(
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        TOKEN_DECIMALS,
        mintKeypair.publicKey, // Mint keypair is the authority
        null,
        TOKEN_PROGRAM_ID
      )
    );

    // 4. Create bonding curve account
    const bondingCurveRentExempt = await connection.getMinimumBalanceForRentExemption(165);
    transaction.add(
      SystemProgram.createAccount({
        fromPubkey: userPubkey,
        newAccountPubkey: bondingCurveKeypair.publicKey,
        space: 165,
        lamports: bondingCurveRentExempt,
        programId: TOKEN_PROGRAM_ID
      })
    );

    // 5. Initialize bonding curve token account
    transaction.add(
      createInitializeAccountInstruction(
        bondingCurveKeypair.publicKey,
        mintKeypair.publicKey,
        bondingCurveKeypair.publicKey,
        TOKEN_PROGRAM_ID
      )
    );

    // 4. Create SWARMS ATA for bonding curve account
    const bondingCurveSwarmsATA = await getAssociatedTokenAddress(
      SWARMS_TOKEN_ADDRESS,
      bondingCurveKeypair.publicKey,
      false
    );

    transaction.add(
      createAssociatedTokenAccountInstruction(
        userPubkey,           // Payer
        bondingCurveSwarmsATA,// ATA address
        bondingCurveKeypair.publicKey, // Owner
        SWARMS_TOKEN_ADDRESS  // Mint
      )
    );

    // Create token ATA for bonding curve account
    const bondingCurveTokenATA = await getAssociatedTokenAddress(
      mintKeypair.publicKey,  // New token mint
      bondingCurveKeypair.publicKey, // Owner
      false
    );

    transaction.add(
      createAssociatedTokenAccountInstruction(
        userPubkey,            // Payer
        bondingCurveTokenATA,  // ATA address
        bondingCurveKeypair.publicKey, // Owner
        mintKeypair.publicKey  // Mint
      )
    );

    // 5. Transfer SWARMS reserve to bonding curve's ATA
    transaction.add(
      createTransferInstruction(
        new PublicKey(userTokenAccount),
        bondingCurveSwarmsATA,
        userPubkey,
        reserveAmount
      )
    );

    // 6. Mint initial supply to bonding curve's token ATA
    const initialSupply = BigInt(INITIAL_SUPPLY) * BigInt(10 ** TOKEN_DECIMALS);
    transaction.add(
      createMintToInstruction(
        mintKeypair.publicKey,       // Mint
        bondingCurveTokenATA,        // Destination (owned by bonding curve)
        mintKeypair.publicKey,       // Mint Authority (mint keypair)
        initialSupply                // Amount
      )
    );

    // Note: The bonding curve account will later use these tokens to create a Raydium pool
    // with the correct bonding curve formula and hold the LP tokens

    // 7. Create metadata
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
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    transaction.feePayer = userPubkey;

    // Partial sign with mint keypair and bonding curve keypair
    transaction.partialSign(mintKeypair);
    transaction.partialSign(bondingCurveKeypair);
    console.log("Partially signed with mint and bonding curve keypairs")

    // Serialize transaction
    const serializedTx = transaction.serialize({ 
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

    console.log("Created transaction for signing", {
      user: userPublicKey,
      swarmsAmount,
      fee: feeAmount.toString(),
      reserve: reserveAmount.toString(),
      mint: mintKeypair.publicKey.toString(),
      bondingCurve: bondingCurveKeypair.publicKey.toString(),
      instructions: transaction.instructions.length
    });

    // Return single transaction - user just pays for everything
    return new Response(JSON.stringify({ 
      transaction: serializedTx,
      tokenMint: mintKeypair.publicKey.toString(),
      bondingCurveAddress: bondingCurveKeypair.publicKey.toString(),
      imageUrl,
      metadataUrl: ""
    }), { status: 200 });

  } catch (error) {
    logger.error("Error creating token transaction", error as Error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
}

// Handle signed transaction and update database
export async function PUT(req: Request) {
  try {
    const { 
      signedTransaction,
      tokenMint,
      bondingCurveAddress,
      userPublicKey,
      tokenName,
      tickerSymbol,
      description,
      twitterHandle,
      telegramGroup,
      discordServer,
      swarmsAmount,
      imageUrl,
      metadataUrl
    } = await req.json();
    
    const connection = new Connection(RPC_URL, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 180000 // 3 minutes
    });

    // Send the user's signed transaction
    console.log('Sending user transaction...');
    const transaction = Transaction.from(Buffer.from(signedTransaction, 'base64'));
    const signature = await connection.sendRawTransaction(transaction.serialize());
    console.log('Transaction sent:', signature);

    try {
      // First try normal confirmation with 3 minute timeout
      const latestBlockhash = await connection.getLatestBlockhash();
      const confirmation = await connection.confirmTransaction({
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      }, 'confirmed');
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('was not confirmed in')) {
        // If we get a timeout, check the transaction status manually
        console.log('Confirmation timed out, checking transaction status...');
        const status = await connection.getSignatureStatus(signature);
        
        if (status.value?.err) {
          // Transaction failed
          throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
        } else if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') {
          // Transaction succeeded despite timeout
          console.log('Transaction confirmed successfully after timeout');
        } else {
          // Still unknown, but we'll proceed since the transaction was sent
          console.log('Transaction status unclear, but proceeding...');
        }
      } else {
        // Some other error occurred
        throw error;
      }
    }

    console.log('Transaction confirmed or sent successfully');

    logger.info("Transaction confirmed", { 
      signature,
      tokenMint,
      status: 'success'
    });

    // Update database
    console.log('Updating database...');
    const { data: agent, error: agentError } = await supabase
      .from("web3agents")
      .insert({
        token_name: tokenName,
        ticker_symbol: tickerSymbol,
        mint_address: tokenMint,
        bonding_curve_address: bondingCurveAddress,
        swarms_reserve: swarmsAmount,
        graduated: false,
        creator_wallet: userPublicKey,
        created_at: new Date(),
        description,
        twitter_handle: twitterHandle,
        telegram_group: telegramGroup,
        discord_server: discordServer,
        image_url: imageUrl,
        metadata: {
          uri: metadataUrl,
          image: imageUrl
        }
      })
      .select()
      .single();

    if (agentError) {
      logger.error("Failed to create agent record", agentError);
      throw new Error("Failed to create agent record");
    }

    // Update bonding curve keys with agent_id
    const { error: updateError } = await supabase
      .from('bonding_curve_keys')
      .update({ agent_id: agent.id })
      .eq('public_key', bondingCurveAddress);

    if (updateError) {
      logger.error("Failed to update bonding curve keys", updateError);
      throw new Error("Failed to update bonding curve keys");
    }

    return new Response(JSON.stringify({ 
      success: true,
      signature,
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