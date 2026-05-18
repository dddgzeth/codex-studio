export type VenueKind = "cex" | "dex";
export type ArbitrageRouteKind = "inventory_hedged" | "transfer_settlement";

export type TradingPair = {
  base: string;
  quote: string;
};

export type OrderBookLevel = {
  price: number;
  quantity: number;
};

export type MarketQuote = {
  venueId: string;
  venueKind: VenueKind;
  pair: TradingPair;
  bid: OrderBookLevel;
  ask: OrderBookLevel;
  takerFeeBps: number;
  withdrawalFeeQuote?: number;
  gasCostQuote?: number;
  slippageBps?: number;
  updatedAt: number;
};

export type VenueAssetBalances = Record<string, number>;
export type VenueBalances = Record<string, VenueAssetBalances>;

export type StrategyConfig = {
  tradeSizeQuote: number;
  minNetProfitQuote: number;
  minNetEdgeBps: number;
  maxQuoteAgeMs: number;
  maxExposureQuote: number;
  routeAllowList?: ArbitrageRouteKind[];
  transferSettlementPenaltyBps?: number;
  venueAllowList?: string[];
};

export type OpportunityLeg = {
  venueId: string;
  venueKind: VenueKind;
  action: "buy" | "sell";
  price: number;
  quantityBase: number;
  notionalQuote: number;
  feeQuote: number;
  networkCostQuote: number;
  slippageCostQuote: number;
};

export type ArbitrageOpportunity = {
  pair: TradingPair;
  routeKind: ArbitrageRouteKind;
  buyVenueId: string;
  sellVenueId: string;
  tradeSizeQuote: number;
  quantityBase: number;
  grossProfitQuote: number;
  totalCostsQuote: number;
  netProfitQuote: number;
  netEdgeBps: number;
  buyLeg: OpportunityLeg;
  sellLeg: OpportunityLeg;
  inventoryDeltas: VenueBalances;
  detectedAt: number;
  reason: string[];
};

export type ExecutionResult = {
  executed: boolean;
  opportunity: ArbitrageOpportunity;
  blockedBy?: string;
  inventoryShortfalls?: VenueBalances;
  balancesAfter: VenueBalances;
  realizedProfitQuote: number;
};
