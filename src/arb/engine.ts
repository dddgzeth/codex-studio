import type {
  ArbitrageOpportunity,
  ArbitrageRouteKind,
  MarketQuote,
  OpportunityLeg,
  StrategyConfig,
  VenueBalances
} from "./types.js";

function samePair(left: MarketQuote, right: MarketQuote) {
  return left.pair.base === right.pair.base && left.pair.quote === right.pair.quote;
}

function calcFeeQuote(notionalQuote: number, feeBps: number) {
  return notionalQuote * (feeBps / 10_000);
}

function calcSlippageQuote(notionalQuote: number, slippageBps = 0) {
  return notionalQuote * (slippageBps / 10_000);
}

function makeLeg(quote: MarketQuote, action: "buy" | "sell", quantityBase: number, networkCostQuote = 0): OpportunityLeg {
  const price = action === "buy" ? quote.ask.price : quote.bid.price;
  const notionalQuote = price * quantityBase;
  return {
    venueId: quote.venueId,
    venueKind: quote.venueKind,
    action,
    price,
    quantityBase,
    notionalQuote,
    feeQuote: calcFeeQuote(notionalQuote, quote.takerFeeBps),
    networkCostQuote,
    slippageCostQuote: calcSlippageQuote(notionalQuote, quote.slippageBps)
  };
}

function isFresh(quote: MarketQuote, config: StrategyConfig, now: number) {
  return now - quote.updatedAt <= config.maxQuoteAgeMs;
}

function venueAllowed(venueId: string, config: StrategyConfig) {
  return !config.venueAllowList || config.venueAllowList.includes(venueId);
}

function routeAllowed(routeKind: ArbitrageRouteKind, config: StrategyConfig) {
  return !config.routeAllowList || config.routeAllowList.includes(routeKind);
}

function buildInventoryDeltas(buyQuote: MarketQuote, sellQuote: MarketQuote, buyLeg: OpportunityLeg, sellLeg: OpportunityLeg) {
  const buyCosts = buyLeg.feeQuote + buyLeg.networkCostQuote + buyLeg.slippageCostQuote;
  const sellCosts = sellLeg.feeQuote + sellLeg.networkCostQuote + sellLeg.slippageCostQuote;

  return {
    [buyQuote.venueId]: {
      [buyQuote.pair.base]: buyLeg.quantityBase,
      [buyQuote.pair.quote]: -(buyLeg.notionalQuote + buyCosts)
    },
    [sellQuote.venueId]: {
      [sellQuote.pair.base]: -sellLeg.quantityBase,
      [sellQuote.pair.quote]: sellLeg.notionalQuote - sellCosts
    }
  } satisfies VenueBalances;
}

function buildOpportunity(
  routeKind: ArbitrageRouteKind,
  buyQuote: MarketQuote,
  sellQuote: MarketQuote,
  buyLeg: OpportunityLeg,
  sellLeg: OpportunityLeg,
  now: number
): ArbitrageOpportunity {
  const grossProfitQuote = (sellLeg.price - buyLeg.price) * buyLeg.quantityBase;
  const totalCostsQuote =
    buyLeg.feeQuote +
    sellLeg.feeQuote +
    buyLeg.networkCostQuote +
    sellLeg.networkCostQuote +
    buyLeg.slippageCostQuote +
    sellLeg.slippageCostQuote;
  const netProfitQuote = grossProfitQuote - totalCostsQuote;
  const tradeSizeQuote = buyLeg.notionalQuote;
  const netEdgeBps = tradeSizeQuote > 0 ? (netProfitQuote / tradeSizeQuote) * 10_000 : 0;

  const reason = [
    `route=${routeKind}`,
    `buy ${buyQuote.venueId} @ ${buyLeg.price.toFixed(4)}`,
    `sell ${sellQuote.venueId} @ ${sellLeg.price.toFixed(4)}`,
    `gross=${grossProfitQuote.toFixed(4)} ${buyQuote.pair.quote}`,
    `costs=${totalCostsQuote.toFixed(4)} ${buyQuote.pair.quote}`,
    `net=${netProfitQuote.toFixed(4)} ${buyQuote.pair.quote}`
  ];

  if (routeKind === "inventory_hedged") {
    reason.push("requires quote inventory on buy venue and base inventory on sell venue");
  } else {
    reason.push("includes transfer cost and settlement latency penalty");
  }

  return {
    pair: buyQuote.pair,
    routeKind,
    buyVenueId: buyQuote.venueId,
    sellVenueId: sellQuote.venueId,
    tradeSizeQuote,
    quantityBase: buyLeg.quantityBase,
    grossProfitQuote,
    totalCostsQuote,
    netProfitQuote,
    netEdgeBps,
    buyLeg,
    sellLeg,
    inventoryDeltas: buildInventoryDeltas(buyQuote, sellQuote, buyLeg, sellLeg),
    detectedAt: now,
    reason
  };
}

