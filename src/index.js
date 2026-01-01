"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Need to use require for AutoComplete as it might not be a named export in all definitions
const { AutoComplete } = require('enquirer');
const chalk_1 = __importDefault(require("chalk"));
const api_1 = require("./api");
function clearScreen() {
    console.clear();
}
function formatOrderRow(price, size, colorFunc) {
    const p = (parseFloat(price) * 100).toFixed(1);
    const s = parseFloat(size).toFixed(0);
    return colorFunc(`${p}% @ ${s}`);
}
async function displayMarketDashboard(market) {
    clearScreen();
    let lastLinesCount = 0;
    if (market.clobTokenIds.length < 2) {
        console.log(chalk_1.default.red('Market does not have enough outcomes for this dashboard view.'));
        await new Promise(r => setTimeout(r, 3000));
        return;
    }
    const tokenA = market.clobTokenIds[0];
    const tokenB = market.clobTokenIds[1];
    const nameA = market.outcomes[0] || 'YES';
    const nameB = market.outcomes[1] || 'NO';
    // State to hold latest books
    const books = {
        [tokenA]: null,
        [tokenB]: null
    };
    // 1. Initial Fetch (REST) to populate immediately
    try {
        const [bA, bB] = await Promise.all([
            (0, api_1.getOrderBook)(tokenA),
            (0, api_1.getOrderBook)(tokenB)
        ]);
        books[tokenA] = bA;
        books[tokenB] = bB;
    }
    catch (e) {
        // ignore, wait for WS
    }
    // 2. Subscribe (WS)
    const unsubscribe = (0, api_1.subscribeToOrderBooks)([tokenA, tokenB], (tid, book) => {
        books[tid] = book;
    });
    const render = () => {
        const bookA = books[tokenA];
        const bookB = books[tokenB];
        if (!bookA || !bookB) {
            // Show loading state if we still don't have data
            if (lastLinesCount === 0) {
                console.log(chalk_1.default.yellow('Connecting to live feed...'));
                lastLinesCount = 1;
            }
            return;
        }
        // --- Calculate Stats ---
        const bestBidA = bookA.bids[0] ? parseFloat(bookA.bids[0].price) : 0;
        const bestAskA = bookA.asks[0] ? parseFloat(bookA.asks[0].price) : 0;
        const midA = (bestBidA + bestAskA) / 2;
        const bestBidB = bookB.bids[0] ? parseFloat(bookB.bids[0].price) : 0;
        const bestAskB = bookB.asks[0] ? parseFloat(bookB.asks[0].price) : 0;
        const midB = (bestBidB + bestAskB) / 2;
        // --- Build UI Strings ---
        // Header
        let output = '';
        output += chalk_1.default.white.bold(`\n ${market.title}\n`);
        const dateStr = new Date().toLocaleTimeString();
        output += chalk_1.default.gray(` Time: ${chalk_1.default.yellow(dateStr)} | `) + chalk_1.default.green('● LIVE WS');
        output += '\n\n';
        // Price Indicators
        const priceAStr = chalk_1.default.green(`▲ ${nameA.toUpperCase()}: ${(midA * 100).toFixed(1)}%`);
        const priceBStr = chalk_1.default.red(`▼ ${nameB.toUpperCase()}: ${(midB * 100).toFixed(1)}%`);
        output += ` ${priceAStr}           ${priceBStr}\n\n`;
        // Order Book Headers
        const leftHeader = chalk_1.default.green(`${nameA} Order Book`) + chalk_1.default.gray(`   Bid: ${(bestBidA * 100).toFixed(1)}% | Ask: ${(bestAskA * 100).toFixed(1)}%`);
        const rightHeader = chalk_1.default.red(`${nameB} Order Book`) + chalk_1.default.gray(`    Bid: ${(bestBidB * 100).toFixed(1)}% | Ask: ${(bestAskB * 100).toFixed(1)}%`);
        output += ` ${leftHeader.padEnd(60)} ${rightHeader}\n`;
        // Columns
        const rows = 15;
        const leftLines = [];
        const rightLines = [];
        leftLines.push(`${chalk_1.default.gray('BIDS')}           ${chalk_1.default.gray('ASKS')}`);
        rightLines.push(`${chalk_1.default.gray('BIDS')}           ${chalk_1.default.gray('ASKS')}`);
        for (let i = 0; i < rows; i++) {
            // Left Side
            const bidA = bookA.bids[i];
            const askA = bookA.asks[i];
            const bidAStr = bidA ? formatOrderRow(bidA.price, bidA.size, chalk_1.default.green) : '';
            const askAStr = askA ? formatOrderRow(askA.price, askA.size, chalk_1.default.red) : '';
            leftLines.push(`${bidAStr.padEnd(15)} ${askAStr.padEnd(15)}`);
            // Right Side
            const bidB = bookB.bids[i];
            const askB = bookB.asks[i];
            const bidBStr = bidB ? formatOrderRow(bidB.price, bidB.size, chalk_1.default.green) : '';
            const askBStr = askB ? formatOrderRow(askB.price, askB.size, chalk_1.default.red) : '';
            rightLines.push(`${bidBStr.padEnd(15)} ${askBStr.padEnd(15)}`);
        }
        // Combine lines
        for (let i = 0; i < leftLines.length; i++) {
            output += ` ${leftLines[i].padEnd(45)}   ${rightLines[i]}\n`;
        }
        // --- In-Place Update ---
        if (lastLinesCount > 0) {
            process.stdout.write(`\x1B[${lastLinesCount}A`);
        }
        process.stdout.write('\x1B[0J');
        process.stdout.write(output);
        lastLinesCount = output.split('\n').length;
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
    console.log(chalk_1.default.cyan.bold('\n🎯 Polymarket Order Book TUI\n'));
    // 1. Initial Fetch for Choices
    // This prevents the 'length of undefined' error in Enquirer by ensuring choices exist.
    console.log(chalk_1.default.gray('Loading top markets...'));
    let initialMarkets = [];
    try {
        initialMarkets = await (0, api_1.searchMarkets)(""); // Empty query = fetch default list
    }
    catch (e) {
        console.log(chalk_1.default.red('Failed to connect to Polymarket API.'));
        return;
    }
    // Clear the "Loading..." message
    clearScreen();
    console.log(chalk_1.default.cyan.bold('\n🎯 Polymarket Order Book TUI\n'));
    // Cache for markets - we store by multiple keys to handle various lookup scenarios
    const marketById = new Map();
    const marketByTitle = new Map();
    // Track the current choices available in the prompt for reliable lookups
    let currentChoicesMap = new Map();
    // Helper to add markets to cache
    const cacheMarkets = (markets) => {
        markets.forEach(m => {
            marketById.set(m.id, m);
            marketByTitle.set(m.title, m);
        });
    };
    cacheMarkets(initialMarkets);
    // Helper to find market by any key (title, id, or from current choices)
    const findMarket = (key) => {
        return currentChoicesMap.get(key) || marketByTitle.get(key) || marketById.get(key);
    };
    // Initialize currentChoicesMap with initial markets
    initialMarkets.forEach(m => currentChoicesMap.set(m.title, m));
    while (true) {
        let selectedTitle;
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
                async suggest(input, choices) {
                    // Helper to safely create choice objects
                    const safeChoices = (markets) => {
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
                            if (m.title)
                                currentChoicesMap.set(m.title, m);
                        });
                        return safeChoices(initialMarkets);
                    }
                    try {
                        const markets = await (0, api_1.searchMarkets)(input);
                        cacheMarkets(markets);
                        if (markets.length === 0) {
                            currentChoicesMap = new Map();
                            return [{ name: 'No results found', message: 'No results found', value: 'none', disabled: true }];
                        }
                        // Update currentChoicesMap for reliable lookups
                        currentChoicesMap = new Map();
                        markets.forEach(m => {
                            if (m.title)
                                currentChoicesMap.set(m.title, m);
                        });
                        return safeChoices(markets);
                    }
                    catch (e) {
                        // Return current choices on error instead of empty array
                        return choices;
                    }
                },
                result(name) {
                    // Return the title string to be resolved in the main loop
                    return name;
                }
            });
            selectedTitle = await prompt.run();
        }
        catch (e) {
            console.log('\nExiting...');
            process.exit(0);
        }
        // console.log('Debug: Raw selection:', selectedTitle);
        if (!selectedTitle || selectedTitle === 'No results found') {
            continue;
        }
        const selectedMarket = findMarket(selectedTitle);
        if (!selectedMarket || !selectedMarket.clobTokenIds || selectedMarket.clobTokenIds.length === 0) {
            console.log(chalk_1.default.red(`\nError: Could not find market data for "${selectedTitle}".`));
            console.log(chalk_1.default.gray('Please select a market from the dropdown list.\n'));
            continue;
        }
        // Enter Dashboard
        await displayMarketDashboard(selectedMarket);
    }
}
main().catch(console.error);
