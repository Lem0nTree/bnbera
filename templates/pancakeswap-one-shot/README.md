# Bounded one-shot PancakeSwap template

This is the sole BNBEra Creator template. It performs one bounded BSC-testnet
tBNB-to-CAKE PancakeSwap V2 swap after the user-controlled T6 authority is
active. It is deliberately not a grid strategy: there are no price bands,
loops, or arbitrary user code.

The Creator worker scaffolds its native Agent Studio workspace with the pinned
`bag init` command, then persists a deploy intent before invoking
`bag deploy --provider bnb`. The checked-in Creator contract is the immutable
source for parameters, selector allowlist, amount, deadline and template digest.
