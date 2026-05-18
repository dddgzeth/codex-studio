import { findArbitrageOpportunities } from "./engine.js";
import { sampleBalances, sampleConfig, sampleQuotes } from "./fixtures.js";
import { PaperExecutor } from "./simulator.js";

function fmt(n: number) {
  return n.toFixed(4);
}

function main() {
  const opportunities = findArbitrageOpportunities(sampleQuotes, sampleConfig);

  if (opportunities.length === 0) {
    console.log("No arbitrage opportunities found.");
    return;
  }

  console.log("Detected opportunities:");
  for (const [index, opportunity] of opportunities.entries()) {
    console.log(
      [
        `${index + 1}. ${opportunity.pair.base}/${opportunity.pair.quote}`,
        `route=${opportunity.routeKind}`,
        `buy=${opportunity.buyVenueId}`,
        `sell=${opportunity.sellVenueId}`,
        `qty=${fmt(opportunity.quantityBase)}`,
        `costs=${fmt(opportunity.totalCostsQuote)} ${opportunity.pair.quote}`,
        `net=${fmt(opportunity.netProfitQuote)} ${opportunity.pair.quote}`,
        `edge=${fmt(opportunity.netEdgeBps)} bps`
      ].join(" | ")
    );
  }

  const executor = new PaperExecutor(sampleConfig, sampleBalances);
  const result = executor.execute(opportunities[0]);

  console.log("");
  console.log("Paper execution:");
  console.log(JSON.stringify(result, null, 2));
}

main();
