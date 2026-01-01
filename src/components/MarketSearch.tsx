import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { searchMarkets, Market } from '../api';

interface Props {
  onSelectMarket: (market: Market) => void;
}

export const MarketSearch: React.FC<Props> = ({ onSelectMarket }) => {
  const [query, setQuery] = useState('');
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (query.length === 0) {
      setMarkets([]);
      return;
    }

    const timer = setTimeout(() => {
      setLoading(true);
      searchMarkets(query).then(results => {
        setMarkets(results);
        setLoading(false);
        setSelectedIndex(0);
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const items = markets.map((market, index) => ({
    label: `${market.title} - ${market.question}`.slice(0, 80),
    value: index
  }));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Text bold color="cyan">Polymarket Order Book</Text>
      <Text color="gray" marginY={1}>Enter market name/question:</Text>
      
      <TextInput
        value={query}
        onChange={setQuery}
        placeholder="e.g., Bitcoin, Trump, Election..."
      />

      {loading && <Text color="yellow" marginTop={1}>Searching...</Text>}
      
      {markets.length > 0 && !loading && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray" marginBottom={1}>Select a market:</Text>
          <SelectInput
            items={items}
            onSelect={(item) => {
              onSelectMarket(markets[item.value]);
            }}
          />
        </Box>
      )}

      {query.length > 0 && markets.length === 0 && !loading && (
        <Text color="red" marginTop={1}>No markets found</Text>
      )}
    </Box>
  );
};
