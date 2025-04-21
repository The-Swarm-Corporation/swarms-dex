'use client'

import { Card, CardContent } from "@/components/ui/card"
import { useEffect, useRef, useState } from 'react'

interface GeckoTerminalChartProps {
  poolAddress: string
}

export function GeckoTerminalChart({ poolAddress }: GeckoTerminalChartProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!poolAddress) {
      setError('Pool address is required')
      setIsLoading(false)
      return
    }

    // Format the pool address to match GeckoTerminal's URL structure
    const formattedPoolAddress = poolAddress.trim()

    // Create the iframe URL with the exact parameters from GeckoTerminal's implementation
    const iframeUrl = `https://www.geckoterminal.com/solana/pools/${formattedPoolAddress}?embed=1&info=0&swaps=0&grayscale=1&light_chart=0&chart_type=price&resolution=15m`
    
    if (iframeRef.current) {
      iframeRef.current.src = iframeUrl
    }

    const handleIframeLoad = () => {
      // Check if the iframe loaded successfully
      try {
        if (iframeRef.current) {
          // Access contentWindow to check if the page loaded properly
          const iframeContent = iframeRef.current.contentWindow
          if (iframeContent) {
            setIsLoading(false)
          }
        }
      } catch (err) {
        console.error('Failed to load GeckoTerminal chart:', err)
        setError('Failed to load chart data')
        setIsLoading(false)
      }
    }

    const handleIframeError = () => {
      console.error('Failed to load GeckoTerminal chart for pool:', formattedPoolAddress)
      setError('Failed to load chart data. Please check if the pool exists on GeckoTerminal.')
      setIsLoading(false)
    }

    if (iframeRef.current) {
      iframeRef.current.addEventListener('load', handleIframeLoad)
      iframeRef.current.addEventListener('error', handleIframeError)
    }

    return () => {
      if (iframeRef.current) {
        iframeRef.current.removeEventListener('load', handleIframeLoad)
        iframeRef.current.removeEventListener('error', handleIframeError)
      }
    }
  }, [poolAddress])

  if (error) {
    return (
      <Card className="bg-black/50 border-red-600/20">
        <CardContent className="p-4">
          <div className="text-red-500">
            {error}
            <div className="text-xs mt-2">Pool Address: {poolAddress}</div>
            <a 
              href={`https://www.geckoterminal.com/solana/pools/${poolAddress}`} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-xs text-red-400 hover:text-red-300 mt-2 block"
            >
              View Pool on GeckoTerminal →
            </a>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-black/50 border-red-600/20 overflow-hidden">
      <CardContent className="p-0">
        {isLoading && (
          <div className="flex items-center justify-center h-[600px] text-gray-400">
            Loading chart...
          </div>
        )}
        <iframe
          ref={iframeRef}
          id="geckoterminal-embed"
          title="GeckoTerminal Embed"
          className="w-full h-[600px] border-0"
          style={{ display: isLoading ? 'none' : 'block' }}
          frameBorder="0"
          allow="clipboard-write"
          allowFullScreen
        />
      </CardContent>
    </Card>
  )
}

// Add TypeScript type for the GeckoTerminal widget
declare global {
  interface Window {
    GeckoTerminalWidget?: {
      init: () => void
    }
  }
} 