import { NextResponse } from "next/server"
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token"
import { logger } from "@/lib/logger"
import { getWeb3AgentByMint } from "@/lib/supabase/api"

const SWARMS_TOKEN_MINT = process.env.NEXT_PUBLIC_SWARMS_TOKEN_ADDRESS as string

async function getTokenPrices() {
  try {
    // Fetch both SOL and SWARMS prices from CoinGecko
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana,swarms&vs_currencies=usd',
      { next: { revalidate: 60 } } // Cache for 1 minute
    )
    const data = await response.json()
    
    const solPrice = data?.solana?.usd || 0
    const swarmsPrice = data?.swarms?.usd || 0

    logger.debug("Fetched token prices from CoinGecko", {
      sol: solPrice,
      swarms: swarmsPrice
    })

    return {
      sol: solPrice,
      swarms: swarmsPrice
    }
  } catch (error) {
    logger.error("Failed to fetch token prices from CoinGecko", error as Error)
    return {
      sol: 0,
      swarms: 0
    }
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const walletAddress = searchParams.get("wallet")

    if (!walletAddress) {
      return NextResponse.json(
        { error: "Wallet address is required" },
        { status: 400 }
      )
    }

    logger.info("Fetching token holdings", { wallet: walletAddress })

    const connection = new Connection(
      process.env.RPC_URL as string,
      "confirmed"
    )

    const publicKey = new PublicKey(walletAddress)

    // Get token prices
    const prices = await getTokenPrices()

    // Get SOL balance
    const solBalance = await connection.getBalance(publicKey)
    const solBalanceInSOL = solBalance / LAMPORTS_PER_SOL

    // Get SWARMS balance
    let swarmsBalance = 0
    try {
      const swarmsTokenAccount = await getAssociatedTokenAddress(
        new PublicKey(SWARMS_TOKEN_MINT),
        publicKey
      )
      const swarmsAccountInfo = await connection.getTokenAccountBalance(swarmsTokenAccount)
      swarmsBalance = swarmsAccountInfo.value.uiAmount || 0

      logger.debug("Found SWARMS balance", {
        balance: swarmsBalance,
        price: prices.swarms
      })
    } catch (error) {
      logger.debug("No SWARMS token account found", { wallet: walletAddress })
    }

    // Get all token accounts
    const accounts = await connection.getParsedTokenAccountsByOwner(
      publicKey,
      { programId: TOKEN_PROGRAM_ID }
    )

    logger.info("Found token accounts", {
      count: accounts.value.length,
      accounts: accounts.value.map(acc => ({
        mint: acc.account.data.parsed.info.mint,
        balance: acc.account.data.parsed.info.tokenAmount.uiAmount,
        ata: acc.pubkey.toString()
      }))
    })

    // Filter and process accounts
    const holdingsPromises = accounts.value
      .filter((account) => {
        const tokenAmount = account.account.data.parsed.info.tokenAmount
        const mint = account.account.data.parsed.info.mint
        return tokenAmount.uiAmount > 0 && mint !== SWARMS_TOKEN_MINT
      })
      .map(async (account) => {
        const parsedInfo = account.account.data.parsed.info
        const mintAddress = parsedInfo.mint
        const tokenAmount = parsedInfo.tokenAmount
        const balance = tokenAmount.uiAmount || 0
        const decimals = tokenAmount.decimals

        try {
          const agent = await getWeb3AgentByMint(mintAddress)
          if (agent) {
            const currentPrice = agent.current_price || 0
            logger.debug("Found agent token", {
              mint: mintAddress,
              ata: account.pubkey.toString(),
              symbol: agent.token_symbol,
              balance,
              currentPrice,
            })
            return {
              symbol: agent.token_symbol,
              balance,
              mintAddress,
              uiAmount: balance,
              decimals,
              currentPrice,
              value: currentPrice * balance
            }
          } else {
            logger.debug("No agent found for token", {
              mint: mintAddress,
              ata: account.pubkey.toString(),
              balance,
              decimals
            })
          }
        } catch (error) {
          logger.error("Error fetching agent details", error as Error, {
            mintAddress,
            ata: account.pubkey.toString()
          })
        }
        return null
      })

    const agentHoldings = (await Promise.all(holdingsPromises))
      .filter((holding) => holding !== null)
      .sort((a, b) => b!.value - a!.value)

    // Combine all holdings including SOL and SWARMS
    const allHoldings = [
      {
        symbol: "SOL",
        balance: solBalanceInSOL,
        mintAddress: "SOL",
        uiAmount: solBalanceInSOL,
        decimals: 9,
        currentPrice: prices.sol,
        value: solBalanceInSOL * prices.sol
      },
      {
        symbol: "SWARMS",
        balance: swarmsBalance,
        mintAddress: SWARMS_TOKEN_MINT,
        uiAmount: swarmsBalance,
        decimals: 6,
        currentPrice: prices.swarms,
        value: swarmsBalance * prices.swarms
      },
      ...agentHoldings
    ]

    logger.info("Holdings fetched successfully", {
      count: allHoldings.length,
      currencies: allHoldings.filter(h => h.symbol === "SOL" || h.symbol === "SWARMS").length,
      agents: allHoldings.filter(h => h.symbol !== "SOL" && h.symbol !== "SWARMS").length
    })

    return NextResponse.json(allHoldings)
  } catch (error) {
    logger.error("Failed to fetch holdings", error as Error)
    return NextResponse.json(
      { error: "Failed to fetch holdings" },
      { status: 500 }
    )
  }
} 