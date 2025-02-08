'use client'

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { 
  createChart, 
  ColorType, 
  LineStyle, 
  CandlestickSeries,
  HistogramSeries,
  CrosshairMode,
  UTCTimestamp
} from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import { MarketData } from "@/lib/market"

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
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#666',
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
      },
      rightPriceScale: {
        borderColor: 'rgba(220, 38, 38, 0.2)',
        scaleMargins: {
          top: 0.2,
          bottom: 0.2,
        },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
    })

    // Main candlestick series
    const mainSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })

    // Volume series
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: 'overlay',
    })

    // Set volume series to be overlaid at the bottom 20% of the chart
    chart.priceScale('overlay').applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    })

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
      color: item.close >= item.open ? '#26a69a50' : '#ef535050'
    }))

    mainSeries.setData(formattedData)
    volumeSeries.setData(volumeData)

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth })
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [data])

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

