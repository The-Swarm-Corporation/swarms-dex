# Bonding Curve Program

This Solana program implements a simple swap mechanism between SWARMS tokens and minted tokens. It manages the trading of tokens through a vault system that holds the token supplies.

## Constants

- **SWARMS Token Address**: `74SBV4zDXxTRgv1pEMoECskKBkZHc2yGPnc7GYVepump`
- **Withdraw Authority**: `CihEpQp6CSP9wGfwijvPivshSV6VbgvNef1JMMPQ4R9G`

## Architecture

The program uses a Program Derived Account (PDA) as a vault:

**Token Vault**: Holds both token supplies and handles swaps
- Minted token mint address
- SWARMS token mint address
- Authority (program PDA)

## Instructions

### Swap

Handles swapping between SWARMS and minted tokens:
- Verifies SWARMS token address
- Accepts input token from user
- Calculates output amount based on swap formula
- Transfers input tokens to vault
- Transfers output tokens to user

### Withdraw Liquidity

Allows the authorized address to withdraw liquidity from the vault:
- Can only be called by `CihEpQp6CSP9wGfwijvPivshSV6VbgvNef1JMMPQ4R9G`
- Can withdraw both SWARMS and minted tokens
- Useful for migrating liquidity to another pool
- Requires specifying withdrawal amounts for both tokens

## Swap Formula

Currently implements a simple swap mechanism:
- 1:1 ratio between SWARMS and minted tokens
- 1% fee on all swaps
- Fee is kept in the vault to maintain liquidity

## Security

The program uses PDAs to ensure:
- Only the program can sign for the vault
- Trading operations maintain correct token balances
- All operations are atomic and consistent
- Only authorized address can withdraw liquidity
- Only real SWARMS token can be used

## Usage

To use this program:
1. Deploy the program to Solana
2. Create a vault for your token pair
3. Users can then swap between SWARMS and your token through the swap instruction
4. Authorized address can withdraw liquidity when needed 