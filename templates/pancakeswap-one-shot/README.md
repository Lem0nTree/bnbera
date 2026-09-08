# Bounded one-shot PancakeSwap template

This is the sole BNBEra Creator template. It performs one bounded BSC-testnet
tBNB-to-curated-token PancakeSwap V2 swap after the user-controlled T6 authority is
active. It is deliberately not a grid strategy: there are no price bands,
loops, or arbitrary user code.

The Creator worker copies and verifies the checked-in immutable workspace, then
persists a deploy intent before invoking `bag deploy --provider bnb`. The checked-in Creator contract is the immutable
source for the safe enum choices: tBNB→CAKE or tBNB→BUSD, 0.0001/0.0005/0.001
tBNB input, 10/25/50 bps slippage, 30/60 second quote freshness, and 60/120
second deadline. Runtime receives only the persisted public configuration
through the generated, digest-bound `app/agent/src/bnbera-public-config.ts` module, which is bundled into
the runtime; it rejects arbitrary token,
router, recipient, and calldata values. The runtime exposes one exact request
shape, `{ "action": "execute_swap", "jobId": "<decimal>" }`. It requires the
Studio-managed `ALTANA_SESSION`, confirms the ERC-8183 job is funded for the
pinned provider/budget/payment asset, and requires the job description to be
the exact compact binding
`{"action":"execute_paid_swap","template":"pancakeswap-one-shot@1.1.0","configurationDigest":"<digest>","tradingPair":"<pair>","inputAmountWei":"<wei>"}`.
It reads `getAmountsOut` at a fresh block, derives the fixed swap calldata, and
sends one Altana SDK 0.7.1 batch containing both the swap and the canonical
ERC-8183 result transition atomically. The result manifest is served as the
same `data:application/json;base64,...` URL whose bytes produce the on-chain
deliverable hash. Accepted-but-unconfirmed relay outcomes are returned as
`unknown` and are never retried; a chain reread is the idempotency boundary.
The session JSON and signer never appear in logs, responses, or persisted
application data.
