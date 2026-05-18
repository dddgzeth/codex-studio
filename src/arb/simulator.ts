import type { ArbitrageOpportunity, ExecutionResult, StrategyConfig, VenueBalances } from "./types.js";

function cloneBalances(balances: VenueBalances) {
  return Object.fromEntries(
    Object.entries(balances).map(([venueId, assets]) => [venueId, { ...assets }])
  ) as VenueBalances;
}

function getAssetBalance(balances: VenueBalances, venueId: string, asset: string) {
  return balances[venueId]?.[asset] || 0;
}

function applyDelta(balances: VenueBalances, venueId: string, asset: string, delta: number) {
  if (!balances[venueId]) {
    balances[venueId] = {};
  }
  balances[venueId][asset] = (balances[venueId][asset] || 0) + delta;
}

export class PaperExecutor {
  private balances: VenueBalances;
  private readonly config: StrategyConfig;

  constructor(config: StrategyConfig, initialBalances: VenueBalances) {
    this.config = config;
    this.balances = cloneBalances(initialBalances);
  }

  getBalances() {
    return cloneBalances(this.balances);
  }

  execute(opportunity: ArbitrageOpportunity): ExecutionResult {
    if (opportunity.tradeSizeQuote > this.config.maxExposureQuote) {
      return {
        executed: false,
        opportunity,
        blockedBy: "max exposure exceeded",
        balancesAfter: this.getBalances(),
        realizedProfitQuote: 0
      };
    }

    const shortfalls: VenueBalances = {};

    for (const [venueId, assets] of Object.entries(opportunity.inventoryDeltas)) {
      for (const [asset, delta] of Object.entries(assets)) {
        if (delta >= 0) {
          continue;
        }

        const available = getAssetBalance(this.balances, venueId, asset);
        const required = -delta;
        if (available + 1e-9 < required) {
          if (!shortfalls[venueId]) {
            shortfalls[venueId] = {};
          }
          shortfalls[venueId][asset] = required - available;
        }
      }
    }

    if (Object.keys(shortfalls).length > 0) {
      return {
        executed: false,
        opportunity,
        blockedBy: "insufficient venue inventory",
        inventoryShortfalls: shortfalls,
        balancesAfter: this.getBalances(),
        realizedProfitQuote: 0
      };
    }

    for (const [venueId, assets] of Object.entries(opportunity.inventoryDeltas)) {
      for (const [asset, delta] of Object.entries(assets)) {
        applyDelta(this.balances, venueId, asset, delta);
      }
    }

    return {
      executed: true,
      opportunity,
      balancesAfter: this.getBalances(),
      realizedProfitQuote: opportunity.netProfitQuote
    };
  }
}
