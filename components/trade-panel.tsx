'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"

interface TradePanelProps {
  symbol: string
  currentPrice: number
}

export function TradePanel({ symbol, currentPrice }: TradePanelProps) {
  const [amount, setAmount] = useState('')
  
  const handleTrade = async (side: 'buy' | 'sell') => {
    try {
      // @ts-ignore - Phantom wallet type
      const provider = window?.phantom?.solana
      
      if (!provider?.isConnected) {
        toast.error("Please connect your wallet first")
        return
      }

      if (!amount || isNaN(parseFloat(amount))) {
        toast.error("Please enter a valid amount")
        return
      }

      toast.loading(`Processing ${side} order...`)
      
      // Simulate order processing
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      toast.success(`${side.toUpperCase()} order placed successfully!`, {
        description: `${amount} ${symbol} at $${currentPrice}`
      })
      
      setAmount('')
    } catch (error) {
      console.error(`Error placing ${side} order:`, error)
      toast.error(`Failed to place ${side} order`)
    }
  }

  return (
    <Card className="bg-black/50 border-red-600/20">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-red-600">
          Trade {symbol}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="buy">
          <TabsList className="grid w-full grid-cols-2 bg-black/50">
            <TabsTrigger 
              value="buy"
              className="data-[state=active]:bg-red-600"
            >
              Buy
            </TabsTrigger>
            <TabsTrigger 
              value="sell"
              className="data-[state=active]:bg-gray-600"
            >
              Sell
            </TabsTrigger>
          </TabsList>
          <TabsContent value="buy">
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Amount ({symbol})</Label>
                <Input
                  type="number"
                  placeholder="Enter amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="bg-black/50 border-red-600/20 focus:border-red-600"
                />
              </div>
              <div className="space-y-2">
                <Label>Price</Label>
                <Input
                  type="text"
                  value={`$${currentPrice}`}
                  disabled
                  className="bg-black/50 border-red-600/20"
                />
              </div>
              <div className="space-y-2">
                <Label>Total</Label>
                <Input
                  type="text"
                  value={`$${(parseFloat(amount || '0') * currentPrice).toFixed(2)}`}
                  disabled
                  className="bg-black/50 border-red-600/20"
                />
              </div>
              <Button
                className="w-full bg-red-600 hover:bg-red-700"
                onClick={() => handleTrade('buy')}
              >
                Buy {symbol}
              </Button>
            </div>
          </TabsContent>
          <TabsContent value="sell">
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Amount ({symbol})</Label>
                <Input
                  type="number"
                  placeholder="Enter amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="bg-black/50 border-gray-600/20 focus:border-gray-600"
                />
              </div>
              <div className="space-y-2">
                <Label>Price</Label>
                <Input
                  type="text"
                  value={`$${currentPrice}`}
                  disabled
                  className="bg-black/50 border-gray-600/20"
                />
              </div>
              <div className="space-y-2">
                <Label>Total</Label>
                <Input
                  type="text"
                  value={`$${(parseFloat(amount || '0') * currentPrice).toFixed(2)}`}
                  disabled
                  className="bg-black/50 border-gray-600/20"
                />
              </div>
              <Button
                className="w-full bg-gray-600 hover:bg-gray-700"
                onClick={() => handleTrade('sell')}
              >
                Sell {symbol}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

