import type { MarketQuote, StrategyConfig, VenueBalances } from "./types.js";

const now = Date.now();

export const sampleQuotes: MarketQuote[] = [
  {
    venueId: "binance_spot",
    venueKind: "cex",
    pair: { base: "ETH", quote: "USDT" },
    bid: { price: 3124.2, quantity: 4.5 },
    ask: { price: 3124.9, quantity: 4.1 },
    takerFeeBps: 10,
    withdrawalFeeQuote: 1.5,
    updatedAt: now
  },
  {
    venueId: "okx_spot",
    venueKind: "cex",
    pair: { base: "ETH", quote: "USDT" },
    bid: { price: 3126.8, quantity: 3.4 },
    ask: { price: 3127.1, quantity: 3.2 },
    takerFeeBps: 8,
    withdrawalFeeQuote: 1.2,
    updatedAt: now
  },
  {
    venueId: "uniswap_v3",
    venueKind: "dex",
    pair: { base: "ETH", quote: "USDT" },
    bid: { price: 3141.6, quantity: 2.8 },
    ask: { price: 3129.2, quantity: 2.6 },
    takerFeeBps: 5,
    gasCostQuote: 6.5,
    slippageBps: 12,
    updatedAt: now
  },
  {
    venueId: "binance_spot",
    venueKind: "cex",
    pair: { base: "BTC", quote: "USDT" },
    bid: { price: 68120, quantity: 0.7 },
    ask: { price: 68135, quantity: 0.7 },
    takerFeeBps: 10,
    withdrawalFeeQuote: 2.3,
    updatedAt: now
  },
  {
    venueId: "jupiter",
    venueKind: "dex",
    pair: { base: "BTC", quote: "USDT" },
    bid: { price: 68240, quantity: 0.2 },
    ask: { price: 68295, quantity: 0.2 },
    takerFeeBps: 6,
    gasCostQuote: 4.1,
    slippageBps: 15,
    updatedAt: now
  }
];

export const sampleConfig: StrategyConfig = {
  tradeSizeQuote: 10_000,
  minNetProfitQuote: 8,
  minNetEdgeBps: 5,
  maxQuoteAgeMs: 4_000,
  maxExposureQuote: 15_000,
  routeAllowList: ["inventory_hedged", "transfer_settlement"],
  transferSettlementPenaltyBps: 18
};

export const sampleBalances: VenueBalances = {
  binance_spot: {
    USDT: 18_000,
    ETH: 0.1,
    BTC: 0.05
  },
  okx_spot: {
    USDT: 6_000,
    ETH: 1.8
  },
  uniswap_v3: {
    USDT: 12_000,
    ETH: 3.2
  },
  jupiter: {
    USDT: 3_000,
    BTC: 0.25
  }
};
