
import { useState, useEffect } from 'react';

const [swarmsPrice, setSwarmsPrice] = useState<number>(0);

const fetchSwarmsPrice = async () => {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=swarms&vs_currencies=usd');
      const data = await response.json();
      setSwarmsPrice(data.swarms.usd);
      return response;
    } catch (error) {
      console.error('Price fetch error:', error);
      return null;
    }
  };