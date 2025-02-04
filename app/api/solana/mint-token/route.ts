import { Connection, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram, Keypair, TransactionInstruction, SYSVAR_RENT_PUBKEY, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";
import { createTokenAndMint } from "@/lib/solana/token";
import { logger } from "@/lib/logger";
import { 
  getAssociatedTokenAddress, 
  createTransferInstruction, 
  createInitializeMintInstruction,
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

const TOKEN_DECIMALS = 9;
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
      userTokenAccount
    } = data;
    
    if (!userPublicKey || !tokenName || !tickerSymbol || !swarmsAmount || !userTokenAccount || !image) {
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
    
    // 3. Initialize mint with pump as authority
    transaction.add(
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        TOKEN_DECIMALS,
        mintKeypair.publicKey, // Temporary mint authority (will be transferred to pump)
        null,
        TOKEN_PROGRAM_ID
      )
    );

    // 4. Create bonding curve token account for new token (ATA for pump)
    const bondingCurveTokenAccount = await getAssociatedTokenAddress(
      mintKeypair.publicKey,  // new token mint
      SWARMS_PUMP_ADDRESS     // owned by pump
    );

    transaction.add(
      createAssociatedTokenAccountInstruction(
        userPubkey,                // Payer
        bondingCurveTokenAccount,  // ATA address
        SWARMS_PUMP_ADDRESS,       // Owner
        mintKeypair.publicKey      // Mint
      )
    );

    // 5. Create SWARMS reserve account for pump
    const bondingCurveReserve = await getAssociatedTokenAddress(
      SWARMS_TOKEN_ADDRESS,    // SWARMS token
      SWARMS_PUMP_ADDRESS     // owned by pump
    );

    // Only create if it doesn't exist
    const reserveAccount = await connection.getAccountInfo(bondingCurveReserve);
    if (!reserveAccount) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          userPubkey,            // Payer
          bondingCurveReserve,   // ATA address
          SWARMS_PUMP_ADDRESS,   // Owner
          SWARMS_TOKEN_ADDRESS   // Mint (SWARMS)
        )
      );
    }

    // 6. Transfer SWARMS to bonding curve reserve
    transaction.add(
      createTransferInstruction(
        new PublicKey(userTokenAccount),
        bondingCurveReserve,
        userPubkey,
        reserveAmount
      )
    );

    // 7. Mint initial supply to bonding curve token account
    const initialSupply = BigInt(INITIAL_SUPPLY) * BigInt(10 ** TOKEN_DECIMALS);
    transaction.add(
      createMintToInstruction(
        mintKeypair.publicKey,       // Mint
        bondingCurveTokenAccount,    // Destination
        mintKeypair.publicKey,       // Mint Authority (we have authority at this point)
        initialSupply                // Amount
      )
    );

    // 8. Create metadata (while we still have mint authority)
    console.log('Adding metadata instruction...');
    const umi = createUmi(RPC_URL)
      .use(mplTokenMetadata());
    
    // Create a signer from mint keypair
    const mintUmiKeypair = generateSigner(umi);
    mintUmiKeypair.publicKey = publicKey(mintKeypair.publicKey.toBase58());
    umi.use(keypairIdentity(mintUmiKeypair));

    // Create metadata instruction
    const metadataBuilder = createV1(umi, {
      // Required accounts
      mint: publicKey(mintKeypair.publicKey.toBase58()),
      authority: mintUmiKeypair,  // Must match mint authority
      payer: publicKey(userPublicKey),
      updateAuthority: publicKey(userPublicKey),  // User can still update metadata later
      systemProgram: publicKey(SystemProgram.programId.toBase58()),
      sysvarInstructions: publicKey(SYSVAR_INSTRUCTIONS_PUBKEY.toBase58()),
      splTokenProgram: publicKey(TOKEN_PROGRAM_ID.toBase58()),
      // Required data
      name: tokenName,
      symbol: tickerSymbol,
      uri: imageUrl,
      sellerFeeBasisPoints: percentAmount(0),
      creators: [{
        address: publicKey(userPublicKey),
        verified: false,  // Don't need signature since unverified
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

    // 9. Finally, transfer mint authority to null (no one)
    transaction.add(
      createSetAuthorityInstruction(
        mintKeypair.publicKey,       // Mint account
        mintKeypair.publicKey,       // Current authority
        AuthorityType.MintTokens,    // Authority type
        null                         // New authority (null means no one)
      )
    );

    // Get latest blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    transaction.feePayer = userPubkey;

    // Partial sign with mint keypair
    transaction.partialSign(mintKeypair);

    // Serialize transaction
    const serializedTx = transaction.serialize({ 
      requireAllSignatures: false,
      verifySignatures: false 
    }).toString('base64');

    console.log("Created transaction for signing", {
      user: userPublicKey,
      swarmsAmount,
      fee: feeAmount.toString(),
      reserve: reserveAmount.toString(),
      mint: mintKeypair.publicKey.toString(),
      bondingCurveToken: bondingCurveTokenAccount.toString(),
      bondingCurveReserve: bondingCurveReserve.toString(),
      instructions: transaction.instructions.length
    });

    return new Response(JSON.stringify({ 
      transaction: serializedTx,
      tokenMint: mintKeypair.publicKey.toString(),
      bondingCurveToken: bondingCurveTokenAccount.toString(),
      bondingCurveReserve: bondingCurveReserve.toString(),
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
      bondingCurveToken,
      bondingCurveReserve,
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
      confirmTransactionInitialTimeout: 60000 // 60 seconds
    });

    // Send the transaction
    console.log('Sending transaction...');
    const transaction = Transaction.from(Buffer.from(signedTransaction, 'base64'));
    const signature = await connection.sendRawTransaction(transaction.serialize());
    console.log('Transaction sent:', signature);

    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    console.log('Transaction confirmed successfully');

    logger.info("Transaction confirmed", { 
      signature,
      tokenMint,
      status: 'success'
    });

    // Update database
    console.log('Updating database...');
    await supabase.from("web3agents").insert({
      token_name: tokenName,
      ticker_symbol: tickerSymbol,
      mint_address: tokenMint,
      bonding_curve_token_address: bondingCurveToken,
      bonding_curve_reserve_address: bondingCurveReserve,
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
    });

    return new Response(JSON.stringify({ 
      success: true,
      signature,
      tokenMint,
      bondingCurveToken,
      bondingCurveReserve
    }), { status: 200 });

  } catch (error) {
    console.error('Error processing transaction:', error);
    logger.error("Error processing transaction", error as Error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Failed to process transaction" 
    }), { status: 500 });
  }
}