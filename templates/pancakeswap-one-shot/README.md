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
through the generated, digest-bound `app/agent/bnbera-public-config.json`; it rejects arbitrary token,
router, recipient, and calldata values. The plan endpoint remains plan-only
until the T6 Studio session mismatch is resolved and does not claim a quote,
funding, or execution.
