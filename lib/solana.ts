import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  SendTransactionError,
  LAMPORTS_PER_SOL,
  Signer,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMintInstruction,
  createMintToInstruction,
} from '@solana/spl-token';
import { BN } from '@project-serum/anchor';
import { logger } from './logger';

// Helper function to safely get transaction logs
async function getTransactionLogs(
  connection: Connection,
  error: SendTransactionError
): Promise<string[]> {
  try {
    if (error.logs?.length) {
      return error.logs;
    }
    
    // Access the transaction signature from the error message
    const sigMatch = error.message.match(/Transaction ([A-Za-z0-9]+) failed/);
    const signature = sigMatch?.[1];
    
    if (!signature) {
      return ['No transaction signature available'];
    }

    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0
    });
    
    return tx?.meta?.logMessages || ['No logs available'];
  } catch (e) {
    logger.error('Failed to get transaction logs', e as Error);
    return ['Failed to retrieve transaction logs'];
  }
}

// Helper function to check wallet readiness
async function ensureWalletReady(
  wallet: any,
  maxRetries: number = 3
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    if (wallet?.isConnected) {
      return;
    }
    await sleep(1000); // Wait 1 second between checks
  }
  throw new Error('Wallet not ready. Please ensure Phantom is connected.');
}

// Helper function to get wallet balance with retries
async function getWalletBalance(
  connection: Connection,
  wallet: any,
  maxRetries: number = 3
): Promise<number> {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      if (!wallet?.publicKey) {
        throw new Error('Wallet public key not found');
      }
      
      const balance = await connection.getBalance(
        new PublicKey(wallet.publicKey.toString())
      );
      
      logger.info('Retrieved wallet balance', {
        balance: balance / LAMPORTS_PER_SOL,
        attempt: i + 1,
        wallet: wallet.publicKey.toString()
      });
      
      return balance;
    } catch (error) {
      lastError = error;
      logger.warn(`Failed to get wallet balance (attempt ${i + 1})`, error);
      await sleep(1000 * (i + 1)); // Exponential backoff
    }
  }
  
  throw lastError;
}

// Helper function to check and fund account if needed
async function checkAndFundAccount(
  connection: Connection,
  wallet: any,
  mintKeypair: Keypair,
  rentExemptBalance: number
): Promise<void> {
  try {
    // Ensure wallet is ready
    await ensureWalletReady(wallet);
    
    // Get wallet balance with retries
    const walletBalance = await getWalletBalance(connection, wallet);
    const walletBalanceInSOL = walletBalance / LAMPORTS_PER_SOL;
    const requiredBalanceInSOL = rentExemptBalance / LAMPORTS_PER_SOL;

    logger.info('Checking balances', {
      walletBalance: walletBalanceInSOL,
      required: requiredBalanceInSOL,
      walletAddress: wallet.publicKey.toString(),
      mintAddress: mintKeypair.publicKey.toString()
    });

    if (walletBalance < rentExemptBalance) {
      throw new Error(
        `Insufficient wallet balance. Need at least ${requiredBalanceInSOL} SOL but wallet has ${walletBalanceInSOL} SOL. ` +
        `Please ensure your wallet (${wallet.publicKey.toString()}) has sufficient SOL.`
      );
    }

    // Proceed with funding the mint account
    const fundTx = await createTransactionWithBlockhash(
      connection,
      new PublicKey(wallet.publicKey.toString())
    );
    
    fundTx.add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(wallet.publicKey.toString()),
        toPubkey: mintKeypair.publicKey,
        lamports: rentExemptBalance
      })
    );

    const signedFundTx = await wallet.signTransaction(fundTx);
    const fundSig = await connection.sendRawTransaction(signedFundTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    
    await confirmTransactionWithRetry(connection, fundSig);
    logger.info('Funded mint account', { 
      signature: fundSig,
      amount: rentExemptBalance / LAMPORTS_PER_SOL,
      mintAddress: mintKeypair.publicKey.toString()
    });

    // Verify the funding was successful
    const newMintBalance = await connection.getBalance(mintKeypair.publicKey);
    if (newMintBalance < rentExemptBalance) {
      throw new Error(
        `Failed to fund mint account. Expected ${rentExemptBalance / LAMPORTS_PER_SOL} SOL ` +
        `but got ${newMintBalance / LAMPORTS_PER_SOL} SOL`
      );
    }

  } catch (error) {
    logger.error('Failed to fund mint account', error as Error);
    throw error;
  }
}

// Utility function to wait without websockets
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Confirm transaction with retries
async function confirmTransactionWithRetry(
  connection: Connection,
  signature: string,
  maxRetries: number = 3
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      if (confirmation.value.err) {
        logger.warn('Transaction confirmed but failed', {
          signature,
          error: confirmation.value.err,
        });
        continue;
      }
      return true;
    } catch (error) {
      logger.warn(`Confirmation attempt ${i + 1} failed`, { error, signature });
      if (i === maxRetries - 1) throw error;
      await sleep(1000 * (i + 1)); // Exponential backoff
    }
  }
  return false;
}

