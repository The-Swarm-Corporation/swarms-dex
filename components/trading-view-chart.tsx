'use client'

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { 
  createChart, 
  ColorType, 
  LineStyle, 
  CandlestickSeries,
  HistogramSeries,
  CrosshairMode,
  UTCTimestamp,
  PriceFormat
} from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'
import { MarketData } from "@/lib/market"
import { formatNumber } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface TradingViewChartProps {
  data: MarketData | null
  symbol: string
}

// Time intervals in milliseconds
const TIME_INTERVALS = {
  '1H': 60 * 60 * 1000,
  '4H': 4 * 60 * 60 * 1000,
  '1D': 24 * 60 * 60 * 1000,
  '1W': 7 * 24 * 60 * 60 * 1000,
  'ALL': Infinity
} as const

type TimeInterval = keyof typeof TIME_INTERVALS

export function TradingViewChart({ data, symbol }: TradingViewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const [selectedInterval, setSelectedInterval] = useState<TimeInterval>('1D')

  // Filter data based on selected time interval
  const getFilteredData = () => {
    if (!data?.priceHistory) return []
    
    const now = Date.now()
    const interval = TIME_INTERVALS[selectedInterval]
    
    return data.priceHistory.filter(item => 
      selectedInterval === 'ALL' || (now - item.time.getTime()) <= interval
    )
  }

  useEffect(() => {
    if (!chartContainerRef.current || !data) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#000000' },
        textColor: '#d1d5db',
        fontSize: 12,
        fontFamily: 'Inter, sans-serif',
      },
      localization: {
        locale: 'en-US',
        priceFormatter: (price: number) => {
          // Show price in SWARMS with fixed precision
          return `${price.toFixed(10)}`;
        }
      },
      grid: {
        vertLines: { color: 'rgba(220, 38, 38, 0.1)' },
        horzLines: { color: 'rgba(220, 38, 38, 0.1)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#dc2626',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#dc2626',
        },
        horzLine: {
          color: '#dc2626',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#dc2626',
        },
      },
      timeScale: {
        borderColor: 'rgba(220, 38, 38, 0.2)',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 12,
      },
      rightPriceScale: {
        borderColor: 'rgba(220, 38, 38, 0.2)',
        scaleMargins: {
          top: 0.1,
          bottom: 0.3,
        },
        mode: 0,
        autoScale: true,
        alignLabels: true,
        borderVisible: true,
        visible: true,
        entireTextOnly: false,
        ticksVisible: true,
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
    })

    // Main candlestick series
    const mainSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceFormat: {
        type: 'price',
        precision: 10,
        minMove: 0.0000000001,
      },
      priceScaleId: 'right',
      autoscaleInfoProvider: () => ({
        priceRange: {
          minValue: Math.min(...formattedData.map(d => d.low)),
          maxValue: Math.max(...formattedData.map(d => d.high))
        }
      })
    })

    // Volume series with custom price format
    const volumePriceFormat: PriceFormat = {
      type: 'volume',
      precision: 2,
      minMove: 0.01,
    }

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#22c55e',
      priceFormat: volumePriceFormat,
      priceScaleId: 'volume', // Separate scale for volume
    })

    // Set up separate scale for volume
    chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: 0.8, // Position volume at the bottom 20%
        bottom: 0.02, // Small margin at the bottom
      },
      borderVisible: false,
    })

    // Format the filtered data
    const filteredData = getFilteredData()
    const formattedData = filteredData.map(item => ({
      time: Math.floor(item.time.getTime() / 1000) as UTCTimestamp,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
    }))

    const volumeData = filteredData.map(item => ({
      time: Math.floor(item.time.getTime() / 1000) as UTCTimestamp,
      value: item.volume,
      color: item.close >= item.open ? '#22c55e80' : '#ef444480'
    }))

    mainSeries.setData(formattedData)
    volumeSeries.setData(volumeData)

    // Fit content and add some margin
    chart.timeScale().fitContent()

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ 
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        })
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [data, symbol, selectedInterval])

  return (
    <Card className="bg-black/50 border-red-600/20">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl font-bold text-red-600">
            {symbol} Price Chart
          </CardTitle>
          <div className="flex items-center gap-2">
            {(Object.keys(TIME_INTERVALS) as TimeInterval[]).map((interval) => (
              <Button
                key={interval}
                variant={selectedInterval === interval ? "default" : "outline"}
                size="sm"
                className={selectedInterval === interval ? "bg-red-600 hover:bg-red-700" : "hover:bg-red-600/10"}
                onClick={() => setSelectedInterval(interval)}
              >
                {interval}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div ref={chartContainerRef} className="w-full h-[400px]" />
      </CardContent>
    </Card>
  )
}

