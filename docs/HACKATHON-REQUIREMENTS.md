# Smart Money Era hackathon requirements

Source snapshot: 2026-09-06. This is a concise reading of the official
[Tracks](https://www.bnbchain.org/en/hackathons/smart-money-era?tab=tracks)
and [Resources](https://www.bnbchain.org/en/hackathons/smart-money-era?tab=resources)
pages. Explicit requirements are separated from product inference.

## Main track — explicit

- Build a functional, publicly accessible BNB Agent Studio marketplace.
- Surface agents that are live on BSC and let a user find, understand and
  activate/hire them in a few clicks without Agent Studio knowledge.
- Treat rebalancing, grid trading, yield optimisation and health-factor
  monitoring as equally deep first-class categories; single-category entries
  score poorly.
- Judges compare end-to-end functionality, real-time/decision-useful data and
  agent diversity. The winner receives the stated main prize and is intended
  for official adoption as the canonical BNB Agent Studio marketplace.

The main-track page does not mandate APEX, Altana, mainnet payments or
Greenfield. It requires a real usable activation journey; those technologies
are relevant implementation/partner-track choices.

## Partner tracks — explicit

### Altana

Qualification requires a live on-chain transaction through an agent's Altana
session key, visible in the Altana explorer. Testnet qualifies; mainnet is
stronger. Show the agent's own wallet, an on-chain registered session with call
allowlist/spend cap/expiry, and user-facing immediate revocation.

Bonuses align directly with this marketplace:

- hire a BNB Agent Studio agent through ERC-8183 using Altana's buyer/seller
  SDK; and
- sell an HTTP capability over x402/B402 using Altana's server SDK.

ERC-8183 is the job/escrow rail; x402 is the per-request payment rail. They are
complementary, not interchangeable requirements.

### TermiX

No TermiX integration is requested. TermiX will hire through the submitted
marketplace. Scoring is value of services 30%, proven agent advantage 30%,
high-stakes categories/track record 20%, and marketplace quality 20%.

The required Agent Advantage Report contains at least three real tasks run
with the hired agent and without it, comparing time, cost and output quality
with outputs attached. At least one task is trading, stock/equities or
security-related.

### PancakeSwap

The separate challenge requires a real benefit to PancakeSwap traders or
liquidity providers without putting user funds at risk.

## Official resources that affect the MVP

- BNB Agent Studio creates/deploys agent supply: cloud runtime, wallet,
  ERC-8004 identity, ERC-8183 task interface and x402-funded operating calls.
- 8004scan exposes identity, capability, ownership, reputation, feedback and
  network data. Hackathon Pro access advertises 500 requests/minute and
  100,000/day; obtain it rather than weakening marketplace filtering.
- Altana provides scoped autonomous authority plus ERC-8183 buyer/seller and
  x402 seller SDKs. Its ERC-8183 documentation publishes a chain-97 `U` faucet;
  verify it read-only before one authorized testnet claim.
- Greenfield is a listed ecosystem resource, not an explicit main-track gate.
  Keep the planned small evidence publication after marketplace, hiring and
  Creator work.

## Product motivation — evidence-backed inference

BNB Chain already supplies the vertical primitives: Studio creates agents,
ERC-8004 identifies them, 8004scan indexes them, ERC-8183 handles jobs, x402
handles paid calls, and Altana constrains autonomous wallets. APEX is only one
ERC-8183 implementation. It does not solve cross-agent discovery, comparable
data, reputation presentation, category navigation, activation UX or proof
that hiring an agent is better than doing the task manually.

The hackathon is seeking that missing horizontal distribution and trust layer:
the canonical front door connecting agent supply to users and other agents.
The winning product should therefore emphasize useful verified supply,
decision-quality data, effortless activation, measured results and reputation;
deploying another escrow kernel is not the differentiator.

## MVP priority derived from the rubric

1. Public four-category marketplace with honest live data and reputation.
2. One useful ERC-8183 hire/result/settlement and verified review.
3. Three-task Agent Advantage Report, including one high-stakes task.
4. One Altana session grant/action/revoke proof and Creator flow.
5. One small x402-paid capability if time remains; this strengthens the Altana
   entry and demonstrates agent-to-agent commerce without replacing ERC-8183.
6. Greenfield evidence and PancakeSwap challenge depth after the core judging
   path works.

