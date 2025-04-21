'use client'

import { Card, CardContent } from "@/components/ui/card"
import { useEffect, useRef } from 'react'

interface GeckoTerminalChartProps {
  poolAddress: string
}

export function GeckoTerminalChart({ poolAddress }: GeckoTerminalChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Load GeckoTerminal widget script
    const script = document.createElement('script')
    script.src = 'https://widgets.geckoterminal.com/js/geckoterminal-widget.js'
    script.async = true
    document.body.appendChild(script)

    return () => {
      document.body.removeChild(script)
    }
  }, [])

  return (
    <Card className="bg-black/50 border-red-600/20 overflow-hidden">
      <CardContent className="p-0">
        <div 
          ref={containerRef}
          className="w-full h-[600px]"
          data-gecko-terminal-widget="candlesticks"
          data-gecko-terminal-params={JSON.stringify({
            network: "solana",
            dex: "meteora",
            pool_address: poolAddress,
            theme: "dark",
            height: "600px"
          })}
        />
      </CardContent>
    </Card>
  )
} 