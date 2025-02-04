export class SolanaError extends Error {
  constructor(message: string, public code: string, public details?: any) {
    super(message)
    this.name = 'SolanaError'
  }
}

export class InsufficientBalanceError extends SolanaError {
  constructor(balance: number, required: number) {
    super(
      `Insufficient SOL balance. Need ${required} SOL but wallet has ${balance} SOL`,
      'INSUFFICIENT_BALANCE',
      { balance, required }
    )
    this.name = 'InsufficientBalanceError'
  }
}

export class TransactionError extends SolanaError {
  constructor(message: string, public signature?: string, public logs?: string[]) {
    super(message, 'TRANSACTION_ERROR', { signature, logs })
    this.name = 'TransactionError'
  }
}

export class WalletError extends SolanaError {
  constructor(message: string) {
    super(message, 'WALLET_ERROR')
    this.name = 'WalletError'
  }
}

export class ValidationError extends SolanaError {
  constructor(message: string, public fields?: Record<string, string>) {
    super(message, 'VALIDATION_ERROR', { fields })
    this.name = 'ValidationError'
  }
}

