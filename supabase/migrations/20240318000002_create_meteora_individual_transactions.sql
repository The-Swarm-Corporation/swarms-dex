create table if not exists public.meteora_individual_transactions (
  id uuid default gen_random_uuid() primary key,
  mint_address text not null,
  signature text not null unique,
  price numeric(20,9),
  size numeric(20,9),
  side text check (side in ('buy', 'sell')),
  timestamp bigint not null,
  is_swap boolean not null default true,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create indexes for faster lookups
create index if not exists meteora_individual_transactions_mint_address_idx on public.meteora_individual_transactions(mint_address);
create index if not exists meteora_individual_transactions_signature_idx on public.meteora_individual_transactions(signature);
create index if not exists meteora_individual_transactions_timestamp_idx on public.meteora_individual_transactions(timestamp desc);

-- Add RLS policies
alter table public.meteora_individual_transactions enable row level security;

create policy "Allow public read access"
  on public.meteora_individual_transactions for select
  to public
  using (true);

create policy "Allow service role to insert/update"
  on public.meteora_individual_transactions for all
  to service_role
  using (true)
  with check (true);