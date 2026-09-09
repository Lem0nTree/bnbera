/** Read-only latency check. Run with the same environment as the web process. */
import pg from "pg";
import { performance } from "node:perf_hooks";
import { readMarketplaceApi, readMarketplaceAgentApi, closeMarketplaceDatabaseForTests } from "../apps/web/src/lib/marketplace-server";

const slug = process.argv[2] ?? "bnb-lp-range-rebalancer-56-265375";
let queries = 0;
const query = pg.Pool.prototype.query;
pg.Pool.prototype.query = function (...args: Parameters<typeof query>) {
  queries += 1;
  return query.apply(this, args);
} as typeof query;

try {
  for (const pass of ["cold", "warm"]) {
    queries = 0;
    const started = performance.now();
    const [detail, home] = await Promise.all([
      readMarketplaceAgentApi(slug), readMarketplaceApi({ limit: 6 })
    ]);
    console.log(JSON.stringify({ pass, durationMs: Math.round(performance.now() - started), queries,
      detailStatus: detail.status, slug: detail.agent?.slug, homeStatus: home.status,
      homeCount: home.agents.length, total: home.total,
      referencePresent: (await readMarketplaceApi({ limit: 100 })).agents.some(agent => agent.identity.agentId === process.env.T5_REFERENCE_PROVIDER_AGENT_ID)
    }));
    if (!detail.agent || home.agents.length !== 6 || detail.status === "error" || home.status === "error") process.exitCode = 1;
  }
} finally {
  pg.Pool.prototype.query = query;
  await closeMarketplaceDatabaseForTests();
}
