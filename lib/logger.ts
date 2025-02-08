type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogMessage {
  level: LogLevel
  message: string
  timestamp: string
  data?: any
  error?: {
    name: string
    message: string
    stack?: string
    cause?: unknown
  }
}

class Logger {
  private static instance: Logger
  private logs: LogMessage[] = []

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger()
    }
    return Logger.instance
  }

  private formatError(error: Error): {
    name: string
    message: string
    stack?: string
    cause?: unknown
  } {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    }
  }

  private log(level: LogLevel, message: string, data?: any, error?: Error) {
    const logMessage: LogMessage = {
      level,
      message,
      timestamp: new Date().toISOString(),
      data: data ? this.sanitize(data) : undefined,
      error: error ? this.formatError(error) : undefined
    }

    this.logs.push(logMessage)
    
    if (process.env.NODE_ENV === 'development') {
      console[level](
        `[${logMessage.timestamp}] ${level.toUpperCase()}: ${message}`,
        ...[
          data ? { data: logMessage.data } : null,
          error ? { error: logMessage.error } : null
        ].filter(Boolean)
      )
    }
  }

  private sanitize(data: any): any {
    if (!data) return data
    
    // Deep clone the data
    const cloned = JSON.parse(JSON.stringify(data))
    
    // Remove sensitive fields - be more specific
    const sensitiveFields = [
      'privateKey',
      'secret',
      'password',
      'accessToken',
      'refreshToken',
      'apiToken',
      'authToken',
      'jwt'
    ]
    
    const sanitizeObj = (obj: any) => {
      if (typeof obj !== 'object') return obj
      
      Object.keys(obj).forEach(key => {
        // Only redact exact matches or specific patterns
        if (sensitiveFields.includes(key.toLowerCase()) || 
            /^(private|secret|auth)_.*token$/i.test(key)) {
          obj[key] = '[REDACTED]'
        } else if (typeof obj[key] === 'object') {
          obj[key] = this.sanitize(obj[key])
        }
      })
      
      return obj
    }
    
    return sanitizeObj(cloned)
  }

  debug(message: string, data?: any) {
    this.log('debug', message, data)
  }

  info(message: string, data?: any) {
    this.log('info', message, data)
  }

  warn(message: string, data?: any, error?: Error) {
    this.log('warn', message, data, error)
  }

  error(message: string, error?: Error, data?: any) {
    this.log('error', message, data, error)
  }

  getLogs(): LogMessage[] {
    return [...this.logs]
  }
}

export const logger = Logger.getInstance()

