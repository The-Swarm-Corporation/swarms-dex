'use client';

import React, { useState, useEffect } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { AlertCircle, Loader } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

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

interface PhantomWindow extends Window {
  phantom?: {
    solana?: {
      connect(): Promise<{ publicKey: PublicKey }>;
      disconnect(): Promise<void>;
      isConnected: boolean;
      publicKey: PublicKey | null;
    };
  };
}

declare const window: PhantomWindow;

const RPC_URLS = [
  process.env.NEXT_PUBLIC_RPC_URL,
  'https://api.mainnet-beta.solana.com',
  'https://solana-mainnet.g.alchemy.com/v2/demo',
  'https://rpc.ankr.com/solana'
];

const JUPITER_TOKEN_LIST_URL = 'https://token.jup.ag/strict';

const TokenGallery: React.FC = () => {
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [connected, setConnected] = useState<boolean>(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [tokenList, setTokenList] = useState<Map<string, JupiterToken>>(new Map());

  // Fetch Jupiter token list
  useEffect(() => {
    const fetchTokenList = async () => {
      try {
        const response = await fetch(JUPITER_TOKEN_LIST_URL);
        const data = await response.json();
        const tokenMap = new Map();
        data.forEach((token: JupiterToken) => {
          tokenMap.set(token.address, token);
        });
        setTokenList(tokenMap);
      } catch (err) {
        console.error('Failed to fetch Jupiter token list:', err);
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

  const checkWalletConnection = async () => {
    if (window.phantom?.solana?.isConnected && window.phantom.solana.publicKey) {
      setConnected(true);
      setPublicKey(window.phantom.solana.publicKey.toString());
      return true;
    }
    return false;
  };

  useEffect(() => {
    checkWalletConnection().then(isConnected => {
      if (isConnected && window.phantom?.solana?.publicKey) {
        fetchTokens(window.phantom.solana.publicKey.toString());
      }
    });
  }, []);

  const connectWallet = async () => {
    try {
      if (!window.phantom?.solana) {
        throw new Error('Phantom wallet not found! Please install it first.');
      }

      const response = await window.phantom.solana.connect();
      setConnected(true);
      setPublicKey(response.publicKey.toString());
      await fetchTokens(response.publicKey.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet');
    }
  };

  const fetchTokens = async (walletPublicKey: string) => {
    setLoading(true);
    setError('');
    try {
      const connection = await getWorkingConnection();
      
      const response = await connection.getParsedTokenAccountsByOwner(
        new PublicKey(walletPublicKey),
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );

      const tokenData: TokenData[] = response.value
        .map((item: any) => {
          const mint = item.account.data.parsed.info.mint;
          const metadata = tokenList.get(mint);
          return {
            mint,
            amount: item.account.data.parsed.info.tokenAmount.uiAmount,
            decimals: item.account.data.parsed.info.tokenAmount.decimals,
            symbol: metadata?.symbol || 'Unknown',
            name: metadata?.name || 'Unknown Token',
            logoURI: metadata?.logoURI
          };
        })
        .filter(token => token.amount && token.amount > 0)
        .sort((a, b) => (b.amount || 0) - (a.amount || 0));

      setTokens(tokenData);
    } catch (err) {
      console.error('Token fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch tokens');
    } finally {
      setLoading(false);
    }
  };

  const disconnectWallet = async () => {
    try {
      if (window.phantom?.solana) {
        await window.phantom.solana.disconnect();
        setConnected(false);
        setPublicKey(null);
        setTokens([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect wallet');
    }
  };

  return (
    <div className="min-h-screen bg-black p-8">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="text-5xl font-bold text-red-600 mb-6 tracking-tighter">Token Holdings</h1>
        <div className="flex justify-center gap-4">
          {!connected ? (
            <button
              onClick={connectWallet}
              className="bg-red-600 hover:bg-red-700 text-white px-8 py-4 rounded-lg 
                       shadow-lg transform transition hover:scale-105 
                       border border-red-400 hover:shadow-red-500/50"
            >
              Connect Phantom Wallet
            </button>
          ) : (
            <button
              onClick={disconnectWallet}
              className="bg-black hover:bg-gray-900 text-red-500 px-8 py-4 rounded-lg 
                       shadow-lg transform transition hover:scale-105 
                       border border-red-500 hover:shadow-red-500/50"
            >
              Disconnect Wallet
            </button>
          )}
        </div>
        {publicKey && (
          <p className="text-red-400 mt-4 font-mono text-sm">
            Connected: {publicKey.slice(0, 4)}...{publicKey.slice(-4)}
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
                <span className="text-red-500 font-bold text-xl">
                  {token.symbol}
                </span>
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
      {connected && !loading && tokens.length === 0 && (
        <div className="text-center py-20 border border-red-900/30 rounded-xl bg-black">
          <p className="text-red-500 text-xl">No tokens found in this wallet</p>
          <p className="text-gray-600 mt-2">Connect a different wallet or try again later</p>
        </div>
      )}
    </div>
  );
};

export default TokenGallery;