// Helper function to get fresh blockhash and create transaction
async function createTransactionWithBlockhash(
  connection: Connection,
  feePayer: PublicKey,
): Promise<Transaction> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  return new Transaction({
    feePayer,
    blockhash,
    lastValidBlockHeight,
  });
}

export async function createTokenAndMint(
  connection: Connection,
  wallet: any, // Phantom wallet
  supply: number,
  userAllocation: number,
  decimals: number = 9
): Promise<{
  mint: PublicKey;
  userTokenAccount: PublicKey;
}> {
  try {
    // Create mint account
    const mintKeypair = Keypair.generate();
    logger.info('Generated mint keypair', {
      mint: mintKeypair.publicKey.toString(),
    });

    // Get the minimum balance for rent exemption
    const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(
      MINT_SIZE
    );

    // Check and fund the mint account if needed
    await checkAndFundAccount(connection, wallet, mintKeypair, rentExemptBalance);

    // Create mint account transaction with fresh blockhash
    const createAccountTx = await createTransactionWithBlockhash(
      connection,
      new PublicKey(wallet.publicKey.toString())
    );

    createAccountTx.add(
      SystemProgram.createAccount({
        fromPubkey: new PublicKey(wallet.publicKey.toString()),
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports: rentExemptBalance,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        decimals,
        new PublicKey(wallet.publicKey.toString()),
        new PublicKey(wallet.publicKey.toString()),
        TOKEN_PROGRAM_ID
      )
    );

    try {
      // Sign with both the wallet and mint keypair
      const signedTx = await wallet.signTransaction(createAccountTx);
      signedTx.partialSign(mintKeypair);
      
      const rawTx = signedTx.serialize();
      const signature = await connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      
      await confirmTransactionWithRetry(connection, signature);
      logger.info('Mint account created and initialized', { signature });

      // Create associated token account
      const userTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        wallet as Signer,
        mintKeypair.publicKey,
        new PublicKey(wallet.publicKey.toString())
      );
      logger.info('Token account created', {
        tokenAccount: userTokenAccount.address.toString(),
      });

      // Create mint transaction with fresh blockhash
      const mintTx = await createTransactionWithBlockhash(
        connection,
        new PublicKey(wallet.publicKey.toString())
      );

      // Mint tokens to user
      const mintAmount = new BN(userAllocation).mul(new BN(10).pow(new BN(decimals)));
      mintTx.add(
        createMintToInstruction(
          mintKeypair.publicKey,
          userTokenAccount.address,
          new PublicKey(wallet.publicKey.toString()),
          mintAmount,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      // Sign mint transaction with both wallet and mint keypair
      const signedMintTx = await wallet.signTransaction(mintTx);
      signedMintTx.partialSign(mintKeypair);

      const mintSig = await connection.sendRawTransaction(signedMintTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      await confirmTransactionWithRetry(connection, mintSig);
      logger.info('Tokens minted successfully', {
        signature: mintSig,
        amount: mintAmount,
        recipient: userTokenAccount.address.toString(),
      });

      return {
        mint: mintKeypair.publicKey,
        userTokenAccount: userTokenAccount.address,
      };
    } catch (error) {
      if (error instanceof SendTransactionError) {
        const logs = await getTransactionLogs(connection, error);
        logger.error('Transaction failed', error, {
          logs,
          error: error.message
        });
        throw new Error(`Transaction failed: ${error.message}\nLogs: ${logs.join('\n')}`);
      }
      throw error;
    }

  } catch (error) {
    logger.error('Token creation failed', error as Error);
    if (error instanceof SendTransactionError) {
      const logs = await getTransactionLogs(connection, error);
      throw new Error(`Transaction failed: ${error.message}\nLogs: ${logs.join('\n')}`);
    }
    throw error;
  }
}

export async function getTokenAccounts(connection: Connection, ownerPublicKey: PublicKey) {
  try {
    logger.debug('Fetching token accounts', {
      owner: ownerPublicKey.toString(),
    });

    const accounts = await connection.getParsedTokenAccountsByOwner(
      ownerPublicKey,
      { programId: TOKEN_PROGRAM_ID },
      'confirmed'
    );

    const validAccounts = accounts.value.filter((account) => {
      const balance = account.account.data.parsed.info.tokenAmount.uiAmount;
      return balance > 0;
    });

    logger.info('Token accounts fetched', {
      count: validAccounts.length,
    });

    return validAccounts;
  } catch (error) {
    logger.error('Failed to fetch token accounts', error as Error);
    throw error;
  }
}

export async function getTokenBalance(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<number> {
  try {
    const balance = await connection.getTokenAccountBalance(tokenAccount);
    return balance.value.uiAmount || 0;
  } catch (error) {
    logger.error('Failed to get token balance', error as Error);
    throw error;
  }
}

