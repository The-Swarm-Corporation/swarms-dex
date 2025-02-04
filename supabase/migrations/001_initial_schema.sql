-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- Web3Users table to store wallet information
create table web3users (
    id uuid primary key default uuid_generate_v4(),
    wallet_address text not null unique,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    username text unique,
    avatar_url text,
    total_trades integer default 0,
    total_volume numeric(20,8) default 0,
    constraint wallet_address_check check (length(wallet_address) > 0)
);

-- Web3Agents table to store AI agent information
create table web3agents (
    id uuid primary key default uuid_generate_v4(),
    creator_id uuid references web3users(id) on delete cascade,
    name text not null,
    description text not null,
    token_symbol text not null unique,
    mint_address text not null unique,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    twitter_handle text,
    telegram_group text,
    discord_server text,
    initial_supply numeric(20,8) not null,
    liquidity_pool_size numeric(20,8) not null,
    is_verified boolean default false,
    constraint token_symbol_check check (length(token_symbol) between 2 and 10)
);

-- Trade history for agents
create table agent_trades (
    id uuid primary key default uuid_generate_v4(),
    agent_id uuid references web3agents(id) on delete cascade,
    trader_id uuid references web3users(id) on delete cascade,
    trade_type text not null check (trade_type in ('buy', 'sell')),
    amount numeric(20,8) not null,
    price numeric(20,8) not null,
    total_value numeric(20,8) not null,
    transaction_signature text not null unique,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    constraint positive_amount check (amount > 0),
    constraint positive_price check (price > 0)
);

-- Price history for agents
create table agent_prices (
    id uuid primary key default uuid_generate_v4(),
    agent_id uuid references web3agents(id) on delete cascade,
    price numeric(20,8) not null,
    volume_24h numeric(20,8) not null default 0,
    market_cap numeric(20,8) not null default 0,
    timestamp timestamp with time zone default timezone('utc'::text, now()) not null,
    constraint positive_price check (price > 0)
);

-- Create indexes for better query performance
create index web3users_wallet_address_idx on web3users(wallet_address);
create index web3agents_mint_address_idx on web3agents(mint_address);
create index agent_trades_agent_id_idx on agent_trades(agent_id);
create index agent_trades_trader_id_idx on agent_trades(trader_id);
create index agent_prices_agent_id_timestamp_idx on agent_prices(agent_id, timestamp);

-- Create functions for updating timestamps
create or replace function update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = timezone('utc'::text, now());
    return new;
end;
$$ language plpgsql;

-- Create triggers for updating timestamps
create trigger update_web3users_updated_at
    before update on web3users
    for each row
    execute function update_updated_at_column();

create trigger update_web3agents_updated_at
    before update on web3agents
    for each row
    execute function update_updated_at_column();

-- Create views for analytics
create view agent_statistics as
select 
    a.id as agent_id,
    a.name,
    a.token_symbol,
    count(distinct t.trader_id) as unique_traders,
    sum(case when t.trade_type = 'buy' then t.total_value else 0 end) as total_buy_volume,
    sum(case when t.trade_type = 'sell' then t.total_value else 0 end) as total_sell_volume,
    count(t.id) as total_trades,
    (
        select price 
        from agent_prices ap 
        where ap.agent_id = a.id 
        order by timestamp desc 
        limit 1
    ) as current_price
from web3agents a
left join agent_trades t on t.agent_id = a.id
group by a.id, a.name, a.token_symbol;

