'use client'

import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  }

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 rounded-md bg-red-500/10 border border-red-500">
          <h2 className="text-red-500 font-bold">Something went wrong</h2>
          <p className="text-gray-400">Please refresh the page and try again</p>
        </div>
      )
    }

    return this.props.children
  }
}

