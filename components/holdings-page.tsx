'use client';

import React, { useState, useEffect } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { AlertCircle, Loader } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/components/providers/auth-provider';

// Types
type TokenAmount = {
  amount: string;
  decimals: number;
  uiAmount: number | null;
  uiAmountString: string;
};

type TokenInfo = {
  mint: string;
  owner: string;
  tokenAmount: TokenAmount;
  state: string;
};

type JupiterToken = {
  address: string;
  chainId: number;
  decimals: number;
  name: string;
  symbol: string;
  logoURI?: string;
  tags?: string[];
  verified?: boolean;
};

type TokenData = {
  mint: string;
  amount: number | null;
  decimals: number;
  symbol: string;
  name: string;
  logoURI?: string;
};

const RPC_URLS = [
  process.env.NEXT_PUBLIC_RPC_URL,
  'https://api.mainnet-beta.solana.com',
  'https://solana-mainnet.g.alchemy.com/v2/demo',
  'https://rpc.ankr.com/solana'
];

const JUPITER_TOKEN_LIST_URL = 'https://token.jup.ag/strict';

const TokenGallery: React.FC = () => {
  const { user, loading: authLoading, isAuthenticated, walletAddress } = useAuth();
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [tokenList, setTokenList] = useState<Map<string, JupiterToken>>(new Map());

  // Fetch Jupiter token list
  useEffect(() => {
    const fetchTokenList = async () => {
      try {
        const response = await fetch(JUPITER_TOKEN_LIST_URL);
        if (!response.ok) {
          throw new Error('Failed to fetch token list');
        }
        const data = await response.json();
        const tokenMap = new Map<string, JupiterToken>();
        data.forEach((token: JupiterToken) => {
          // Store by mint address
          tokenMap.set(token.address.toLowerCase(), token);
        });
        setTokenList(tokenMap);
      } catch (err) {
        console.error('Failed to fetch Jupiter token list:', err);
        setError('Failed to load token metadata');
      }
    };
    fetchTokenList();
  }, []);

  const getWorkingConnection = async (): Promise<Connection> => {
    for (const url of RPC_URLS) {
      if (!url) continue;
      try {
        const connection = new Connection(url, 'confirmed');
        await connection.getLatestBlockhash();
        return connection;
      } catch (err) {
        console.warn(`RPC ${url} failed, trying next...`);
        continue;
      }
    }
    throw new Error('All RPC endpoints failed');
  };

  // Fetch tokens when authenticated and wallet address is available
  useEffect(() => {
    if (!authLoading && isAuthenticated && walletAddress) {
      fetchTokens(walletAddress);
    }
  }, [authLoading, isAuthenticated, walletAddress]);

  const fetchTokens = async (address: string) => {
    setLoading(true);
    setError('');
    try {
      const connection = await getWorkingConnection();
      
      const response = await connection.getParsedTokenAccountsByOwner(
        new PublicKey(address),
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );

      const tokenData = response.value
        .map((item: any) => {
          const mint = item.account.data.parsed.info.mint;
          const metadata = tokenList.get(mint.toLowerCase());
          const amount = item.account.data.parsed.info.tokenAmount.uiAmount;
          
          // Skip tokens with zero balance
          if (!amount || amount === 0) return null;

          const token: TokenData = {
            mint,
            amount,
            decimals: item.account.data.parsed.info.tokenAmount.decimals,
            symbol: metadata?.symbol || mint.slice(0, 6),
            name: metadata?.name || `Token ${mint.slice(0, 8)}...`,
            logoURI: metadata?.logoURI
          };
          return token;
        })
        .filter((token): token is TokenData => token !== null)
        .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

      setTokens(tokenData);
    } catch (err) {
      console.error('Token fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch tokens');
    } finally {
      setLoading(false);
    }
  };

  // Show loading state while auth is loading
  if (authLoading) {
    return (
      <div className="min-h-screen bg-black p-8 flex justify-center items-center">
        <Loader className="h-12 w-12 animate-spin text-red-600" />
      </div>
    );
  }

  // Show message if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-black p-8">
        <div className="text-center py-20 border border-red-900/30 rounded-xl bg-black">
          <p className="text-red-500 text-xl">Please connect your wallet to view your holdings</p>
          <p className="text-gray-600 mt-2">Use the wallet button in the navigation bar to connect</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black p-8">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="text-5xl font-bold text-red-600 mb-6 tracking-tighter">Token Holdings</h1>
        {walletAddress && (
          <p className="text-red-400 mt-4 font-mono text-sm">
            Wallet: {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
          </p>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <Alert variant="destructive" className="mb-6 bg-black border-red-600">
          <AlertCircle className="h-4 w-4 text-red-500" />
          <AlertDescription className="text-red-500">{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center items-center py-20">
          <Loader className="h-12 w-12 animate-spin text-red-600" />
        </div>
      )}

      {/* Token Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tokens.map((token) => (
          <div
            key={token.mint}
            className="bg-black rounded-xl p-6 transform transition 
                     hover:scale-105 border border-red-600/50 
                     shadow-lg hover:shadow-red-600/30"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  {token.logoURI && (
                    <img 
                      src={token.logoURI} 
                      alt={token.symbol} 
                      className="w-6 h-6 rounded-full"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  <span className="text-red-500 font-bold text-xl">
                    {token.symbol}
                  </span>
                </div>
                <span className="text-gray-500 text-sm mt-1">
                  {token.name}
                </span>
              </div>
              <div className="text-right">
                <p className="text-red-400 text-sm">Balance</p>
                <p className="text-white font-bold text-lg">
                  {token.amount?.toLocaleString(undefined, {
                    maximumFractionDigits: 6
                  }) ?? '0'}
                </p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-red-900/30">
              <p className="text-gray-600 text-sm">Token Address</p>
              <p className="text-red-300 font-mono text-sm truncate">
                {token.mint}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {!loading && tokens.length === 0 && (
        <div className="text-center py-20 border border-red-900/30 rounded-xl bg-black">
          <p className="text-red-500 text-xl">No tokens found in this wallet</p>
          <p className="text-gray-600 mt-2">Try connecting a different wallet or check back later</p>
        </div>
      )}
    </div>
  );
};

export default TokenGallery;