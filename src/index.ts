// Need to use require for AutoComplete as it might not be a named export in all definitions
const { AutoComplete } = require('enquirer');
import chalk from 'chalk';
import { table } from 'table';
import { searchMarkets, getOrderBook, subscribeToOrderBooks, getMarketBySlug, parsePolymarketUrl, Market, OrderBook } from './api';

function clearScreen() {
  console.clear();
}

// Track previous values for change detection
interface PrevValues {
    prices: Map<string, number>;
    sizes: Map<string, number>;
    flashing: Map<string, { color: 'up' | 'down'; until: number }>;
}

const prevValues: PrevValues = {
    prices: new Map(),
    sizes: new Map(),
    flashing: new Map()
};

// Format order row with depth bar and change highlighting
function formatOrderRow(
    price: string,
    size: string,
    colorFunc: any,
    maxSize: number,
    key: string,
    isFlashUp: boolean | null
): string {
    const p = (parseFloat(price) * 100).toFixed(1);
    const s = parseFloat(size);
    const sizeStr = s.toFixed(0);

    // Create depth bar (max 8 chars wide)
    const barWidth = 8;
    const fillRatio = maxSize > 0 ? Math.min(s / maxSize, 1) : 0;
    const filled = Math.round(fillRatio * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

    // Apply flash color if value just changed
    let priceDisplay = `${p}%`;
    if (isFlashUp === true) {
        priceDisplay = chalk.bgGreen.black(` ${p}% `);
    } else if (isFlashUp === false) {
        priceDisplay = chalk.bgRed.white(` ${p}% `);
    } else {
        priceDisplay = colorFunc(`${p}%`);
    }

    return `${priceDisplay} ${chalk.gray(sizeStr.padStart(5))} ${chalk.dim(bar)}`;
}

// Check if a value changed and should flash
function checkFlash(key: string, newValue: number, prevMap: Map<string, number>): boolean | null {
    const prev = prevMap.get(key);
    prevMap.set(key, newValue);

    if (prev === undefined) return null; // First time, no flash
    if (Math.abs(prev - newValue) < 0.0001) return null; // No change

    return newValue > prev; // true = up (green), false = down (red)
}

async function displayMarketDashboard(market: Market) {
  clearScreen();
  let lastLinesCount = 0;

  if (market.clobTokenIds.length < 2) {
      console.log(chalk.red('Market does not have enough outcomes for this dashboard view.'));
      await new Promise(r => setTimeout(r, 3000));
      return;
  }

  const tokenA = market.clobTokenIds[0];
  const tokenB = market.clobTokenIds[1];
  const nameA = market.outcomes[0] || 'YES';
  const nameB = market.outcomes[1] || 'NO';

  // State to hold latest books
  const books: Record<string, OrderBook | null> = {
      [tokenA]: null,
      [tokenB]: null
  };

  // 1. Initial Fetch (REST) to populate immediately
  try {
    const [bA, bB] = await Promise.all([
        getOrderBook(tokenA),
        getOrderBook(tokenB)
    ]);
    books[tokenA] = bA;
    books[tokenB] = bB;
  } catch (e) {
      // ignore, wait for WS
  }

  // 2. Subscribe (WS)
  const unsubscribe = subscribeToOrderBooks([tokenA, tokenB], (tid, book) => {
      books[tid] = book;
  });

  const render = () => {
    const bookA = books[tokenA];
    const bookB = books[tokenB];

    if (!bookA || !bookB) {
        // Show loading state if we still don't have data
        if (lastLinesCount === 0) {
             console.log(chalk.yellow('Connecting to live feed...'));
             lastLinesCount = 1;
        }
        return;
    }

    // --- Calculate Stats ---
    const bestBidA = bookA.bids[0] ? parseFloat(bookA.bids[0].price) : 0;
    const bestAskA = bookA.asks[0] ? parseFloat(bookA.asks[0].price) : 0;
    const midA = (bestBidA + bestAskA) / 2;
    const spreadA = bestAskA - bestBidA;

    const bestBidB = bookB.bids[0] ? parseFloat(bookB.bids[0].price) : 0;
    const bestAskB = bookB.asks[0] ? parseFloat(bookB.asks[0].price) : 0;
    const midB = (bestBidB + bestAskB) / 2;
    const spreadB = bestAskB - bestBidB;

    // Calculate max sizes for depth bars
    const maxBidSizeA = Math.max(...bookA.bids.slice(0, 15).map(b => parseFloat(b.size) || 0), 1);
    const maxAskSizeA = Math.max(...bookA.asks.slice(0, 15).map(a => parseFloat(a.size) || 0), 1);
    const maxBidSizeB = Math.max(...bookB.bids.slice(0, 15).map(b => parseFloat(b.size) || 0), 1);
    const maxAskSizeB = Math.max(...bookB.asks.slice(0, 15).map(a => parseFloat(a.size) || 0), 1);

    // Check for mid price changes (for flash effect)
    const midAFlash = checkFlash(`${tokenA}-mid`, midA, prevValues.prices);
    const midBFlash = checkFlash(`${tokenB}-mid`, midB, prevValues.prices);

    // --- Build UI Strings ---

    // Header
    let output = '';
    output += chalk.white.bold(`\n ${market.title}\n`);
    const dateStr = new Date().toLocaleTimeString();
    output += chalk.gray(` Time: ${chalk.yellow(dateStr)} | `) + chalk.green('● LIVE WS') + chalk.gray(' | Press Ctrl+C to exit');
    output += '\n\n';

    // Price Indicators with flash
    let priceADisplay = `${(midA * 100).toFixed(1)}%`;
    let priceBDisplay = `${(midB * 100).toFixed(1)}%`;

    if (midAFlash === true) {
        priceADisplay = chalk.bgGreen.black(` ▲ ${priceADisplay} `);
    } else if (midAFlash === false) {
        priceADisplay = chalk.bgRed.white(` ▼ ${priceADisplay} `);
    } else {
        priceADisplay = chalk.green(`▲ ${priceADisplay}`);
    }

    if (midBFlash === true) {
        priceBDisplay = chalk.bgGreen.black(` ▲ ${priceBDisplay} `);
    } else if (midBFlash === false) {
        priceBDisplay = chalk.bgRed.white(` ▼ ${priceBDisplay} `);
    } else {
        priceBDisplay = chalk.red(`▼ ${priceBDisplay}`);
    }

    output += ` ${chalk.bold(nameA.toUpperCase())}: ${priceADisplay}        ${chalk.bold(nameB.toUpperCase())}: ${priceBDisplay}\n\n`;

    // Order Book Headers with spread
    const spreadAStr = chalk.yellow(`Spread: ${(spreadA * 100).toFixed(2)}%`);
    const spreadBStr = chalk.yellow(`Spread: ${(spreadB * 100).toFixed(2)}%`);

    const leftHeader = chalk.green.bold(`${nameA} Book`) + chalk.gray(` Bid:${(bestBidA*100).toFixed(1)}% Ask:${(bestAskA*100).toFixed(1)}%`) + ` ${spreadAStr}`;
    const rightHeader = chalk.red.bold(`${nameB} Book`) + chalk.gray(` Bid:${(bestBidB*100).toFixed(1)}% Ask:${(bestAskB*100).toFixed(1)}%`) + ` ${spreadBStr}`;

    output += ` ${leftHeader}\n`;
    output += ` ${rightHeader}\n`;
    output += chalk.gray(` ${'─'.repeat(78)}\n`);

    // Column headers
    output += ` ${chalk.green.bold('BIDS'.padEnd(25))} ${chalk.red.bold('ASKS'.padEnd(25))}    ${chalk.green.bold('BIDS'.padEnd(25))} ${chalk.red.bold('ASKS')}\n`;

    // Columns
    const rows = 12;

    for (let i = 0; i < rows; i++) {
        // Left Side (Outcome A)
        const bidA = bookA.bids[i];
        const askA = bookA.asks[i];

        let bidAStr = '';
        let askAStr = '';

        if (bidA) {
            const keyBidA = `${tokenA}-bid-${i}`;
            const flashBidA = checkFlash(keyBidA, parseFloat(bidA.price), prevValues.prices);
            bidAStr = formatOrderRow(bidA.price, bidA.size, chalk.green, maxBidSizeA, keyBidA, flashBidA);
        }
        if (askA) {
            const keyAskA = `${tokenA}-ask-${i}`;
            const flashAskA = checkFlash(keyAskA, parseFloat(askA.price), prevValues.prices);
            askAStr = formatOrderRow(askA.price, askA.size, chalk.red, maxAskSizeA, keyAskA, flashAskA);
        }

        // Right Side (Outcome B)
        const bidB = bookB.bids[i];
        const askB = bookB.asks[i];

        let bidBStr = '';
        let askBStr = '';

        if (bidB) {
            const keyBidB = `${tokenB}-bid-${i}`;
            const flashBidB = checkFlash(keyBidB, parseFloat(bidB.price), prevValues.prices);
            bidBStr = formatOrderRow(bidB.price, bidB.size, chalk.green, maxBidSizeB, keyBidB, flashBidB);
        }
        if (askB) {
            const keyAskB = `${tokenB}-ask-${i}`;
            const flashAskB = checkFlash(keyAskB, parseFloat(askB.price), prevValues.prices);
            askBStr = formatOrderRow(askB.price, askB.size, chalk.red, maxAskSizeB, keyAskB, flashAskB);
        }

        output += ` ${bidAStr.padEnd(25)} ${askAStr.padEnd(25)}    ${bidBStr.padEnd(25)} ${askBStr}\n`;
    }

    // Footer with legend
    output += chalk.gray(` ${'─'.repeat(78)}\n`);
    output += chalk.dim(` Legend: `) + chalk.bgGreen.black(' ▲ ') + chalk.dim(' Price up  ') + chalk.bgRed.white(' ▼ ') + chalk.dim(' Price down  ') + chalk.dim('█░ Depth bar\n');
    
    // --- In-Place Update (flicker-free) ---
    if (lastLinesCount > 0) {
        process.stdout.write(`\x1B[${lastLinesCount}A`);
    }
    // Write each line and clear to end of line (overwrites without blanking first)
    const lines = output.split('\n');
    for (const line of lines) {
        process.stdout.write(line + '\x1B[K\n');
    }
    // Clear any leftover lines from previous render
    process.stdout.write('\x1B[0J');
    lastLinesCount = lines.length;
  };

  // 3. Render Loop
  // We render immediately then loop
  render();
  const interval = setInterval(render, 100); // 100ms refresh rate for smooth UI

  return new Promise(() => {
    process.on('SIGINT', () => {
        clearInterval(interval);
        unsubscribe();
        process.exit(0);
    });
  });
}

async function main() {
  clearScreen();
  console.log(chalk.cyan.bold('\n🎯 Polymarket Order Book TUI\n'));
  
  // 1. Initial Fetch for Choices
  // This prevents the 'length of undefined' error in Enquirer by ensuring choices exist.
  console.log(chalk.gray('Loading top markets...'));
  let initialMarkets: Market[] = [];
  try {
      initialMarkets = await searchMarkets(""); // Empty query = fetch default list
  } catch (e) {
      console.log(chalk.red('Failed to connect to Polymarket API.'));
      return;
  }

  // Clear the "Loading..." message
  clearScreen();
  console.log(chalk.cyan.bold('\n🎯 Polymarket Order Book TUI\n'));
  console.log(chalk.gray('  Search for markets or paste a Polymarket URL\n'));

  // Cache for markets - we store by multiple keys to handle various lookup scenarios
  const marketById = new Map<string, Market>();
  const marketByTitle = new Map<string, Market>();

  // Track the current choices available in the prompt for reliable lookups
  let currentChoicesMap = new Map<string, Market>();

  // Helper to add markets to cache
  const cacheMarkets = (markets: Market[]) => {
      markets.forEach(m => {
          marketById.set(m.id, m);
          marketByTitle.set(m.title, m);
      });
  };

  cacheMarkets(initialMarkets);

  // Helper to find market by any key (title, id, or from current choices)
  const findMarket = (key: string): Market | undefined => {
      return currentChoicesMap.get(key) || marketByTitle.get(key) || marketById.get(key);
  };

  // Initialize currentChoicesMap with initial markets
  initialMarkets.forEach(m => currentChoicesMap.set(m.title, m));

  while (true) {
    let selectedTitle: string | undefined;
    
    try {
        const prompt = new AutoComplete({
            name: 'market',
            message: 'Search market:',
            limit: 10,
            initial: 0,
            // Provide the initial choices immediately
            choices: initialMarkets
                .filter(m => m.title && typeof m.title === 'string')
                .map(m => {
                    const title = String(m.title).trim();
                    return { name: title, message: title, value: title };
                }),
            async suggest(input: string, choices: any[]) {
                // Helper to safely create choice objects
                const safeChoices = (markets: Market[]) => {
                    return markets
                        .filter(m => m.title && typeof m.title === 'string')
                        .map(m => {
                            const title = String(m.title).trim();
                            return { name: title, message: title, value: title };
                        });
                };

                if (!input) {
                    // Update currentChoicesMap for reliable lookups
                    currentChoicesMap = new Map();
                    initialMarkets.forEach(m => {
                        if (m.title) currentChoicesMap.set(m.title, m);
                    });
                    return safeChoices(initialMarkets);
                }

                // Check if input looks like a Polymarket URL
                if (input.includes('polymarket.com/event/')) {
                    return [{
                        name: input,
                        message: chalk.cyan('⏎ Press Enter to load this URL'),
                        value: input
                    }];
                }

                try {
                    const markets = await searchMarkets(input);
                    cacheMarkets(markets);

                    if (markets.length === 0) {
                        currentChoicesMap = new Map();
                        return [{ name: 'No results found', message: 'No results found', value: 'none', disabled: true }];
                    }

                    // Update currentChoicesMap for reliable lookups
                    currentChoicesMap = new Map();
                    markets.forEach(m => {
                        if (m.title) currentChoicesMap.set(m.title, m);
                    });

                    return safeChoices(markets);
                } catch (e) {
                    // Return current choices on error instead of empty array
                    return choices;
                }
            },
            result(name: string) {
                // Return the title string to be resolved in the main loop
                return name;
            }
        });

        selectedTitle = await prompt.run();
    } catch (e) {
        console.log('\nExiting...');
        process.exit(0);
    }

    if (!selectedTitle || selectedTitle === 'No results found') {
        continue;
    }

    let selectedMarket: Market | null | undefined = null;

    // Check if input is a Polymarket URL
    const slug = parsePolymarketUrl(selectedTitle);
    if (slug) {
        console.log(chalk.gray(`\nFetching market from URL...`));
        selectedMarket = await getMarketBySlug(slug);
        if (!selectedMarket) {
            console.log(chalk.red(`\nError: Could not fetch market for slug "${slug}".`));
            console.log(chalk.gray('Please check the URL and try again.\n'));
            continue;
        }
        console.log(chalk.green(`✓ Found: ${selectedMarket.title}\n`));
    } else {
        // Try to find in cache
        selectedMarket = findMarket(selectedTitle);
    }

    if (!selectedMarket || !selectedMarket.clobTokenIds || selectedMarket.clobTokenIds.length === 0) {
        console.log(chalk.red(`\nError: Could not find market data for "${selectedTitle}".`));
        console.log(chalk.gray('Tip: You can paste a Polymarket URL directly!\n'));
        continue;
    }

    // Enter Dashboard
    await displayMarketDashboard(selectedMarket);
  }
}

main().catch(console.error);
