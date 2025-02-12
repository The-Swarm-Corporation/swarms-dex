import { NextResponse } from "next/server"
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token"
import { logger } from "@/lib/logger"
import { getServiceClient } from "@/lib/supabase/client"

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

interface AgentData {
  mint_address: string
  token_symbol: string
  current_price: number | null
  market_cap: number | null
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

    // Log all token accounts for debugging
    logger.info("Found token accounts", {
      count: accounts.value.length,
      accounts: accounts.value.map(acc => ({
        mint: acc.account.data.parsed.info.mint,
        balance: acc.account.data.parsed.info.tokenAmount.uiAmount,
        decimals: acc.account.data.parsed.info.tokenAmount.decimals,
        ata: acc.pubkey.toString()
      }))
    })

    // Get all mint addresses except SWARMS
    const mintAddresses = accounts.value
      .filter(account => {
        const tokenAmount = account.account.data.parsed.info.tokenAmount
        const mint = account.account.data.parsed.info.mint
        const hasBalance = tokenAmount.uiAmount > 0
        const notSwarms = mint !== SWARMS_TOKEN_MINT
        
        logger.debug("Filtering token account", {
          mint,
          balance: tokenAmount.uiAmount,
          hasBalance,
          notSwarms,
          included: hasBalance && notSwarms
        })
        
        return hasBalance && notSwarms
      })
      .map(account => account.account.data.parsed.info.mint)

    logger.info("Filtered mint addresses", { mintAddresses })

    // Fetch agent data for each token individually
    const supabase = getServiceClient()
    const agentPromises = mintAddresses.map(async (mintAddress) => {
      const { data, error } = await supabase
        .from("web3agents")
        .select(`
          mint_address,
          token_symbol,
          current_price,
          market_cap
        `)
        .eq('mint_address', mintAddress)
        .limit(1)

      if (error) {
        logger.error("Failed to fetch agent data for mint", error, { mint: mintAddress })
        return null
      }

      // Get the first result if any exists
      const agent = data?.[0]
      if (!agent) {
        logger.debug("No agent found for mint", { mint: mintAddress })
        return null
      }

      return agent as AgentData
    })

    const agentResults = await Promise.all(agentPromises)
    const agents = agentResults.filter((agent): agent is AgentData => agent !== null)

    logger.info("Found agents in database", {
      count: agents.length,
      agents: agents.map((a: AgentData) => ({
        mint: a.mint_address,
        symbol: a.token_symbol,
        price: a.current_price
      }))
    })

    // Create a map of mint address to agent data
    const agentMap = new Map(agents.map((agent: AgentData) => {
      logger.debug("Creating agent map entry", {
        original_mint: agent.mint_address,
        lowercase_mint: agent.mint_address.toLowerCase(),
        agent_symbol: agent.token_symbol
      });
      return [
        agent.mint_address.toLowerCase(),
        {
          token_symbol: agent.token_symbol,
          current_price: agent.current_price || 0,
          market_cap: agent.market_cap || 0
        }
      ]
    }))

    // Process token accounts with agent data
    const agentHoldings = accounts.value
      .filter((account) => {
        const tokenAmount = account.account.data.parsed.info.tokenAmount
        const mint = account.account.data.parsed.info.mint
        return tokenAmount.uiAmount > 0 && mint !== SWARMS_TOKEN_MINT
      })
      .map((account) => {
        const parsedInfo = account.account.data.parsed.info
        const mintAddress = parsedInfo.mint
        const tokenAmount = parsedInfo.tokenAmount
        const balance = tokenAmount.uiAmount || 0
        const decimals = tokenAmount.decimals
        
        // Try to find agent by mint address (case insensitive)
        logger.debug("Looking up agent for mint", {
          mint_to_find: mintAddress,
          mint_to_find_lowercase: mintAddress.toLowerCase(),
          available_mints: Array.from(agentMap.keys()),
          has_agent: agentMap.has(mintAddress.toLowerCase())
        });
        
        const agent = agentMap.get(mintAddress.toLowerCase())

        if (agent) {
          const currentPrice = agent.current_price || 0
          logger.debug("Found agent token", {
            mint: mintAddress,
            ata: account.pubkey.toString(),
            symbol: agent.token_symbol,
            balance,
            currentPrice
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
            balance,
            decimals
          })
        }
        return null
      })
      .filter((holding): holding is NonNullable<typeof holding> => holding !== null)
      .sort((a, b) => b.value - a.value)

    logger.info("Processed agent holdings", {
      totalAccounts: accounts.value.length,
      foundAgents: agentHoldings.length,
      agents: agentHoldings.map(h => ({
        symbol: h.symbol,
        balance: h.balance,
        value: h.value,
        mint: h.mintAddress
      }))
    })

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
      agents: allHoldings.filter(h => h.symbol !== "SOL" && h.symbol !== "SWARMS").length,
      holdings: allHoldings.map(h => ({
        symbol: h.symbol,
        balance: h.balance,
        value: h.value,
        mint: h.mintAddress
      }))
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