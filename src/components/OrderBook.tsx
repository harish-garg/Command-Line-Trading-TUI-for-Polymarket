import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { getOrderBook, OrderBook as OrderBookData, Market } from '../api';

interface Props {
  market: Market;
  onBack: () => void;
}

export const OrderBook: React.FC<Props> = ({ market, onBack }) => {
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  useEffect(() => {
    let isInitialFetch = true;
    const fetchOrderBook = async () => {
      if (isInitialFetch) setLoading(true);
      const data = await getOrderBook(market.id);
      setOrderBook(data);
      setLastUpdate(new Date());
      if (isInitialFetch) {
        setLoading(false);
        isInitialFetch = false;
      }
    };

    fetchOrderBook();
    const interval = setInterval(fetchOrderBook, 2000);
    return () => clearInterval(interval);
  }, [market.id]);

  const formatPrice = (price: string) => (parseFloat(price) * 100).toFixed(2);
  const formatSize = (size: string) => parseFloat(size).toFixed(0);

  if (loading) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="blue" padding={1}>
        <Text color="blue">Loading order book...</Text>
      </Box>
    );
  }

  if (!orderBook) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" padding={1}>
        <Text color="red">Failed to load order book</Text>
        <Text color="gray" marginTop={1}>Press Ctrl+C to exit or type 'back' to search again</Text>
      </Box>
    );
  }

  const bestBid = orderBook.bids[0] ? parseFloat(orderBook.bids[0].price) : null;
  const bestAsk = orderBook.asks[0] ? parseFloat(orderBook.asks[0].price) : null;
  const spread = bestBid && bestAsk ? (bestAsk - bestBid) : null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" padding={1}>
      <Text bold color="green">{market.title}</Text>
      
      <Box flexDirection="row" marginTop={1}>
        <Text color="yellow">Updated: {lastUpdate.toLocaleTimeString()}</Text>
        {spread !== null && (
          <Text color="magenta" marginLeft={3}>Spread: {(spread * 100).toFixed(2)}%</Text>
        )}
      </Box>

      <Box flexDirection="row" marginTop={1}>
        {/* Bids (Buy side) */}
        <Box flexDirection="column" width={25}>
          <Text bold color="green" marginBottom={1}>BUY ORDERS (Bids)</Text>
          <Box flexDirection="row">
            <Text bold color="gray" width={12}>Price %</Text>
            <Text bold color="gray" width={12}>Size</Text>
          </Box>
          {orderBook.bids.slice(0, 15).map((bid, i) => (
            <Box key={i} flexDirection="row">
              <Text color="green" width={12}>{formatPrice(bid.price)}</Text>
              <Text color="gray" width={12}>{formatSize(bid.size)}</Text>
            </Box>
          ))}
          {orderBook.bids.length === 0 && (
            <Text color="gray">No buy orders</Text>
          )}
        </Box>

        <Box width={5} /> {/* Spacer */}

        {/* Asks (Sell side) */}
        <Box flexDirection="column" width={25}>
          <Text bold color="red" marginBottom={1}>SELL ORDERS (Asks)</Text>
          <Box flexDirection="row">
            <Text bold color="gray" width={12}>Price %</Text>
            <Text bold color="gray" width={12}>Size</Text>
          </Box>
          {orderBook.asks.slice(0, 15).map((ask, i) => (
            <Box key={i} flexDirection="row">
              <Text color="red" width={12}>{formatPrice(ask.price)}</Text>
              <Text color="gray" width={12}>{formatSize(ask.size)}</Text>
            </Box>
          ))}
          {orderBook.asks.length === 0 && (
            <Text color="gray">No sell orders</Text>
          )}
        </Box>
      </Box>

      <Text color="gray" marginTop={1}>Press Ctrl+C to exit</Text>
    </Box>
  );
};
