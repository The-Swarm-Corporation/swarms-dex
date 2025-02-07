create table if not exists public.meteora_pool_stats (
  id uuid default gen_random_uuid() primary key,
  mint_address text not null,
  data jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create index on mint_address for faster lookups
create index if not exists meteora_pool_stats_mint_address_idx on public.meteora_pool_stats(mint_address);

-- Create index on updated_at for cache invalidation queries
create index if not exists meteora_pool_stats_updated_at_idx on public.meteora_pool_stats(updated_at);

-- Add RLS policies
alter table public.meteora_pool_stats enable row level security;

create policy "Allow public read access"
  on public.meteora_pool_stats for select
  to public
  using (true);

create policy "Allow service role to insert/update"
  on public.meteora_pool_stats for all
  to service_role
  using (true)
  with check (true); 