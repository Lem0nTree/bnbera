# `@bnbera/marketplace`

This package is the W0/W1 read-only marketplace seam. It accepts an injected
`MarketplaceSource`, validates a production-shaped listing contract, applies
hard eligibility filters before deterministic ranking, and exposes browse,
category, search, detail, comparison, provenance, freshness, and score
explanations for public routes.

`IngestionMarketplaceSource` is the narrow adapter from the existing
`IngestionRepository` ports. It joins canonical identity/state records with a
separate metadata projection, services, capabilities, source observations, and
bounded probe results. The package does not create a database connection or
perform provider calls.

`developmentFixtureListings` are synthetic and carry the exact public shape of
an ingestion listing. Every fixture has the visible label
`DEVELOPMENT FIXTURE — NOT LIVE OR DISCOVERED DATA`; callers must keep that
label in the UI and must not relabel the records as live or discovered.

The `activation-commerce`, Creator + Altana, evidence, and payment rails are
disabled in this W0/W1 package. An advertised activation method is returned as
`available: false` with `OPTIONAL_RAIL_DISABLED` until its independent gate has
verified the standards-lock addresses, ABI, network, recipient, asset, and
end-to-end behavior.

The async read methods provide a natural loading boundary. Source failures are
mapped to the shared structured error envelope by `safeSearch` (or thrown as
`AppError` by the direct methods); a source that returns records with a
warning is represented as `sourceStatus: "degraded"`, and no-record reads are
represented as `sourceStatus: "empty"`.
