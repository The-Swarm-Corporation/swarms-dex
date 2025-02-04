import { type Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js"
import { createAssociatedTokenAccount, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { logger } from "../logger"

export class WalletService {
  private connection: Connection

  constructor(connection: Connection) {
    this.connection = connection
  }

  async createPlatformWallet(): Promise<{
    publicKey: string
    privateKey: string
  }> {
    try {
      const wallet = Keypair.generate()

      logger.info("Created platform wallet", {
        publicKey: wallet.publicKey.toString(),
      })

      return {
        publicKey: wallet.publicKey.toString(),
        privateKey: Buffer.from(wallet.secretKey).toString("base64"),
      }
    } catch (error) {
      logger.error("Failed to create platform wallet", error as Error)
      throw error
    }
  }

  async setupTokenAccount(walletPublicKey: string, mintAddress: string): Promise<string> {
    try {
      const publicKey = new PublicKey(walletPublicKey)
      const mint = new PublicKey(mintAddress)

      const tokenAddress = await getAssociatedTokenAddress(mint, publicKey, false, TOKEN_PROGRAM_ID)

      const account = await this.connection.getAccountInfo(tokenAddress)

      if (!account) {
        await createAssociatedTokenAccount(
          this.connection,
          Keypair.generate(), // Payer
          mint,
          publicKey,
        )
      }

      logger.info("Token account setup complete", {
        wallet: walletPublicKey,
        mint: mintAddress,
        tokenAccount: tokenAddress.toString(),
      })

      return tokenAddress.toString()
    } catch (error) {
      logger.error("Failed to setup token account", error as Error)
      throw error
    }
  }

  async signTransaction(transaction: Transaction, privateKey: Uint8Array): Promise<Transaction> {
    try {
      const signer = Keypair.fromSecretKey(privateKey)
      transaction.sign(signer)
      
      logger.info("Transaction signed successfully", {
        signer: signer.publicKey.toString(),
      })

      return transaction
    } catch (error) {
      logger.error("Failed to sign transaction", error as Error)
      throw error
    }
  }
}

