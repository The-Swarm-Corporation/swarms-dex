'use client';

import React, { useState, useEffect } from 'react';
import { AlertCircle, Loader, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/components/providers/auth-provider';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface TokenHolding {
  symbol: string;
  balance: number;
  mintAddress: string;
  uiAmount: number;
  decimals: number;
  currentPrice: number;
  value: number;
  imageUrl?: string | null;
}

const TokenGallery: React.FC = () => {
  const { loading: authLoading, isAuthenticated, walletAddress } = useAuth();
  const [holdings, setHoldings] = useState<TokenHolding[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const fetchHoldings = async () => {
    if (!isAuthenticated || !walletAddress) {
      setError('Please connect your wallet first');
      return;
    }

    try {
      setLoading(true);
      setError('');
      
      const response = await fetch(`/api/tokens/holdings?wallet=${walletAddress}`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch holdings');
      }

      const holdings = await response.json();
      if (!Array.isArray(holdings)) {
        throw new Error('Invalid holdings data received');
      }

      console.log('Holdings fetched:', holdings);
      setHoldings(holdings);
    } catch (err) {
      console.error('Failed to fetch holdings:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch holdings';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && isAuthenticated && walletAddress) {
      fetchHoldings();
    }
  }, [authLoading, isAuthenticated, walletAddress]);

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

  const currencies = holdings.filter(h => h.symbol === "SOL" || h.symbol === "SWARMS");
  const agentTokens = holdings.filter(h => h.symbol !== "SOL" && h.symbol !== "SWARMS");
  const totalValue = holdings.reduce((sum, holding) => sum + holding.value, 0);

  return (
    <div className="min-h-screen bg-black p-8">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="text-5xl font-bold text-red-600 mb-6 tracking-tighter">Token Holdings</h1>
        <div className="flex items-center justify-center gap-4">
          {walletAddress && (
            <p className="text-red-400 mt-4 font-mono text-sm">
              Wallet: {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-4 text-red-400 hover:text-red-300"
            onClick={fetchHoldings}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
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

      {/* Currency Summary */}
      {!loading && holdings.length > 0 && (
        <div className="mb-8 p-6 rounded-xl bg-gradient-to-r from-red-600/10 to-red-900/10 border border-red-600/30">
          <div className="flex justify-between items-center">
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-red-500">Portfolio Value</h2>
              <p className="text-3xl font-bold text-white">
                ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="flex gap-6">
              {currencies.map((currency) => (
                <div key={currency.symbol} className="text-right">
                  <p className="text-sm text-gray-400">{currency.symbol}</p>
                  <p className="text-lg font-mono text-white">
                    {currency.uiAmount.toLocaleString(undefined, {
                      maximumFractionDigits: currency.decimals,
                    })}
                  </p>
                  <p className="text-sm text-gray-400">
                    ${(currency.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Agent Tokens Grid */}
      {!loading && agentTokens.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agentTokens
            .sort((a, b) => b.value - a.value)
            .map((token) => (
              <div
                key={token.mintAddress}
                className="bg-black rounded-xl p-6 transform transition 
                         hover:scale-105 border border-red-600/50 
                         shadow-lg hover:shadow-red-600/30"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      {token.imageUrl ? (
                        <img 
                          src={token.imageUrl} 
                          alt={token.symbol}
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-red-600/20" />
                      )}
                      <span className="text-red-500 font-bold text-xl">
                        {token.symbol}
                      </span>
                      <Link
                        href={`/agent/${token.mintAddress}`}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-red-400 text-sm">Balance</p>
                    <p className="text-white font-bold text-lg">
                      {token.uiAmount.toLocaleString(undefined, {
                        maximumFractionDigits: token.decimals,
                      })}
                    </p>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-red-900/30">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-gray-600 text-sm">Value</p>
                      <p className="text-red-300 font-mono">
                        ${token.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-gray-600 text-sm">Price</p>
                      <p className="text-red-300 font-mono">
                        ${token.currentPrice.toFixed(11)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
        </div>
      ) : !loading && (
        <div className="text-center py-20 border border-red-900/30 rounded-xl bg-black">
          <p className="text-red-500 text-xl">No AI agents currently owned</p>
          <p className="text-gray-600 mt-2">Purchase agent tokens to get started</p>
        </div>
      )}
    </div>
  );
};

export default TokenGallery;