function shouldKeep(opportunity: ArbitrageOpportunity, config: StrategyConfig) {
  return (
    opportunity.tradeSizeQuote <= config.maxExposureQuote &&
    opportunity.netProfitQuote >= config.minNetProfitQuote &&
    opportunity.netEdgeBps >= config.minNetEdgeBps
  );
}

export function findArbitrageOpportunities(quotes: MarketQuote[], config: StrategyConfig, now = Date.now()) {
  const opportunities: ArbitrageOpportunity[] = [];

  for (const buyQuote of quotes) {
    if (!isFresh(buyQuote, config, now) || !venueAllowed(buyQuote.venueId, config)) {
      continue;
    }

    for (const sellQuote of quotes) {
      if (buyQuote.venueId === sellQuote.venueId) {
        continue;
      }
      if (!samePair(buyQuote, sellQuote)) {
        continue;
      }
      if (!isFresh(sellQuote, config, now) || !venueAllowed(sellQuote.venueId, config)) {
        continue;
      }

      const maxBuyQty = Math.min(config.tradeSizeQuote / buyQuote.ask.price, buyQuote.ask.quantity);
      const quantityBase = Math.min(maxBuyQty, sellQuote.bid.quantity);
      if (quantityBase <= 0) {
        continue;
      }

      if (routeAllowed("inventory_hedged", config)) {
        const inventoryBuyLeg = makeLeg(
          buyQuote,
          "buy",
          quantityBase,
          buyQuote.venueKind === "dex" ? buyQuote.gasCostQuote || 0 : 0
        );
        const inventorySellLeg = makeLeg(
          sellQuote,
          "sell",
          quantityBase,
          sellQuote.venueKind === "dex" ? sellQuote.gasCostQuote || 0 : 0
        );
        const opportunity = buildOpportunity(
          "inventory_hedged",
          buyQuote,
          sellQuote,
          inventoryBuyLeg,
          inventorySellLeg,
          now
        );
        if (shouldKeep(opportunity, config)) {
          opportunities.push(opportunity);
        }
      }

      if (routeAllowed("transfer_settlement", config)) {
        const transferPenaltyQuote =
          (buyQuote.ask.price * quantityBase * (config.transferSettlementPenaltyBps || 0)) / 10_000;
        const transferBuyLeg = makeLeg(
          buyQuote,
          "buy",
          quantityBase,
          (buyQuote.withdrawalFeeQuote || 0) + (buyQuote.gasCostQuote || 0) + transferPenaltyQuote
        );
        const transferSellLeg = makeLeg(
          sellQuote,
          "sell",
          quantityBase,
          sellQuote.venueKind === "dex" ? sellQuote.gasCostQuote || 0 : 0
        );
        const opportunity = buildOpportunity(
          "transfer_settlement",
          buyQuote,
          sellQuote,
          transferBuyLeg,
          transferSellLeg,
          now
        );
        if (shouldKeep(opportunity, config)) {
          opportunities.push(opportunity);
        }
      }
    }
  }

  return opportunities.sort((left, right) => right.netProfitQuote - left.netProfitQuote);
}
