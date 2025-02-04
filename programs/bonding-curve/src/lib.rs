use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use solana_program::program::invoke_signed;

declare_id!("BCurvxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"); // Replace with actual program ID

// Constants
pub const SWARMS_TOKEN_ADDRESS: &str = "74SBV4zDXxTRgv1pEMoECskKBkZHc2yGPnc7GYVepump";
pub const WITHDRAW_AUTHORITY: &str = "CihEpQp6CSP9wGfwijvPivshSV6VbgvNef1JMMPQ4R9G";

// Bonding curve constants (using u64 with 6 decimals precision)
pub const INITIAL_VIRTUAL_SWARMS: u64 = 500_000_000; // 500 SWARMS with 6 decimals
pub const INITIAL_TOKEN_SUPPLY: u64 = 1_073_000_191_000_000; // 1,073,000,191 tokens with 6 decimals
pub const K_VALUE: u128 = 536_500_095_500_000_000_000_000; // k = initial_supply * initial_virtual_swarms

#[program]
pub mod bonding_curve {
    use super::*;

    pub fn swap(
        ctx: Context<Swap>,
        amount_in: u64,
        min_amount_out: u64,
    ) -> Result<()> {
        // Verify SWARMS token address
        require!(
            ctx.accounts.swarms_mint.key().to_string() == SWARMS_TOKEN_ADDRESS,
            ErrorCode::InvalidSwarmsMint
        );

        // Verify input token is either SWARMS or the minted token
        require!(
            ctx.accounts.token_in_mint.key() == ctx.accounts.swarms_mint.key() ||
            ctx.accounts.token_in_mint.key() == ctx.accounts.minted_mint.key(),
            ErrorCode::InvalidInputToken
        );

        let vault = &mut ctx.accounts.vault;
        
        // Calculate output amount based on bonding curve
        let output_amount = if ctx.accounts.token_in_mint.key() == ctx.accounts.swarms_mint.key() {
            // Swapping SWARMS for minted token
            calculate_tokens_out(amount_in)?
        } else {
            // Swapping minted token for SWARMS
            calculate_swarms_out(amount_in)?
        };

        // Verify minimum output
        require!(output_amount >= min_amount_out, ErrorCode::SlippageExceeded);

        // Get vault signer seeds
        let seeds = &[
            b"vault",
            ctx.accounts.minted_mint.key().as_ref(),
            &[ctx.bumps.vault],
        ];
        let signer = &[&seeds[..]];

        // Transfer input tokens from user to vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.user_token_in.to_account_info(),
                    to: ctx.accounts.vault_token_in.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount_in,
        )?;

        // Transfer output tokens from vault to user
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.vault_token_out.to_account_info(),
                    to: ctx.accounts.user_token_out.to_account_info(),
                    authority: vault.to_account_info(),
                },
                signer,
            ),
            output_amount,
        )?;

        Ok(())
    }

    pub fn withdraw_liquidity(
        ctx: Context<WithdrawLiquidity>,
        swarms_amount: u64,
        minted_amount: u64,
    ) -> Result<()> {
        // Verify authority
        require!(
            ctx.accounts.authority.key().to_string() == WITHDRAW_AUTHORITY,
            ErrorCode::InvalidWithdrawAuthority
        );

        let vault = &ctx.accounts.vault;
        let seeds = &[
            b"vault",
            ctx.accounts.minted_mint.key().as_ref(),
            &[ctx.bumps.vault],
        ];
        let signer = &[&seeds[..]];

        // Withdraw SWARMS tokens
        if swarms_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.vault_swarms.to_account_info(),
                        to: ctx.accounts.authority_swarms.to_account_info(),
                        authority: vault.to_account_info(),
                    },
                    signer,
                ),
                swarms_amount,
            )?;
        }

        // Withdraw minted tokens
        if minted_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.vault_minted.to_account_info(),
                        to: ctx.accounts.authority_minted.to_account_info(),
                        authority: vault.to_account_info(),
                    },
                    signer,
                ),
                minted_amount,
            )?;
        }

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"vault", minted_mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenVault>,
    
    pub swarms_mint: Account<'info, Mint>,
    pub minted_mint: Account<'info, Mint>,
    
    /// The mint of the token being sent by the user
    pub token_in_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub user_token_in: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_out: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_in: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_out: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawLiquidity<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"vault", minted_mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenVault>,
    
    pub swarms_mint: Account<'info, Mint>,
    pub minted_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub vault_swarms: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_minted: Account<'info, TokenAccount>,
    #[account(mut)]
    pub authority_swarms: Account<'info, TokenAccount>,
    #[account(mut)]
    pub authority_minted: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct TokenVault {
    pub minted_mint: Pubkey,
    pub swarms_mint: Pubkey,
    pub authority: Pubkey,
}

impl TokenVault {
    pub const SIZE: usize = 32 + 32 + 32;
}

#[error_code]
pub enum ErrorCode {
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Invalid SWARMS token mint address")]
    InvalidSwarmsMint,
    #[msg("Invalid withdraw authority")]
    InvalidWithdrawAuthority,
    #[msg("Input token must be either SWARMS or the minted token")]
    InvalidInputToken,
    #[msg("Arithmetic error in bonding curve calculation")]
    BondingCurveError,
}

// Helper function to calculate tokens out when providing SWARMS
// Formula: y = 1073000191 - 32190005730/(30+x)
// where x is SWARMS in (6 decimals), y is tokens out (6 decimals)
fn calculate_tokens_out(swarms_in: u64) -> Result<u64> {
    // Convert to u128 for intermediate calculations to prevent overflow
    let swarms_in_u128 = (swarms_in as u128) + INITIAL_VIRTUAL_SWARMS as u128;
    
    // Calculate tokens out using the formula
    let tokens_out = INITIAL_TOKEN_SUPPLY as u128 - 
        (K_VALUE / swarms_in_u128);
    
    // Convert back to u64 and check for overflow
    tokens_out.try_into()
        .map_err(|_| error!(ErrorCode::BondingCurveError))
}

// Helper function to calculate SWARMS out when providing tokens
// Inverse of the above formula: x = K/y - 30
// where y is remaining tokens (6 decimals), x is total SWARMS (6 decimals)
fn calculate_swarms_out(tokens_in: u64) -> Result<u64> {
    // Convert to u128 for intermediate calculations
    let tokens_remaining = INITIAL_TOKEN_SUPPLY as u128 - tokens_in as u128;
    
    if tokens_remaining == 0 {
        return Err(error!(ErrorCode::BondingCurveError));
    }
    
    // Calculate SWARMS out
    let swarms_total = K_VALUE / tokens_remaining;
    let swarms_out = swarms_total.saturating_sub(INITIAL_VIRTUAL_SWARMS as u128);
    
    // Convert back to u64 and check for overflow
    swarms_out.try_into()
        .map_err(|_| error!(ErrorCode::BondingCurveError))
} 