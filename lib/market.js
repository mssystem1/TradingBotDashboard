const VENUE = "https://api.hyperliquid.xyz/info";
const COINS = new Set(["BTC", "ETH", "HYPE"]);
const MINUTE = 60_000;

export function validCoin(coin) {
  return COINS.has(coin);
}

async function marketRequest(payload) {
  const response = await fetch(VENUE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Hyperliquid public data is unavailable");
  return response.json();
}

export async function quote(coin) {
  if (!validCoin(coin)) throw new Error("Unsupported market");
  const book = await marketRequest({ type: "l2Book", coin });
  const [bids, asks] = book.levels;
  const [bid, ask, bidSize, askSize] = [bids[0].px, asks[0].px, bids[0].sz, asks[0].sz].map(Number);
  if (![bid, ask, bidSize, askSize].every(value => Number.isFinite(value) && value > 0) || bid > ask) {
    throw new Error("Invalid public quote");
  }
  if (!Number.isFinite(book.time) || Math.abs(Date.now() - book.time) > 60_000) throw new Error("Stale public quote");
  const price = (bid + ask) / 2;
  return {
    coin, bid, ask, price, time: book.time,
    spreadBps: (ask - bid) / price * 10_000,
    imbalance: (bidSize - askSize) / (bidSize + askSize),
  };
}

async function completedCandles(coin, end) {
  if (!validCoin(coin)) throw new Error("Unsupported market");
  const candles = await marketRequest({
    type: "candleSnapshot", req: { coin, interval: "1m", startTime: end - 16 * MINUTE, endTime: end - 1 },
  });
  return candles.map(row => [row.t, Number(row.c)]).filter(([time, price]) =>
    Number.isFinite(time) && time < end && Number.isFinite(price) && price > 0);
}

export async function priceHistory(coin) {
  const end = Math.floor(Date.now() / MINUTE) * MINUTE;
  const candles = await completedCandles(coin, end);
  return [...new Map(candles)].sort((a, b) => a[0] - b[0]);
}

export async function marketState(coin) {
  if (!validCoin(coin)) throw new Error("Unsupported market");
  const now = Math.floor(Date.now() / MINUTE) * MINUTE;
  const [latest, candles] = await Promise.all([
    quote(coin),
    completedCandles(coin, now),
  ]);
  const prices = new Map(candles);
  const one = prices.get(now - 2 * MINUTE);
  const five = prices.get(now - 6 * MINUTE);
  const fifteen = prices.get(now - 16 * MINUTE);
  const close = prices.get(now - MINUTE);
  if (![one, five, fifteen, close].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error("Complete market candles are unavailable");
  }
  return {
    quote: latest,
    metrics: {
      return_1m_bps: (close / one - 1) * 10_000,
      return_5m_bps: (close / five - 1) * 10_000,
      return_15m_bps: (close / fifteen - 1) * 10_000,
      top_of_book_imbalance: latest.imbalance,
      spread_bps: latest.spreadBps,
    },
  };
}
