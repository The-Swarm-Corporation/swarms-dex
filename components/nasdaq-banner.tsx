import React, { useEffect, useState } from 'react';
import { ArrowRight, TrendingUp, TrendingDown } from 'lucide-react';

const TokenTicker = ({ tokens }: { tokens: any[] }) => {
  const [offset, setOffset] = useState(0);
  
  useEffect(() => {
    const animate = () => {
      setOffset((prev) => (prev <= -100 ? 0 : prev - 0.05));
    };
    
    const animation = setInterval(animate, 16);
    return () => clearInterval(animation);
  }, []);

  // Duplicate tokens array to create seamless loop
  const displayTokens = [...tokens, ...tokens];

  return (
    <div className="w-full bg-black/60 border-y border-red-500/20 backdrop-blur-sm overflow-hidden py-2">
      <div 
        className="flex items-center whitespace-nowrap"
        style={{ transform: `translateX(${offset}%)` }}
      >
        {displayTokens.map((token, index) => (
          <div 
            key={`${token.id}-${index}`}
            className="flex items-center mr-8 font-mono"
          >
            <div className="w-6 h-6 rounded-full overflow-hidden mr-2 bg-black/20">
              {token.image_url && (
                <img 
                  src={token.image_url} 
                  alt={token.name}
                  className="w-full h-full object-cover"
                />
              )}
            </div>
            
            <span className="text-red-500 font-semibold mr-2">
              {token.token_symbol}
            </span>
            
            <span className="text-gray-400 mr-2">
              ${(token.market?.stats?.price || token.current_price || 0).toFixed(4)}
            </span>
            
            {token.price_change_24h !== undefined && (
              <span className={`flex items-center ${
                token.price_change_24h >= 0 ? 'text-green-500' : 'text-red-500'
              }`}>
                {token.price_change_24h >= 0 ? (
                  <TrendingUp className="h-3 w-3 mr-1" />
                ) : (
                  <TrendingDown className="h-3 w-3 mr-1" />
                )}
                {token.price_change_24h.toFixed(2)}%
              </span>
            )}
            
            <ArrowRight className="h-4 w-4 text-red-500/50 ml-8" />
          </div>
        ))}
      </div>
    </div>
  );
};

export default TokenTicker;