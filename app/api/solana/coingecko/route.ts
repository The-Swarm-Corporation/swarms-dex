import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

async function fetchSwarmsPrice() {
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=swarms&vs_currencies=usd',
      { next: { revalidate: 60 } } // Cache for 1 minute
    );
    const data = await response.json();
    return data.swarms.usd;
  } catch (error) {
    logger.error('Failed to fetch SWARMS price from CoinGecko', error as Error);
    return null;
  }
}

export async function GET() {
  try {
    const price = await fetchSwarmsPrice();
    return NextResponse.json({ price });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch price' }, { status: 500 });
  }
}