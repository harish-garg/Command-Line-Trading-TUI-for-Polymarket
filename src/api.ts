import axios from 'axios';
import WebSocket from 'ws';
import Fuse from 'fuse.js';

const CLOB_API = 'https://clob.polymarket.com';
const GAMMA_API = 'https://gamma-api.polymarket.com';
const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

// Cache for all fetched markets to enable client-side search
let marketsCache: Market[] = [];
let lastCacheUpdate = 0;
const CACHE_TTL = 60000; // 1 minute

export interface Market {
  id: string;
  title: string; // usually the question
  description: string;
  outcomes: string[];
  clobTokenIds: string[];
  volume24hr: number; // 24h trading volume for sorting by activity
  liquidity: number;  // market liquidity
}

export interface OrderBookOrder {
  price: string;
  size: string;
}

export interface OrderBook {
  bids: OrderBookOrder[];
  asks: OrderBookOrder[];
  hash?: string;
}

// Fetch all active markets from API and cache them
async function fetchAllMarkets(): Promise<Market[]> {
  const now = Date.now();

  // Return cached data if still valid
  if (marketsCache.length > 0 && (now - lastCacheUpdate) < CACHE_TTL) {
    return marketsCache;
  }

  try {
    // Fetch a large batch of active markets sorted by 24h volume (most active first)
    const response = await axios.get(`${GAMMA_API}/markets`, {
      params: {
        active: true,
        closed: false,
        order: 'volume24hr:desc',
        limit: 200 // Fetch enough markets for good search coverage
      }
    });

    const allMarkets = response.data || [];

    marketsCache = allMarkets
      .map((m: any) => {
        let tokenIds: string[] = [];
        let outcomeNames: string[] = [];

        try {
          tokenIds = typeof m.clobTokenIds === 'string' ? JSON.parse(m.clobTokenIds) : (m.clobTokenIds || []);
          outcomeNames = typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : (m.outcomes || []);
        } catch (e) {
          // ignore parse errors
        }

        return {
          id: m.id,
          title: m.question || m.title || 'Unknown Market',
          description: m.description || '',
          outcomes: outcomeNames,
          clobTokenIds: tokenIds,
          volume24hr: parseFloat(m.volume24hr) || 0,
          liquidity: parseFloat(m.liquidity) || 0
        };
      })
      // Filter out markets without valid CLOB token IDs
      .filter((m: Market) => m.clobTokenIds.length >= 2);

    lastCacheUpdate = now;
    return marketsCache;

  } catch (error) {
    // If fetch fails but we have cache, return stale cache
    if (marketsCache.length > 0) {
      return marketsCache;
    }
    throw error;
  }
}

// Search markets by query using client-side fuzzy search
export async function searchMarkets(query: string = ""): Promise<Market[]> {
  const allMarkets = await fetchAllMarkets();

  // No query = return top markets by 24h volume
  if (!query.trim()) {
    return allMarkets
      .sort((a, b) => b.volume24hr - a.volume24hr)
      .slice(0, 50);
  }

  // Use Fuse.js for fuzzy search on title and description
  const fuse = new Fuse(allMarkets, {
    keys: [
      { name: 'title', weight: 2 },      // Title matches weighted more
      { name: 'description', weight: 1 }
    ],
    threshold: 0.4,        // Lower = stricter matching
    includeScore: true,
    ignoreLocation: true,  // Match anywhere in the string
    minMatchCharLength: 2
  });

  const results = fuse.search(query);

  // Return matches sorted by relevance (Fuse score), then by volume for ties
  return results
    .map(r => r.item)
    .slice(0, 30);
}

// Fetch a market by its slug (from URL)
export async function getMarketBySlug(slug: string): Promise<Market | null> {
  try {
    // First try fetching as an event (which contains markets)
    const response = await axios.get(`${GAMMA_API}/events`, {
      params: { slug, limit: 1 }
    });

    const events = response.data || [];
    if (events.length === 0) return null;

    const event = events[0];

    // Events contain nested markets array
    const markets = event.markets || [];
    if (markets.length === 0) return null;

    // Use the first market (or the one with highest volume)
    const m = markets.sort((a: any, b: any) =>
      (parseFloat(b.volume24hr) || 0) - (parseFloat(a.volume24hr) || 0)
    )[0];

    let tokenIds: string[] = [];
    let outcomeNames: string[] = [];

    try {
      tokenIds = typeof m.clobTokenIds === 'string' ? JSON.parse(m.clobTokenIds) : (m.clobTokenIds || []);
      outcomeNames = typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : (m.outcomes || []);
    } catch (e) {
      // ignore parse errors
    }

    if (tokenIds.length < 2) return null;

    return {
      id: m.id,
      title: m.question || event.title || 'Unknown Market',
      description: m.description || event.description || '',
      outcomes: outcomeNames,
      clobTokenIds: tokenIds,
      volume24hr: parseFloat(m.volume24hr) || 0,
      liquidity: parseFloat(m.liquidity) || 0
    };
  } catch (error) {
    return null;
  }
}

// Parse a Polymarket URL and extract the slug
export function parsePolymarketUrl(url: string): string | null {
  try {
    // Handle formats like:
    // https://polymarket.com/event/btc-updown-15m-1767258000
    // https://polymarket.com/event/btc-updown-15m-1767258000?tid=123
    const match = url.match(/polymarket\.com\/event\/([^?/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// Get order book for a specific token ID
export async function getOrderBook(tokenId: string): Promise<OrderBook | null> {
  try {
    const response = await axios.get(`${CLOB_API}/book`, {
      params: { token_id: tokenId }
    });
    
    const data = response.data;
    return {
      bids: (data.bids || []).sort((a: OrderBookOrder, b: OrderBookOrder) => 
        parseFloat(b.price) - parseFloat(a.price)
      ),
      asks: (data.asks || []).sort((a: OrderBookOrder, b: OrderBookOrder) => 
        parseFloat(a.price) - parseFloat(b.price)
      )
    };
  } catch (error) {
    // 404 means no order book, return empty structure or null
    // console.error('Error fetching order book:', error);
    return null;
  }
}

export function subscribeToOrderBooks(
  tokenIds: string[], 
  onUpdate: (tokenId: string, book: OrderBook) => void
): () => void {
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    // Subscription message format for Clob WS
    const msg = {
      assets_ids: tokenIds,
      type: "book"
    };
    ws.send(JSON.stringify(msg));
  });

  ws.on('message', (data: WebSocket.Data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      // Expected format involves 'bids', 'asks', 'asset_id' or 'market'
      // Example: { "asset_id": "...", "bids": [...], "asks": [...], "hash": "..." }
      
      // Sometimes it's an array or wrapped. Clob WS usually sends array of updates or single obj.
      const items = Array.isArray(msg) ? msg : [msg];

      for (const item of items) {
        if (item.asset_id && item.bids && item.asks) {
           const book: OrderBook = {
             bids: item.bids.map((b: any) => ({ price: b.price, size: b.size })),
             asks: item.asks.map((a: any) => ({ price: a.price, size: a.size })),
             hash: item.hash
           };
           // Sort them just in case, though WS usually sends sorted or diffs. 
           // For snapshots this is safe. For diffs, this simple replacement logic works if the server sends full snapshots.
           // Polymarket 'book' channel sends snapshots.
           
           book.bids.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
           book.asks.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
           
           onUpdate(item.asset_id, book);
        }
      }
    } catch (e) {
      // console.error('WS Error parsing:', e);
    }
  });

  ws.on('error', (err) => {
    // console.error('WS Error:', err);
  });

  return () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  };
}
