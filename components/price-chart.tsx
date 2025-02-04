'use client'

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MarketData } from "@/lib/market"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { format } from "date-fns"

interface PriceChartProps {
  data: MarketData
  symbol: string
}

export function PriceChart({ data, symbol }: PriceChartProps) {
  const chartData = data.priceHistory.map(point => ({
    time: point.time,
    price: point.price
  }))

  return (
    <Card className="bg-black/50 border-red-600/20">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-red-600">
          {symbol} Price Chart
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="price" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#dc2626" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time"
                tickFormatter={(time) => format(new Date(time), "HH:mm")}
                stroke="#666"
              />
              <YAxis
                tickFormatter={(value) => `$${value.toFixed(4)}`}
                stroke="#666"
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="bg-black/90 border border-red-600/20 p-2 rounded-lg shadow-lg">
                        <p className="text-gray-400">
                          {format(new Date(payload[0].payload.time), "HH:mm")}
                        </p>
                        <p className="text-red-600 font-bold">
                          ${payload[0].value?.toFixed(4)}
                        </p>
                      </div>
                    )
                  }
                  return null
                }}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke="#dc2626"
                fill="url(#price)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

