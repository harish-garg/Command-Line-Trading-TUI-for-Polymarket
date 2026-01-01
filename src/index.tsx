import React, { useState } from 'react';
import { render } from 'ink';
import { Market } from './api';
import { MarketSearch } from './components/MarketSearch';
import { OrderBook } from './components/OrderBook';

const App: React.FC = () => {
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);

  if (selectedMarket) {
    return (
      <OrderBook
        market={selectedMarket}
        onBack={() => setSelectedMarket(null)}
      />
    );
  }

  return <MarketSearch onSelectMarket={setSelectedMarket} />;
};

render(<App />);
