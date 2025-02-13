'use client'

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { 
  createChart, 
  ColorType, 
  LineStyle, 
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  CrosshairMode,
  UTCTimestamp,
  PriceFormat,
  IChartApi,
  ISeriesApi,
  LineStyle as ChartLineStyle,
  IPriceLine,
  SeriesOptionsMap
} from 'lightweight-charts'
import { useEffect, useRef, useState, useCallback } from 'react'
import { MarketData } from "@/lib/market"
import { formatNumber } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Loader2, Bell, LineChart, CandlestickChart } from 'lucide-react'
import { toast } from 'sonner'

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
  const chartRef = useRef<IChartApi | null>(null)
  const mainSeriesRef = useRef<ISeriesApi<'Candlestick' | 'Line'> | null>(null)
  const [selectedInterval, setSelectedInterval] = useState<TimeInterval>('1D')
  const [isLoading, setIsLoading] = useState(false)
  const [chartType, setChartType] = useState<'candlestick' | 'line'>('candlestick')
  const [priceAlerts, setPriceAlerts] = useState<{ price: number; line: IPriceLine }[]>([])

  // Filter data based on selected time interval
  const getFilteredData = () => {
    if (!data?.priceHistory) return []
    
    const now = Date.now()
    const interval = TIME_INTERVALS[selectedInterval]
    
    return data.priceHistory.filter(item => 
      selectedInterval === 'ALL' || (now - item.time.getTime()) <= interval
    )
  }

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const shortcuts: { [key: string]: TimeInterval } = {
        '1': '1H',
        '4': '4H',
        'd': '1D',
        'w': '1W',
        'a': 'ALL'
      }
      if (shortcuts[e.key]) {
        setSelectedInterval(shortcuts[e.key])
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [])

  // Add price alert
  const addPriceAlert = useCallback((price: number) => {
    if (!mainSeriesRef.current || !chartRef.current) return

    const line = mainSeriesRef.current.createPriceLine({
      price,
      color: '#dc2626',
      lineWidth: 1,
      lineStyle: ChartLineStyle.Dashed,
      axisLabelVisible: true,
      title: `Alert: ${price.toFixed(10)}`,
    })

    setPriceAlerts(prev => [...prev, { price, line }])
    
    // Set up price monitoring
    const currentPrice = data?.price || 0
    if (price > currentPrice) {
      toast.success(`Alert set for when price reaches ${price.toFixed(10)}`)
    } else {
      toast.success(`Alert set for when price drops to ${price.toFixed(10)}`)
    }
  }, [data?.price])

  useEffect(() => {
    if (!chartContainerRef.current || !data) return
    setIsLoading(true)

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
          return `${price.toFixed(10)} ${symbol}`
        },
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

    chartRef.current = chart

    // Create main series based on chart type
    const mainSeries = chart.addSeries(chartType === 'candlestick' ? CandlestickSeries : LineSeries, {
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

    mainSeriesRef.current = mainSeries

    // Volume series with custom price format
    const volumePriceFormat: PriceFormat = {
      type: 'volume',
      precision: 2,
      minMove: 0.01,
    }

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#22c55e',
      priceFormat: volumePriceFormat,
      priceScaleId: 'volume',
    })

    // Set up separate scale for volume
    chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0.02,
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

    // Custom tooltip with 24h stats
    chart.subscribeCrosshairMove(param => {
      if (!param.time || !param.point) {
        const tooltipEl = document.getElementById('chart-tooltip')
        if (tooltipEl) {
          tooltipEl.style.display = 'none'
        }
        return
      }

      const candleData = param.seriesData.get(mainSeries)
      const volumeData = param.seriesData.get(volumeSeries)
      
      if (!candleData || !volumeData) {
        return
      }

      const price = (candleData as any).close || (candleData as any).value
      const volume = (volumeData as any).value
      const percentFromHigh = data.highPrice24h ? ((data.highPrice24h - price) / data.highPrice24h * 100).toFixed(2) : '0.00'
      const percentFromLow = data.lowPrice24h ? ((price - data.lowPrice24h) / data.lowPrice24h * 100).toFixed(2) : '0.00'
      
      const tooltipEl = document.getElementById('chart-tooltip')
      if (tooltipEl) {
        tooltipEl.style.display = 'block'
        tooltipEl.style.left = `${param.point.x + 12}px`
        tooltipEl.style.top = `${param.point.y}px`
        tooltipEl.innerHTML = `
          <div class="text-sm space-y-1">
            <div class="font-medium">Price: ${price.toFixed(10)} ${symbol}</div>
            <div class="text-gray-400">Volume: ${formatNumber(volume)}</div>
            <div class="flex items-center gap-2 text-xs">
              <span class="text-green-500">24h High: ${data.highPrice24h?.toFixed(10)} (${percentFromHigh}%)</span>
            </div>
            <div class="flex items-center gap-2 text-xs">
              <span class="text-red-500">24h Low: ${data.lowPrice24h?.toFixed(10)} (${percentFromLow}%)</span>
            </div>
          </div>
        `
      }
    })

    // Add stats overlay
    const statsEl = document.createElement('div')
    statsEl.className = 'absolute top-2 right-2 bg-black/80 border border-red-600/20 rounded p-2 text-xs space-y-1 pointer-events-none transition-opacity duration-200 opacity-50 hover:opacity-100'
    statsEl.innerHTML = `
      <div class="text-green-500">24h High: ${data.highPrice24h?.toFixed(10)}</div>
      <div class="text-red-500">24h Low: ${data.lowPrice24h?.toFixed(10)}</div>
    `
    chartContainerRef.current.appendChild(statsEl)

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
    setIsLoading(false)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      if (chartContainerRef.current?.contains(statsEl)) {
        chartContainerRef.current.removeChild(statsEl)
      }
    }
  }, [data, symbol, selectedInterval, chartType])

  const handleDoubleClick = useCallback(() => {
    if (!data?.price) return
    const currentPrice = data.price
    addPriceAlert(currentPrice)
  }, [data?.price, addPriceAlert])

  return (
    <Card className="bg-black/50 border-red-600/20">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <CardTitle className="text-xl font-bold text-red-600">
              {symbol} Price Chart
            </CardTitle>
            {isLoading && (
              <Loader2 className="w-4 h-4 animate-spin text-red-600" />
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="hover:bg-red-600/10"
                onClick={() => setChartType(prev => prev === 'candlestick' ? 'line' : 'candlestick')}
              >
                {chartType === 'candlestick' ? (
                  <CandlestickChart className="w-4 h-4" />
                ) : (
                  <LineChart className="w-4 h-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="hover:bg-red-600/10"
                onClick={() => handleDoubleClick()}
              >
                <Bell className="w-4 h-4" />
              </Button>
            </div>
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
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <div ref={chartContainerRef} className="w-full h-[400px]" />
          <div 
            id="chart-tooltip" 
            className="absolute top-0 left-0 bg-black/90 border border-red-600/20 rounded p-2 pointer-events-none hidden"
          />
        </div>
      </CardContent>
    </Card>
  )
}

