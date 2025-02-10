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
import { useEffect, useRef } from 'react'
import { MarketData } from "@/lib/market"
import { formatNumber } from "@/lib/utils"

interface TradingViewChartProps {
  data: MarketData | null
  symbol: string
}

export function TradingViewChart({ data, symbol }: TradingViewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chartContainerRef.current || !data) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#000000' },
        textColor: '#d1d5db',
        fontSize: 12,
        fontFamily: 'Inter, sans-serif',
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
          bottom: 0.3, // Give more space at the bottom for volume
        },
        mode: 2, // Logarithmic scale
        autoScale: true,
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
        precision: 8,
        minMove: 0.00000001,
      },
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

    // Format the data
    const formattedData = data.priceHistory.map(item => ({
      time: Math.floor(item.time.getTime() / 1000) as UTCTimestamp,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
    }))

    const volumeData = data.priceHistory.map(item => ({
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
  }, [data, symbol])

  return (
    <Card className="bg-black/50 border-red-600/20">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-red-600">
          {symbol} Price Chart
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={chartContainerRef} className="w-full h-[400px]" />
      </CardContent>
    </Card>
  )
}

