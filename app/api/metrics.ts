import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { address } = req.body;
  if (!address) {
    return res.status(400).json({ message: 'Missing token address' });
  }

  try {
    const apiResponse = await fetch('https://api.solscan.io/v1/token/getTokenMetrics', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ address })
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error('Error fetching token metrics:', errorText);
      return res.status(apiResponse.status).json({
        message: 'Failed to fetch token metrics',
        error: errorText
      });
    }
    
    const data = await apiResponse.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Error in fetchMarketCap API route:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}