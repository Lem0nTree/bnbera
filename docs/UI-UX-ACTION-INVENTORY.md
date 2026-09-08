# BNBEra marketplace UI/UX action inventory

Status: design and implementation handoff for the Astra low UI pass
Audited: 2026-09-08
Source checkout: `origin/main` at `5ae197cd5719a7fcb9d533f2309ed3826f1a1c10`
Scope: the remaining MVP sprint; keep the implementation bounded to the existing Next.js app, contracts, routes, and APIs.

This document is an action inventory, not a new product specification. It tells Astra what a user must be able to see and do, what is already real in the repository, and where the current implementation is gated or missing. A visual redesign must preserve the existing truth model and API boundaries.

## Read this first: Astra implementation directive

Before changing components, read the requested [Apple Design skill](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md). Apply it as an interaction and hierarchy directive, not as a reason to add a motion framework or a new design system.

- Make purpose and the primary next action obvious on every screen. Use plain, specific labels such as `Browse agents`, `Open detail`, `Request quote`, `Approve and settle`, `Revoke authority`, and `Reconcile transaction`.
- Preserve agency and responsibility. Show the exact object, network, amount, digest, authority scope, and irreversible consequence before a wallet/passkey request. Do not auto-approve, auto-settle, retry an unknown transaction, or imply that discovery grants execution authority.
- Give immediate press feedback and continuous progress. A wallet request, server preparation, wallet confirmation, receipt wait, and post-receipt reconciliation are different moments and must not collapse into one spinner or one success toast.
- Use visual hierarchy and proximity to map a control to the data it changes. Keep common paths visible; place advanced evidence and raw digests behind a deliberate disclosure only if the user can still find them.
- Use motion sparingly and purposefully. Default to short, critically damped transitions; use momentum only for a real drag/sheet gesture; make transitions interruptible and reversible. Do not animate core status changes in a way that delays reading or blocks input.
- Honor `prefers-reduced-motion`, `prefers-reduced-transparency`, and `prefers-contrast: more`; retain non-motion feedback and sufficient contrast. Keep keyboard focus, skip navigation, labelled controls, live regions, and responsive text sizing intact.
- Use the existing BNBEra visual language as a starting point, but make the marketplace feel like one product: consistent typography, spacing, cards, status chips, evidence labels, buttons, empty states, and toast placement across browse, detail, hire, Creator, and management.
- Do not add fake ratings, fake live values, fake job counts, fake Greenfield links, fake wallet states, or placeholder transaction hashes. `Unavailable`, `Pending`, `Unknown`, `Degraded`, `Rejected`, and `Historical snapshot` are product states, not copy to hide.

### WalletConnect/Reown reading required for the commerce surface

The existing browser path uses Wagmi's WalletConnect connector and EOA calls. Read the current official guidance before changing wallet UI or notifications:

- [Reown AppKit React hooks](https://docs.reown.com/appkit/react/core/hooks) — connection/account/network state and switching.
- [Reown Wagmi send-transaction recipe](https://docs.reown.com/appkit/recipes/wagmi-send-transaction) — signing and sending are separate from receipt confirmation.
- [WalletConnect WalletGuide submission](https://docs.walletconnect.network/walletguide/explorer-submission) — expected connect, switch-chain, sign, send, and disconnect behavior across browser/mobile wallets.
- [Reown AppKit React installation](https://docs.reown.com/appkit/react/core/installation) — current AppKit configuration context; do not replace the pinned connector casually.

The design must reflect these distinctions:

1. The dapp opens a connection request; the user approves or rejects it in the wallet.
2. A connected wallet can be on the wrong chain. Requesting a switch is not the same as observing the switch.
3. SIWE is a signature request and a server verification step; it is not a blockchain transaction.
4. A transaction request may be accepted by the wallet, submitted with a public hash, mined with a receipt, reverted, or left unknown. Only operation-specific reconciliation can make the commerce state trustworthy.
5. Account/network changes invalidate the prior authenticated authority and require a clear re-authentication path.

Never put private keys, passkey exports, raw sessions, session private keys, credentials, or cookie values in a toast, URL, component state exposed to the UI, log, or application data. Public addresses and public transaction hashes may be shown in a copyable, compact form.

## Status vocabulary used in this inventory

| Label | Meaning for Astra | Design consequence |
| --- | --- | --- |
| **Implemented** | The current branch has a route/component and a real read or mutation seam. | Preserve behavior while improving hierarchy and feedback. |
| **Partial / gated** | Code exists, but a feature flag, standards lock, runtime dependency, or acceptance gate prevents general use. | Show the truthful disabled/degraded state; do not imply that the feature is ready. |
| **Missing** | There is no complete route, component, or API contract for the action. | Do not fabricate it. Add only a clearly bounded UI shell or request a small API task. |
| **Evidence-only** | The user can inspect persisted proof, but cannot cause the underlying write from this surface. | Use provenance labels, timestamps, hashes, and safe links; avoid an action-looking CTA. |
| **Proposed grouping** | A cohesive navigation or visual grouping desired for the redesign. | Implement with existing contracts where possible; track any new backend seam explicitly. |

## Existing implementation map

These are the source-of-truth surfaces Astra should reuse or reshape.

| Surface | Route | Current implementation | Existing data/API seam | Current truth |
| --- | --- | --- | --- | --- |
| Home | `/` | `apps/web/app/page.tsx` | `categoryLabel` / `categoryDescription` from `apps/web/src/lib/presentation.ts`; static links | Implemented read-only landing page; it explicitly says activation, payment, custody, and transaction side effects are disabled. |
| Marketplace browse | `/marketplace` | `apps/web/app/marketplace/page.tsx`, `MarketplaceExplorer`, `AgentCard`, `CompareToggle` | `readMarketplaceForPage`; `GET /api/marketplace`; `MarketplaceSearchResponse` in `apps/web/src/lib/marketplace-contract.ts` | Implemented. Search, filters, category tabs, cards, exclusions, state previews, and truthful read states exist. |
| Category browse | `/marketplace/[category]` | `apps/web/app/marketplace/[category]/page.tsx`, `MarketplaceExplorer` | Same read seam with `category`; valid segments are `rebalancing`, `grid-trading`, `yield-optimisation`, and `health-factor` | Implemented. `uncategorized` is a data category but not a generated category route. |
| Agent detail | `/agents/[slug]` | `apps/web/app/agents/[slug]/page.tsx`, `AgentDetailView`, `ActivationPanel`, `CommerceJourney` | `readMarketplaceAgentForPage`; `GET /api/marketplace/[slug]` | Implemented read/enrichment view; commerce is gated per listing and environment. |
| Compare | `/compare?agents=<slug,...>` | `apps/web/app/compare/page.tsx`, `CompareTable`, `CompareToggle` | Up to three slugs; each detail is read through `readMarketplaceAgentForPage` / the detail API | Implemented read-only comparison; no wallet, payment, or invocation. |
| Hire | Inline on eligible detail/card | `ActivationPanel` -> `CommerceJourney` -> `EoaWalletProvider` | Commerce APIs listed in [Hire lifecycle](#hire-quote-and-erc-8183-lifecycle) | Partial / gated. The browser flow is implemented for a local canary but `activation.enabled` and release gates control exposure. |
| Creator create | `/create` | `apps/web/app/create/page.tsx`, `CreatorForm` | Creator authority, draft, handoff, deployment, and auth APIs listed in [Creator](#creator-guided-flow-altana-authority-and-revoke) | Partial / gated. The bounded passkey/Altana flow is implemented, but Studio readiness and runtime handoff can block deployment. |
| Creator management | `/creator` | `apps/web/app/creator/page.tsx`, `CreatorDashboard` | `GET /api/creator/drafts`, authority and deployment/registration APIs | Partial / gated. Draft and public authority status can be inspected; live Studio/registration completion is not implied. |
| Hired-agent hub | None | No top-level page/component; authenticated `GET /api/commerce/jobs?cursor=…&limit=…` now provides the buyer-owned history | The list derives ownership only from the validated server session and returns bounded newest-first public summaries | UI missing; API implemented. See [Hired agents management](#hired-agents-management-and-lifecycle-states). |
| Public funding helper | Not mounted | `apps/web/src/components/public-wallet-funding.tsx` (covered by `public-wallet-funding.test.tsx`) | No current page imports it | Dormant component. If reintroduced, keep its copy-address/manual-copy behavior and public-address-only boundary; do not imply it funds a wallet automatically. |
| Toast system | None | Current UI uses `Callout`, `role=status`, `role=alert`, and `LoadingState`; no shared toast component | No notification API | Missing. Add a small accessible notification layer only if it consumes the existing state transitions; keep durable details in the relevant panel. |

## 1. Home and marketplace browse, search, and category filters

### Home actions

| ID | User action or state | Status | Existing grounding and required UX |
| --- | --- | --- | --- |
| HOME-01 | Open BNBEra home | Implemented | `/` renders the hero and explains the six independent axes. Keep the explanation concise and make the primary `Explore marketplace` action dominant. |
| HOME-02 | Select `Explore marketplace` | Implemented | `Link` to `/marketplace` in `apps/web/app/page.tsx`. Preserve a direct, no-loading-detour transition. |
| HOME-03 | Select `Compare up to three` | Implemented | `Link` to `/compare`. Explain that comparison is read-only. |
| HOME-04 | Select a category tile | Implemented | Four links to `/marketplace/rebalancing`, `/marketplace/grid-trading`, `/marketplace/yield-optimisation`, and `/marketplace/health-factor`. Keep each description truthful and equal-weighted. |
| HOME-05 | Understand release truth | Implemented / evidence-only | The home gate cards show Core Marketplace enabled and Activation/Commerce and Creator/Altana disabled. Keep this visible but subordinate to discovery. |
| HOME-06 | See data mode and fixture warning | Implemented / evidence-only | Home copy and `Callout` explain that development fixture data is labelled and is never a production fallback. Never style a fixture as live. |
| HOME-07 | Use global navigation | Partial | `layout.tsx` currently links only `Marketplace` and `Compare`. A redesigned nav may add `Create` and `Hired` only when their route/API behavior is honestly supported; do not expose a dead destination. |

### Browse and category actions

| ID | User action or state | Status | Existing grounding and required UX |
| --- | --- | --- | --- |
| BROWSE-01 | Open all marketplace supply | Implemented | `/marketplace` loads `readMarketplaceForPage` and `MarketplaceExplorer`. Keep the read-only boundary and source mode visible above the grid. |
| BROWSE-02 | Open one category | Implemented | Category route passes `category` into the same search contract. Preserve other query filters when changing tabs (`paramsForCategory`). |
| BROWSE-03 | Return to all supply | Implemented | `All supply` removes `category` and compare slugs from its generated URL. Make this feel like a predictable tab, not a destructive reset of unrelated filters. |
| BROWSE-04 | Search by capability, protocol, or name | Implemented | `MarketplaceExplorer` uses `q` / `query`, max 120 characters. Submit updates the URL and server read; no invented client-side ranking. |
| BROWSE-05 | Filter by network | Implemented | `chainId`: Any, BSC mainnet `56`, BSC testnet `97`. Keep the network in every card/detail identity presentation. |
| BROWSE-06 | Filter by origin | Implemented | `discovered`, `manual_import`, `created`. Preserve origin as an axis, not a quality claim. |
| BROWSE-07 | Filter by verification | Implemented | `verified`, `degraded`, `pending`, `rejected`. Use exact state names and explain that verification is independent of runtime health. |
| BROWSE-08 | Filter by runtime | Implemented | `live`, `paused`, `unavailable`. Do not equate `live` with a guaranteed future execution. |
| BROWSE-09 | Filter by freshness | Implemented | `fresh`, `stale`, `unknown`. Show the observation timestamp and use `unknown` when the source has no measurement. |
| BROWSE-10 | Filter by protocol | Implemented | Current options: PancakeSwap, PancakeSwap V3, Venus, Lista, A2A, MCP, X402. Keep protocol labels sourced from the card; do not imply that a listed protocol is tested. |
| BROWSE-11 | Sort results | Implemented | `relevance`, `score`, `freshness`; server contract applies hard filters before ranking. Explain eligibility score only as a read-model score. |
| BROWSE-12 | Apply filter form | Implemented | Form submit uses `router.push` with `q`, `chainId`, `origin`, `verification`, `runtime`, `protocol`, `freshness`, and `sort`. Preserve focus and announce the updated result count. |
| BROWSE-13 | See source mode, result count, exclusions, and contract version | Implemented / evidence-only | `DataModeBadge`, total, excluded count, and `contractVersion` appear in the explorer status row. Keep this discoverable for trust without overwhelming first-time users. |
| BROWSE-14 | Read an agent card | Implemented / evidence-only | `AgentCard` displays category, source mode, eligibility, description, network, full identity key in compact form, protocols, endpoint probe, uptime samples, three reputation views, completed jobs, six axes, freshness, and activation summary. Keep data hierarchy ordered: identity/category → capability → freshness/health → trust/evidence → next action. |
| BROWSE-15 | Add/remove a card from comparison | Implemented | `CompareToggle` stores comma-separated slugs in the `agents` query parameter and caps selection at three. Use pressed state and an accessible explanation when full. |
| BROWSE-16 | Open agent detail | Implemented | `View detail` link to `/agents/[slug]`; excluded rows use `Inspect detail`. Keep excluded candidates inspectable without presenting them as eligible. |
| BROWSE-17 | Inspect exclusion reasons | Implemented / evidence-only | `response.excluded` shows hard-filter reason codes/messages. Explain that a score cannot rescue a failed chain, capability, protocol, health, price, or freshness requirement. |
| BROWSE-18 | See no matching records | Implemented | `EmptyState` distinguishes no filter match from an empty production source. Offer `widen filters`/`return to all` and API recovery guidance, not fixture injection. |
| BROWSE-19 | See loading state | Implemented | `LoadingState` is used by page/Suspense and the explorer preview. Keep skeleton/loading copy specific to the operation. |
| BROWSE-20 | See degraded upstream data | Implemented | `Callout` warns that cards are labelled previews and runtime/freshness/eligibility/evidence are not live proof. Keep browse usable while visually separating degraded content. |
| BROWSE-21 | See read error and next action | Implemented | Error envelope displays code, retryable flag, message, and `nextAction`. Provide a clear retry path where the error is retryable. |
| BROWSE-22 | Use QA read-state previews | Implemented in non-production | `loading`, `empty`, `degraded`, and `error` links use `?preview=` only when mode is not live. Keep hidden/disabled in production. |

### Browse data contract Astra must not change

`MarketplaceSearchResponse` contains `status`, `mode`, `dataLabel`, `notice`, `agents`, `excluded`, `total`, `selection`, `meta`, and `error`. `MarketplaceAgentReadModel` contains the full `(namespace, chainId, identityRegistry, agentId)` identity plus `stateAxes`, `services`, `capabilityManifest`, `eligibility`, `freshness`, `pricing`, `authority`, `currentData`, `health`, `metrics`, `serviceEvidence`, `evidence`, `activation`, `scoreExplanation`, and `dataProvenance`. The UI may reorganize these fields, but it must not collapse the six axes or infer a missing field.

## 2. Compare

| ID | User action or state | Status | Existing grounding and required UX |
| --- | --- | --- | --- |
| CMP-01 | Start comparison from a card | Implemented | `CompareToggle` pushes the selected slug into `/compare?agents=...`; do not perform a fetch or wallet action from the toggle. |
| CMP-02 | Select up to three agents | Implemented | Three is a hard UI and parser cap. When full, disable the fourth toggle and explain `Compare up to three agents`; do not silently replace a selection. |
| CMP-03 | Remove an agent | Implemented | Pressed `In compare` removes the slug. If no agents remain, return to the current browse path rather than an unusable empty URL. |
| CMP-04 | Open comparison from browse | Implemented | `Compare selected` bar links to `/compare`. Keep the bar visible only when the query contains selections. |
| CMP-05 | Open an agent's detail from comparison | Implemented | `Open detail` links to `/agents/[slug]`. Preserve a way back to the selected comparison. |
| CMP-06 | Read side-by-side eligibility | Implemented / evidence-only | `CompareTable` shows eligibility score or excluded status and reasons/score factors. Do not label score as reputation or quality guarantee. |
| CMP-07 | Read identity, state axes, provenance, protocol/capability, freshness, and evidence side by side | Implemented / evidence-only | Existing compare cells use the same read model as cards/detail. Keep row labels consistent across all screens. |
| CMP-08 | See comparison with a missing record | Implemented | Page reports missing slugs and renders the records returned. Do not fabricate a placeholder agent column. |
| CMP-09 | See comparison read error | Implemented | Page renders a warning for response errors. Retain the returned columns when partial results exist. |
| CMP-10 | See comparison with no selections | Implemented | `EmptyState` links back to `/marketplace` and explicitly says no activation/payment is triggered. |
| CMP-11 | Understand comparison side effects | Implemented / evidence-only | Keep an always-visible short statement: comparison changes are read-only; no wallet, quote, payment, transaction, or service invocation occurs. |

## 3. Agent detail and enrichment

The detail page is the canonical “understand before acting” view. Keep this order unless a usability test demonstrates a clearer mapping:

1. Hero identity and category.
2. Provenance and observation boundary.
3. Independent six-axis state model.
4. Advertised capability manifest and schemas.
5. Service faces and advertised-versus-tested evidence.
6. Current protocol/financial data with freshness.
7. Marketplace metrics and three separated reputation views.
8. Eligibility explanation.
9. Authority summary.
10. Pricing and activation (or an honest disabled state).
11. Greenfield/IPFS evidence and versioned artifacts.

| ID | User action or state | Status | Existing grounding and required UX |
| --- | --- | --- | --- |
| DETAIL-01 | Follow breadcrumbs back to marketplace/category | Implemented | `AgentDetailView` renders `Marketplace / category / agent`; link at least the marketplace crumb and keep category context. |
| DETAIL-02 | Read hero category/name/tagline | Implemented / evidence-only | Hero uses `categoryLabel`, `name`, `tagline`, source mode, verification, runtime, endpoint, and BSC chain badges. Avoid a single “trusted/live” badge. |
| DETAIL-03 | Read full ERC-8004 identity | Implemented / evidence-only | Namespace, chain ID, identity registry, agent ID, observed owner, and observed agent wallet are shown. Keep full values copyable and visually compact; do not expose secret material. |
| DETAIL-04 | Read provenance boundary | Implemented / evidence-only | Callout explains source mode and that fixture/degraded labels are not live proof. Preserve source references, first/last observation, digest, normalized ingestion version, and finalized/provisional identity read metadata where available. |
| DETAIL-05 | Read endpoint health and identity read consistency | Implemented / evidence-only | Show endpoint status, probe time/source/latency, observed block/consistency, block hash. Make “database connectivity is not endpoint health” legible. |
| DETAIL-06 | Read six independent state axes | Implemented / evidence-only | `StateAxisGrid` shows origin, claim, verification, runtime, authority, and listing. Never merge into one lifecycle badge. |
| DETAIL-07 | Inspect advertised capability | Implemented / evidence-only | Capability cards show capability ID, description, input schema, and output schema. Use disclosure for large schemas, but keep the capability name and summary visible. |
| DETAIL-08 | Inspect services | Implemented / evidence-only | Show service kind, advertised URL, Agent Card URL, invocation URL(s), protocol version, advertised skills, tested skills, test status, and observed time. Current service rows are text, not invocation CTAs; do not turn them into “Run” buttons without a separate approved execution contract. |
| DETAIL-09 | Read current data | Implemented / evidence-only | Show available/stale/unavailable, timestamped items, units/source, and the explicit warning that stale/unavailable current data blocks execution. |
| DETAIL-10 | Read uptime/health metrics | Implemented / evidence-only | Show successful/attempted samples, observed span, coverage, monitoring horizon, timestamps, and source. Missing periods are unknown; never show one probe as 100% uptime. |
| DETAIL-11 | Read reputation views separately | Implemented / evidence-only | Keep raw permissionless ERC-8004 feedback, recognized reviewer/validator evidence, and BNBEra verified-purchase reviews in separate labelled sections. Include reviewer, values/decimals, tags, block/time, URI/hash, revocation, completed job, result digests, and settlement receipt as provided. Never produce one unqualified star average. |
| DETAIL-12 | Read completed jobs and last result | Implemented / evidence-only | Counts come only from confirmed BNBEra jobs or separately sourced external metrics. Unknown/unavailable must remain visible. A result reference is not proof of settlement unless the read model says so. |
| DETAIL-13 | Inspect eligibility | Implemented / evidence-only | Show eligible/excluded, score, and hard-filter reasons. Provide a path back to filters when excluded. |
| DETAIL-14 | Inspect authority summary | Implemented / evidence-only | Show status (`none`, `active`, `expired`, `revoked`), provider, execution wallet, expiry, spend cap, and summary. State explicitly that discovery/claim does not grant BNBEra execution authority. |
| DETAIL-15 | Compare from detail | Implemented | `CompareToggle` and `Open comparison` are read-only. Preserve selected slugs when navigating. |
| DETAIL-16 | Read pricing | Implemented / evidence-only | Show pricing model, token/currency, amount/range, availability, and explanation. Unknown price is not free; fixture price is not a quote. |
| DETAIL-17 | See activation unavailable/degraded | Partial / gated | `ActivationPanel` shows title, availability, reason, next action, and disabled CTA when the feature gate is closed. Keep this honest and avoid making a disabled button look like the primary action. |
| DETAIL-18 | Open a verified Greenfield profile | Implemented / evidence-only | `AgentDetailView` exposes a safe HTTPS read link only for verified evidence. Show locator, status, version, seal semantics, digest, and last verification. |
| DETAIL-19 | Inspect historical profile/run-bundle version | Implemented / evidence-only | `evidenceVersionLabel` labels an older artifact as `historical snapshot`. Keep current version separate from the artifact version. |
| DETAIL-20 | Read Greenfield seal state | Implemented / evidence-only | `evidenceSealLabel` says `Seal confirmed`, `Seal confirmed; transaction hash unavailable.`, or `Seal not confirmed`; do not invent a hash. |
| DETAIL-21 | Read missing/degraded detail | Implemented | Detail route handles `loading`, `empty`, `degraded`, `error`, and fixture-not-found with `LoadingState`, `EmptyState`, and `Callout`. Keep retry/back-to-browse actions visible. |

## 4. WalletConnect, SIWE, and chain confirmation

The current wallet authority lives inside `CommerceJourney` and is wrapped by `EoaWalletProvider`. The connector is intentionally WalletConnect-only and targets BNB Smart Chain testnet (`chainId 97`) for the buyer canary. Browsing must remain usable when wallet configuration is absent.

| ID | User action or state | Status | Existing grounding and required UX |
| --- | --- | --- | --- |
| WALLET-01 | See wallet capability availability | Implemented / gated | `walletConnectProjectConfigured` checks `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Show `WalletConnect unavailable` and keep browse/detail read-only when missing. Do not surface the project ID as a secret or ask the user to configure it in the browser. |
| WALLET-02 | Start WalletConnect connection | Partial / gated | `Connect WalletConnect` calls `useConnect().connectAsync` with the configured connector and chain 97. Show a pending/request toast while the wallet/modal is open. |
| WALLET-03 | Approve connection in wallet | Partial / gated | On success show connected public address and next step. Connection success does not mean SIWE authentication or commerce authorization. |
| WALLET-04 | Reject/close connection | Partial / gated | Distinguish a user cancellation from a provider failure. Keep the page usable and offer `Connect WalletConnect` again. |
| WALLET-05 | Detect wrong chain | Partial / gated | When connected on a chain other than 97, show current chain and why commerce requires BSC testnet. Disable commerce actions until corrected. |
| WALLET-06 | Request chain switch | Partial / gated | `Switch to BNB testnet` calls `useSwitchChain`. Show requested/pending, confirmed, rejected, and failed states; do not say switched until Wagmi reports chain 97. |
| WALLET-07 | Start SIWE sign-in | Partial / gated | `Sign in with wallet` calls `POST /api/auth/siwe/challenge`, verifies canonical message text, then invokes `signMessageAsync`. Explain that this is a gasless ownership proof, not a payment transaction. |
| WALLET-08 | Confirm SIWE signature/server session | Partial / gated | `POST /api/auth/siwe/verify` returns the bounded session; show success only after the server response. `GET /api/auth/session` restores a matching session on reload. |
| WALLET-09 | Reject/fail SIWE | Partial / gated | User rejection should say sign-in was canceled; malformed/expired/mismatched proof should explain the safe next action (`sign in again`). Never expose raw signature data. |
| WALLET-10 | See authenticated buyer wallet | Partial / gated | Show compact public address and `Buyer wallet ready`; keep `Disconnect wallet` adjacent. The authenticated EOA is a buyer identity, not automatically the ERC-8004 agent wallet or Altana wallet. |
| WALLET-11 | Disconnect wallet/session | Partial / gated | `disconnectWallet` clears browser authority, posts `POST /api/auth/logout`, and disconnects Wagmi. Confirm locally with a neutral/success toast; no server secret is shown. |
| WALLET-12 | Detect account/network change | Implemented guard / partial UX | `shouldInvalidateEoaAuthority` clears authority and logs out when account/network changes. Explain `Sign in again before continuing`; do not silently dispatch with the new account. |
| WALLET-13 | Recover wallet session on reload | Partial / gated | `GET /api/auth/session` is checked only for the connected matching address and chain. Show a short restoring state, then ready or sign-in-required. |
| WALLET-14 | See wallet/provider error | Partial | Keep the existing `Commerce action stopped` error for durable detail, with a toast for the immediate event. A provider error must not trigger a second transaction automatically. |
| WALLET-15 | Copy a public funding address | Dormant / not mounted | `PublicWalletFunding` exposes a read-only public address, `Copy address`, and a manual Ctrl/Cmd+C fallback, but no current route renders it. Reuse only when a real funding flow needs it; never show a private/session key. |

Existing auth endpoints:

- `POST /api/auth/siwe/challenge` — body `{ address, chainId }`; server-created canonical challenge.
- `POST /api/auth/siwe/verify` — signed canonical SIWE payload; returns bounded HttpOnly session metadata.
- `GET /api/auth/session` — matching session status/address/chain/expiry.
- `POST /api/auth/logout` — revokes/clears the session cookie.
- Creator passkey auth uses `POST /api/auth/passkey/challenge` and `POST /api/auth/passkey/assertion`; see Creator below.

## 5. Hire, quote, and ERC-8183 lifecycle

The supported product story is: select agent → describe desired result → inspect server quote → explicitly fund escrow → wait for provider result → inspect exact evidence → approve/settle or dispute → optionally review. The buyer never supplies provider/contract/actor/authority fields; those come from the server and pinned standards lock.

### Buyer-visible actions

| ID | User action or state | Status | Existing grounding and required UX |
| --- | --- | --- | --- |
| HIRE-01 | See activation gate | Partial / gated | `ActivationPanel` is present on cards/detail but `CommerceJourney` exits with a disabled note when `activation.enabled` is false. Keep a truthful “Why unavailable / inspect read-only detail” path. |
| HIRE-02 | Describe task/result | Implemented in gated flow | Textarea `task`, max 4,096 characters. Validate inline and explain that the server resolves price/provider/identity/terms from the current listing. |
| HIRE-03 | Request server quote | Implemented in gated flow | `POST /api/commerce/quote` with `{ agentIdentifier, task }`. Show busy/error and persist the validated quote snapshot in browser storage for reload recovery. |
| HIRE-04 | Inspect quote | Implemented in gated flow | Show exact task, price atomic units/token, provider address, chain, service URL/protocol, quote issue/expiry, identity/version, contract/token fields, and task digest as appropriate. Use compact public values and a clear expiration warning. |
| HIRE-05 | Confirm exact quote | Implemented in gated flow | Checkbox `I reviewed this exact task and quote` gates `Prepare explicit funding`. This is buyer intent, not wallet confirmation. |
| HIRE-06 | Request fresh quote | Implemented in gated flow | Clears the stored draft quote and returns to task entry. Keep the prior expired quote out of the active action. |
| HIRE-07 | Prepare hire intent | Implemented in gated flow | `POST /api/commerce/hire` with idempotency key and server-created `commerceJobId`; returns public operation, job read, and browser dispatch. Show `Funding prepared; review wallet call`. |
| HIRE-08 | Review wallet call before funding | Implemented in gated flow | Server returns exact public `to`, `data`, `valueAtomic`, chain, actor, provider, budget, and step. UI must never let users edit calldata or replace actor/provider. |
| HIRE-09 | Confirm sequential wallet transaction(s) | Partial / gated | `dispatchBrowser` claims and sends each EOA step with `walletClient.sendTransaction`; dispatch step can be `create`, `register`, `set_budget`, `approve`, `fund`, `settle`, `dispute`, or `claim_refund`. Use one visible stepper and per-step state. |
| HIRE-10 | Reject a wallet request | Partial / gated | Only an explicit wallet rejection releases the pre-send claim via `POST /api/commerce/dispatch` with `{ operationId, walletRejected: true }`. Say `Transaction canceled; no new funding was sent` only for this known case. |
| HIRE-11 | Handle provider error after claim | Partial / gated | Non-rejection failures leave the operation unknown until recovery; never offer a blind resend. Preserve the durable operation and show the recovery CTA. |
| HIRE-12 | See transaction submitted | Partial / gated | Public hash is persisted to local storage and `POST /api/commerce/dispatch` attaches it. Show hash/step and `Waiting for network confirmation`; this is not final success. |
| HIRE-13 | See receipt mined and operation-specific confirmation | Partial / gated | `publicClient.waitForTransactionReceipt` waits, then the server validates the operation-specific event/job state. Show `Confirmed` only after the server response, not merely after a generic receipt. |
| HIRE-14 | See reverted transaction | Partial / gated | Show danger state, public hash if present, safe failure code/message, and `Reconcile`/support next action. Do not retry automatically. |
| HIRE-15 | See unknown outcome | Implemented guard / partial UX | Operation state `unknown` or `manual_review` shows that it will not be resent. Offer `Reload status` and optional public hash input followed by `Attach and reconcile`. |
| HIRE-16 | Reload/resume an operation | Implemented in gated flow | Operation ID is stored under a canonical identity key; `GET /api/commerce/operation/[operationId]` reloads operation/job/dispatch, with 4-second polling while pending. Keep the identity key out of user-facing copy unless useful for support. |
| HIRE-17 | Attach a public transaction hash | Implemented in gated flow | Validate a 32-byte `0x...` hash and `POST /api/commerce/dispatch` with operation ID/hash/calls ID. Never accept private credentials or arbitrary payloads. |
| HIRE-18 | Inspect provider result | Partial / gated | When a confirmed submission exists, show protocol job ID, local SHA-256, on-chain Keccak, submission/settlement receipts, exact manifest text, and verified Greenfield run bundle when available. The buyer must understand which digest is which. |
| HIRE-19 | Approve and settle | Partial / gated | For submitted job with result, `POST /api/commerce/[jobId]/approve-or-dispute` with `action: approve` and the exact local result digest. The returned dispatch may require further wallet signing; never label “settled” before its final operation response. |
| HIRE-20 | Dispute a result | Partial / gated | Same endpoint with `action: dispute` and no result digest. Explain the outcome and preserve the submitted evidence; dispute is not a silent delete. |
| HIRE-21 | Claim expiry refund | Partial / gated | When funded/submitted and `expiresAtUnix` has passed, `POST /api/commerce/[jobId]/refund` prepares the pinned refund call. Show expiry time and that the buyer must still sign. |
| HIRE-22 | See terminal result | Partial / gated | Map completed/rejected/expired states to clear copy, receipts, and next actions. Keep rejected/disputed/refunded distinct from successful completion. |
| HIRE-23 | Leave verified-purchase review | Partial / gated | After completed job, score 1–5 and optional comment (max 2,000), then `POST /api/commerce/review/[commerceJobId]`. Show saved/replayed/error. Only one active review per confirmed job is valid. |
| HIRE-24 | Provider submits result | Backend/evidence-only | `POST /api/commerce/[jobId]/submit` is a provider/composition path, not a buyer CTA. Do not expose a “Submit result” button to the buyer. |
| HIRE-25 | Server/operator settlement/reconciliation | Backend/evidence-only | `POST /api/commerce/[jobId]/settle` and `POST /api/commerce/reconcile/[operationId]` exist for the composition/recovery seam. The UI may offer `Reconcile` where safe, but must not expose arbitrary operation IDs or allow blind retries. |

### Commerce API map

| Endpoint | Method/body | UI ownership |
| --- | --- | --- |
| `/api/commerce/quote` | `POST { agentIdentifier, task }` | Buyer requests quote. |
| `/api/commerce/hire` | `POST { idempotencyKey, commerceJobId[, deadlineSeconds] }` | Buyer prepares funding. |
| `/api/commerce/dispatch` | `POST` operation ID plus `claim`, `walletRejected`, or public `transactionHash`/`callsId` | Browser claims, records wallet evidence, releases explicit rejection, and recovers. |
| `/api/commerce/operation/[operationId]` | `GET` | Buyer reload/poll by known operation. |
| `/api/commerce/[jobId]` | `GET` | Read a known ERC-8183 job. |
| `/api/commerce/[jobId]/approve-or-dispute` | `POST { idempotencyKey, action, resultDigest? }` | Buyer decision; approve requires exact local digest. |
| `/api/commerce/[jobId]/refund` | `POST { idempotencyKey }` | Buyer expiry refund preparation/signing. |
| `/api/commerce/review/[commerceJobId]` | `POST { idempotencyKey, score, comment }` | Buyer verified-purchase review. |
| `/api/commerce/[jobId]/submit` | `POST provider result contract` | Provider/backend only; not a buyer action. |
| `/api/commerce/[jobId]/settle` | `POST { idempotencyKey }` | Composition/backend settlement seam; buyer reaches it through explicit decision/dispatch. |
| `/api/commerce/reconcile/[operationId]` | `POST {}` | Recovery seam; use only as a clearly labelled reconciliation action. |

### Commerce state taxonomy

Keep these state families separate in the UI. They describe different records.

| Family | Exact current values | Recommended display |
| --- | --- | --- |
| Public browser operation | `awaiting_signature`, `submitted`, `confirmed`, `reverted`, `unknown`, `reconciled`, `manual_review` | Compact status chip plus step-specific copy. `unknown` and `manual_review` must be prominent warnings. |
| ERC-8183 job read | `open`, `funded`, `submitted`, `completed`, `rejected`, `expired` | Lifecycle stepper with terminal outcome. Do not call `open` “accepted”; it is created/open. |
| Application reservation/internal status | `draft`, `negotiating`, `funded`, `accepted`, `submitted`, `completed`, `rejected`, `disputed`, `settled`, `cancelled` | Keep internal mapping behind the API. If shown, label as application reservation status, not protocol state. |
| Action response | `prepared`, `pending`, `confirmed`, `replayed`, `approved`, `reconciled` | Toast/panel event result; a `prepared` response still needs wallet confirmation. |
| Submission | `confirmed` canonical event or null | “Result evidence available” only when canonical submission exists. |

## 6. Hired agents management and lifecycle states

### Current implementation truth

There is currently no `/hired`, `/jobs`, or `/activity` page and no API that lists all buyer jobs by authenticated wallet. `CommerceJourney` stores one operation ID and one quote snapshot in browser `localStorage` under a canonical identity key and can reload that known operation with `GET /api/commerce/operation/[operationId]`. A known protocol job can be read with `GET /api/commerce/[jobId]`. This is useful recovery for the detail journey, but it is not a durable cross-agent management view.

This is **Missing**, not a reason to fake a list. Astra should:

- keep the existing detail journey coherent and easy to resume;
- add a `Hired` navigation item only when a real list read seam is provided; and
- if the 20-hour sprint needs a management surface, implement a small, explicitly labelled local “Recent hire” tray only from known browser operation IDs, with clear “this device only” copy, without presenting it as the account’s complete history.

The follow-up backend seam is now implemented as read-only authenticated `GET /api/commerce/jobs?cursor=…&limit=…`. It returns at most 50 buyer-owned public summaries in deterministic newest-first order, including immutable agent identity/version, safe name/slug when available, application and canonical lifecycle states, price/token/network, timestamps, result/settlement/review availability, latest operation state, a safe next action, and an opaque next cursor. It rejects unauthenticated requests and unsupported query parameters; buyer identity never comes from the URL or body. Existing authorized detail reads remain independent.

### Required management actions once a list read exists

| ID | User action/state | Status | UX contract |
| --- | --- | --- | --- |
| MANAGE-01 | Open hired-agent management | UI missing / API implemented | Proposed route `/hired` or `/activity`; the authenticated list seam is ready, but do not ship the link until the route exists. |
| MANAGE-02 | See all current jobs grouped by agent | UI missing / API implemented | Consume `GET /api/commerce/jobs` with cursor pagination. Group by full identity/version, display agent name/slug as presentation only, and show job ID/status/last observed time. |
| MANAGE-03 | Filter jobs by active/completed/attention-needed | Missing | Filter only returned states; “attention needed” should include `unknown`, `manual_review`, `reverted`, expired pending recovery, and stale reload—not an invented quality score. |
| MANAGE-04 | Resume a pending hire | Partial | Deep-link to `/agents/[slug]` and restore known operation; current localStorage path works only when the operation key is known. |
| MANAGE-05 | Reload/reconcile operation | Partial | Reuse `GET /api/commerce/operation/[operationId]`, public hash attach, and reconciliation guard. Never display a “retry payment” shortcut for unknown. |
| MANAGE-06 | Inspect result/evidence | Partial | Deep-link to detail/result panel and show exact digests, receipts, Greenfield state, and historical version. A dedicated result route is not present. |
| MANAGE-07 | Approve or dispute submitted result | Partial | Reuse the buyer decision action and wallet stepper; keep action beside the exact submitted bytes/digest. |
| MANAGE-08 | Claim eligible refund | Partial | Show only when protocol expiry and persisted state allow it; keep expired, refunded, and rejected visibly distinct. |
| MANAGE-09 | Leave/update verified-purchase review | Partial | Current create-review action exists; update/read/edit route is not exposed in the web UI. Do not add editing without a contract. |
| MANAGE-10 | See agent unavailable after hire | Proposed | Keep the job history readable even if listing becomes stale/degraded; show current listing state separately from immutable job evidence. |
| MANAGE-11 | See no jobs | Missing | Empty state should explain that no hired jobs are available for this authenticated buyer, not that marketplace supply is empty. |
| MANAGE-12 | See list read error | Missing | Retryable error should offer retry; auth error should offer sign-in; no fixtures. |

### Management state labels

Use the following compact labels and supporting copy. Never flatten them into “active”/“done”.

| State | User-facing meaning | Allowed primary next action |
| --- | --- | --- |
| Quote draft / negotiating | Task and quote are being prepared; no escrow is funded. | Review quote, request fresh quote, or cancel draft. |
| Open / funding prepared | Server created the job/intent; buyer has not completed funding. | Review exact wallet call and sign. |
| Awaiting signature | A specific wallet step is ready. | Confirm in wallet or cancel/reject. |
| Submitted transaction | Hash exists; receipt/operation verification is pending. | Wait, reload, or reconcile; never resend automatically. |
| Funded | Escrow is funded and provider work is expected. | Watch progress; refund only after protocol expiry. |
| Provider result submitted | Canonical result evidence is available for buyer decision. | Inspect exact bytes, approve/settle, or dispute. |
| Completed / settled | Buyer approval and terminal settlement are confirmed. | Open receipt/evidence; leave one verified review. |
| Rejected / disputed | The result or job was rejected/disputed. | Read reason and evidence; follow protocol support path. |
| Expired | Protocol expiry occurred. | Claim refund if the pinned contract allows it. |
| Unknown | Outcome cannot safely be determined yet. | Reconcile/attach public hash; no retry. |
| Manual review | Automated verification stopped safely. | Follow the specific server next action; no blind wallet action. |
| Replayed | Server returned the prior idempotent result. | Continue from the returned durable state. |

## 7. Creator guided flow, Altana authority, and revoke

Creator is a separate custody path from marketplace browsing. The only current template is a bounded one-shot PancakeSwap swap on BSC testnet, not a general builder or grid strategy. Keep the flow as a calm wizard with visible review checkpoints.

### `/create` guided actions

| ID | User action/state | Status | Existing grounding and required UX |
| --- | --- | --- | --- |
| CREATE-01 | Open Creator setup | Implemented / gated | `/create` explains the bounded template, browser passkey, user-controlled Altana wallet, one-time secure handoff, and deployment condition. Keep this onboarding copy short and link advanced policy details. |
| CREATE-02 | Enter name | Implemented | Required, 3–80 chars. Validate inline. |
| CREATE-03 | Enter public slug | Implemented | Required, lowercase URL-safe pattern, 3–80 chars. Explain that slug is presentation; ERC-8004 identity remains the tuple. |
| CREATE-04 | Enter description | Implemented | Required, 20–500 chars. It becomes public metadata; warn users not to enter secrets/private task inputs. |
| CREATE-05 | Choose trading pair | Implemented | Only `tBNB → CAKE` or `tBNB → BUSD`; do not add arbitrary tokens. |
| CREATE-06 | Choose input amount | Implemented | Only `0.0001`, `0.0005`, or `0.001 tBNB` (maximum). Show unit and testnet context. |
| CREATE-07 | Choose max slippage | Implemented | Only `0.10%`, `0.25%`, `0.50%` (maximum). |
| CREATE-08 | Choose quote freshness | Implemented | Only 30 or 60 seconds. |
| CREATE-09 | Choose swap deadline | Implemented | Only 60 or 120 seconds. |
| CREATE-10 | Consent to publish | Implemented | Required checkbox. Explain which public metadata is published; do not promise Greenfield unless evidence is verified. |
| CREATE-11 | Prepare with a new passkey | Implemented / gated | `createCreatorPasskeyWallet` obtains a user-controlled browser wallet, then `POST /api/creator/authority/options` returns the server-locked policy. Show passkey prompt pending/confirmed/rejected/error. |
| CREATE-12 | Recover existing passkey | Implemented / gated | `recoverCreatorPasskeyWallet` on chain 97; show wallet mismatch/unsupported browser safely. |
| CREATE-13 | Review exact authority | Implemented | Review displays wallet, chain 97, exact call count/targets/selectors/max native value, spend cap, expiry, and policy digest. Preserve this as a readable summary with an advanced disclosure for raw values. |
| CREATE-14 | Approve exact authority | Implemented / gated | Checkbox gates `Approve authority and save draft`; Altana SDK grant uses passkey. This is a destructive/high-trust moment; provide explicit user choice. |
| CREATE-15 | Cancel authority review | Implemented | Clears review panel without creating draft/authority. |
| CREATE-16 | Persist draft and public authority | Implemented / gated | `POST /api/creator/drafts`, then `POST /api/creator/drafts/[draftId]/authority`; only public metadata is persisted. Show draft/authority IDs only as copyable support details. |
| CREATE-17 | Authenticate Creator passkey | Implemented / gated | `authenticateCreatorPasskey` uses `GET /api/auth/session`, then passkey challenge/assertion endpoints when needed. Show a separate passkey-auth step; do not call it WalletConnect sign-in. |
| CREATE-18 | One-time runtime handoff | Implemented / gated | `POST /api/creator/drafts/[draftId]/authority/handoff` is attempted once; raw session private key is memory-only and must never appear in UI/toast/log/storage. Show pending, confirmed, failed, and “revoke before fresh grant” states. |
| CREATE-19 | Queue deployment | Partial / gated | `POST /api/creator/drafts/[draftId]/deploy`; can return Studio unavailable/blocked or queued. Show the source-of-truth persisted deployment state, not optimistic success. |
| CREATE-20 | Revoke browser grant | Implemented / gated | Passkey `revokeCreatorSession` must confirm, then `POST /api/creator/authorities/[authorityId]/browser-revoke` records public status. Make revoke easy to find; no new grant until the prior failed handoff is revoked. |
| CREATE-21 | See authority after grant | Implemented / evidence-only | Show wallet, public session key compactly, authority ID/status/expiry/policy digest; never show signer private material or serialized runtime session. |
| CREATE-22 | See handoff/deployment unknown | Partial | Copy must say whether authority exists, whether handoff completed, and where to check dashboard. Never create a second authority automatically. |
| CREATE-23 | See Creator error | Implemented | `CreatorForm` uses `role=status`; API errors use safe messages. Keep inline field errors and a durable summary. |

Creator API seams used by the current components:

- `POST /api/creator/authority/options` — server-locked policy options; no arbitrary user contract/token/expiry input.
- `POST /api/creator/drafts` and `GET /api/creator/drafts` — create/list drafts for authenticated Creator identity.
- `POST /api/creator/drafts/[draftId]/authority` — persist confirmed public authority metadata.
- `POST /api/creator/drafts/[draftId]/authority/handoff` — one authenticated runtime handoff; private session key accepted only at this narrow boundary and never returned.
- `POST /api/creator/drafts/[draftId]/deploy` — queue deployment if Studio is ready and runtime authority exists.
- `GET /api/creator/authorities/[authorityId]` — public authority status/runtime readiness.
- `POST /api/creator/authorities/[authorityId]/browser-revoke` — record passkey-confirmed revoke.
- `DELETE /api/creator/authorities/[authorityId]` — server/runtime authority revoke seam; expose only if its semantics are explicitly approved for this browser flow.
- `GET /api/creator/deployments/[deploymentId]/erc8004/status` — durable public registration state.
- `POST /api/creator/deployments/[deploymentId]/erc8004/prepare`, `/record-result`, `/reconcile` — browser registration intent/result/recovery seams used by `creator-browser-grant.ts`; show mint/URI progress, not raw calldata.
- `POST /api/auth/passkey/challenge` and `/api/auth/passkey/assertion` — Creator passkey authentication.

### `/creator` dashboard actions and states

| ID | User action/state | Status | Existing grounding and required UX |
| --- | --- | --- | --- |
| CREATOR-01 | Load Creator drafts | Implemented / gated | `CreatorDashboard` calls `GET /api/creator/drafts`. Show loading, no drafts, auth-required, and temporary-unavailable states. |
| CREATOR-02 | Inspect draft/deployment state | Implemented / evidence-only | Show name, draft status, deployment state/current step, bounded configuration, configuration digest, and public authority state. Keep persisted state as source of truth. |
| CREATOR-03 | Read authority status | Implemented / gated | `GET /api/creator/authorities/[authorityId]`; show active/expired/revoked/none and runtime-ready vs handoff-pending. |
| CREATOR-04 | Revoke with passkey | Implemented / gated | Recover matching passkey, confirm on chain 97, record public transaction/status. Wrong passkey and failed persistence need explicit recovery copy. |
| CREATOR-05 | Queue deployment | Implemented / gated | Button disabled unless authority is active and no deployment state exists; show Studio readiness block vs queued. |
| CREATOR-06 | Register ERC-8004 identity | Partial / gated | Requires deployment ID; passkey-owned `registerCreatorErc8004Agent` drives mint/URI/reconciliation. Show `not_started`, `mint_intent`, `mint_pending`, `mint_confirmed`, `uri_intent`, `uri_pending`, `registered`, and `failed`. |
| CREATOR-07 | See registration pending/unknown | Partial | Show calls/transaction IDs and pending reason when public; offer reconcile, never duplicate mint. |
| CREATOR-08 | Open marketplace listing after registration | Missing/partial | The registration message says marketplace listing and paid-hire state remain separate. Link only when the G1 projection returns a real slug/identity; do not assume registration means listing. |
| CREATOR-09 | See deployment failure | Partial | Show safe reason code and exact persisted current step; offer retry only where worker contract permits and after reconciliation. |

Creator authority state labels: `none`, `active`, `expired`, `revoked`. Creator registration state labels: `not_started`, `mint_intent`, `mint_pending`, `mint_confirmed`, `uri_intent`, `uri_pending`, `registered`, `failed`. Deployment worker stages include `validate`, `authority_ready`, `studio_scaffold_package`, `deploy_reconcile`, `erc8004_register_reconcile`, `marketplace_publish`, `g2_funded_job_reconcile`, `g2_activation_reconcile`, and `completed`. Keep authority, deployment, registration, marketplace listing, and paid-hire state separate.

## 8. Greenfield evidence

Greenfield is a public evidence read surface, not a user-operated storage console in this MVP.

| ID | User action/state | Status | Existing grounding and required UX |
| --- | --- | --- | --- |
| GF-01 | See evidence availability | Implemented / evidence-only | Detail `Evidence availability` section shows verified/pending/failed/unavailable summary, IPFS, Greenfield profile URI/locator, and last verification. |
| GF-02 | Open verified profile JSON | Implemented / evidence-only | Safe HTTPS link only when artifact status is `verified`; no link for pending/failed/unavailable. Open in a new tab with a clear external-link label. |
| GF-03 | Inspect versioned profile | Implemented / evidence-only | Show artifact type, version/current version, historical snapshot label, status, digest, size, provider, locator, seal state, and verification time. |
| GF-04 | Inspect completed-job run bundle | Implemented / evidence-only | Show bound commerce job ID, version, status, Greenfield seal/read URL, locator, and reason. Link only after readback/hash verification. |
| GF-05 | Understand seal semantics | Implemented / evidence-only | Use `Seal confirmed; transaction hash unavailable.` when the provider confirms seal but no transaction hash is available. Never invent a transaction hash or claim payload is in BSC calldata. |
| GF-06 | See pending publication | Implemented / evidence-only | Show pending status and no public link; browsing/hiring remains usable. |
| GF-07 | See failed publication | Implemented / evidence-only | Show failed reason and no link; do not block marketplace browsing/hiring. |
| GF-08 | Retry publication | Missing in browser | Publication/retry is a bounded evidence worker concern. Do not add a browser retry button without an approved API/idempotency contract. |

## 9. Loading, empty, degraded, error, and recovery states

Every route and high-trust action needs an understandable state. Use the existing primitives (`LoadingState`, `EmptyState`, `Callout`, `StatusBadge`, `role=status`, and `role=alert`) and add toast announcements as a transient supplement, not as the only record.

| State family | Existing implementation | Required UI behavior |
| --- | --- | --- |
| Initial route loading | `apps/web/app/loading.tsx` and page Suspense fallbacks | Keep layout stable, announce a specific operation, and avoid flashing fake cards. |
| Marketplace loading preview | `MarketplaceExplorer` `response.status === "loading"` | Show “Preparing marketplace controls” or response notice; filters should not look applied until the read response returns. |
| Marketplace empty | `EmptyState` in `MarketplaceExplorer` | Distinguish no filter match from empty source; offer wider filters/API connection guidance. |
| Marketplace degraded | Warning `Callout` plus `dataProvenance` mode | Keep browse accessible but mark all fields as inspection-only; do not show a green live badge. |
| Marketplace error | Error code/retryable/nextAction | Offer retry only when retryable; otherwise show configuration/read-model next action. |
| Detail empty/not found | `notFound()` or `EmptyState` | Link back to marketplace; no fixture fallback in production. |
| Detail degraded | Warning plus usable `AgentDetailView` | Keep the detail readable while clearly separating degraded source from live proof. |
| Route error | `apps/web/app/error.tsx` | `Try again` invokes route reset; `Back to marketplace` is always available. |
| Invalid category | `notFound()` from category page | Explain valid category navigation through marketplace; do not render arbitrary slug content. |
| WalletConnect unavailable | Inline copy in `CommerceJourney` | Keep browse/detail read-only; disable wallet action with reason. |
| Wallet/provider pending | Button busy state plus toast | Keep the user from duplicate clicks but do not hide the current step. |
| User rejection | Neutral/cancelled toast and actionable panel | Do not treat explicit rejection as unknown transaction; do not punish the user or retry. |
| Unknown transaction | Warning toast + durable recovery panel | Say “Do not resend”; show operation ID/public hash field and reconcile path. |
| API mutation error | Existing `Commerce action stopped` / Creator message | Preserve safe message and next action; use error tone, no raw server stack. |
| Creator loading | Dashboard text `Loading persisted Creator drafts…` | Use consistent skeleton/loading pattern; state whether data is authenticated. |
| Creator no drafts | `No Creator drafts yet.` | Offer `Create a bounded one-shot swap agent`; do not call this marketplace empty. |
| Creator authority failed | `CreatorForm` message | Explain whether no authority was created, an authority exists and must be revoked, or handoff/deployment is unknown. |
| Greenfield pending/failed | Artifact status and reason | Keep no-link state explicit; do not block unrelated browse/hire actions. |
| Hired hub missing | No current route; authenticated list API is implemented | Build the route against `GET /api/commerce/jobs` before showing its navigation item. |

## Toast and state-notification matrix

Toast notifications should be short, specific, accessible (`role=status` for progress/success, `role=alert` for danger), and paired with a durable inline status for any operation that can outlive the current screen. Toasts must be deduplicated by operation ID/step and should not include secrets.

| Event key | Trigger/source | Tone | Suggested message | Persistence / action |
| --- | --- | --- | --- | --- |
| `wallet.connect.requested` | Connect button pressed; `connectionPending` true | Info | `Opening WalletConnect… Approve the connection in your wallet.` | Dismiss on result; keep button busy. |
| `wallet.connected` | Wagmi reports connected address | Success | `Wallet connected · 0x1234…abcd` | Inline wallet status; next action is sign in or switch chain. |
| `wallet.connect.rejected` | User rejects/closes connection | Neutral | `Wallet connection canceled.` | Keep connect CTA available. |
| `wallet.connect.failed` | Connector/provider error | Danger | `WalletConnect could not connect. Try again.` | Inline safe error; retry only by user. |
| `wallet.connector_unavailable` | No configured project ID/connector | Warning | `WalletConnect is unavailable in this preview.` | Durable disabled copy; browsing remains enabled. |
| `wallet.wrong_chain` | Connected `chainId !== 97` | Warning | `Switch to BNB Smart Chain testnet (97) to continue.` | Durable CTA `Switch to BNB testnet`. |
| `wallet.switch.requested` | `switchChainAsync` called; `switchPending` true | Info | `Requesting BNB Smart Chain testnet in your wallet…` | Keep switch button busy. |
| `wallet.switch.confirmed` | Wagmi reports chain 97 | Success | `Network switched to BNB Smart Chain testnet.` | Show next step `Sign in with wallet` when needed. |
| `wallet.switch.rejected` | User rejects switch | Neutral | `Network switch canceled.` | Keep current-chain warning and switch CTA. |
| `wallet.switch.failed` | Switch error/unsupported wallet | Danger | `Could not switch networks. Select BNB Smart Chain testnet in your wallet, then retry.` | Durable current-chain warning; no transaction sent. |
| `auth.siwe.requested` | Challenge received; `signPending` true | Info | `Sign the SIWE message in your wallet to authenticate.` | Keep sign-in step pending; no payment implication. |
| `auth.siwe.confirmed` | Verify endpoint returns authenticated session | Success | `Wallet sign-in confirmed.` | Inline authenticated wallet state; enables quote request. |
| `auth.siwe.rejected` | User rejects signature | Neutral | `Wallet sign-in canceled.` | Keep sign-in CTA; no transaction was sent. |
| `auth.siwe.failed` | Challenge/verify rejects or expires | Danger | `Wallet sign-in could not be completed. Sign in again.` | Durable safe error; never show signature. |
| `auth.session.restored` | Matching `GET /api/auth/session` on reload | Success/info | `Wallet session restored.` | Inline wallet status; no new signature. |
| `auth.session.invalidated` | Account/network mismatch or logout | Warning | `Wallet account or network changed. Sign in again before continuing.` | Clear authority and block mutation. |
| `wallet.disconnected` | Disconnect button/session logout | Info | `Wallet disconnected.` | Return to connect state; clear local browser authority. |
| `quote.requested` | Quote submit begins | Info | `Preparing a server quote…` | Keep task panel busy; no wallet request yet. |
| `quote.ready` | `POST /api/commerce/quote` succeeds | Success | `Quote ready. Review the task, price, provider, and expiry.` | Durable quote panel with exact confirmation checkbox. |
| `quote.expired` | Client/server detects quote expiry | Warning | `This quote expired. Request a fresh quote before funding.` | Clear active funding CTA; offer fresh quote. |
| `quote.failed` | Quote API error | Danger | `The quote could not be prepared.` | Keep safe API message/next action inline; user retries. |
| `hire.intent.prepared` | `POST /api/commerce/hire` succeeds | Info | `Funding prepared. Review the wallet call before signing.` | Durable operation step; next is wallet confirmation. |
| `tx.wallet_confirmation.requested` | `sendTransaction` about to prompt | Info | `Confirm the <step> transaction in your wallet.` | Durable per-step stepper; no success yet. |
| `tx.wallet_confirmation.rejected` | Explicit user rejection (`4001`/known rejected error) | Neutral | `Transaction canceled. No new wallet call will be sent.` | Claim release may be recorded; keep operation resume path. |
| `tx.wallet_confirmation.failed` | Non-rejection wallet error before hash | Danger/warning | `Wallet request failed. The operation is held for reconciliation; do not resend.` | Durable unknown/operation state; no automatic retry. |
| `tx.submitted` | Public hash returned and attached | Info | `Transaction submitted · 0x1234…abcd. Waiting for confirmation…` | Durable hash/step; polling/reconcile action. |
| `tx.mined` | `waitForTransactionReceipt` returns | Info | `Transaction mined. Verifying the ERC-8183 operation…` | Do not call complete until operation-specific server check. |
| `tx.confirmed` | Server marks operation/job confirmed | Success | `<Step> confirmed on BNB Smart Chain testnet.` | Durable receipt and next dispatch/job step. |
| `tx.failed` | Receipt reverted or server validates failure | Danger | `The <step> transaction failed. Review the failure and reconcile before retrying.` | Show public hash/failure code; no blind retry. |
| `tx.unknown` | Timeout, missing hash, ambiguous provider/operation | Warning | `Transaction outcome is unknown. Do not resend.` | Keep recovery panel; attach hash/reconcile/reload only. |
| `tx.reconciled` | Reconciliation proves current operation state | Success | `Operation reconciled. The current job state is now authoritative.` | Update stepper; remove stale recovery prompt. |
| `tx.manual_review` | Safety check cannot prove expected state | Warning | `This operation needs manual review. No new transaction was sent.` | Durable nextAction from server; no resend. |
| `job.open` | Job created/open after hire setup | Info | `Job created. Funding is ready for your confirmation.` | Show job ID/terms; next wallet step. |
| `job.funded` | Funding operation reconciled | Success/info | `Escrow funded. The agent can now work on your task.` | Show expiry/deadline and progress state. |
| `job.submitted` | Canonical provider result observed | Info | `Result received. Inspect the exact evidence before deciding.` | Show result digest/manifest and approve/dispute. |
| `job.completed` | Buyer approval + terminal completion | Success | `Job completed and settlement confirmed.` | Show receipts/Greenfield evidence; offer review. |
| `job.rejected` | Protocol rejection/dispute terminal state | Warning | `This job was rejected. Review the recorded result and reason.` | Keep evidence; no completion count/review. |
| `job.expired` | Protocol expiry/reconciled refund eligibility | Warning | `Job expired without a completed result.` | Offer `Claim refund` only if allowed. |
| `job.refund.prepared` | Refund API prepares dispatch | Info | `Refund prepared. Confirm the refund in your wallet.` | Durable expiry state/stepper. |
| `job.refund.confirmed` | Refund operation reconciled | Success | `Refund confirmed for the expired job.` | Show refund receipt; terminal. |
| `job.review.saved` | Review API creates/replays review | Success | `Verified-purchase review saved for this completed job.` | Durable review state; one active review only. |
| `job.review.failed` | Review API rejects | Danger | `The review could not be saved.` | Keep completed job; offer user retry if safe. |
| `creator.passkey.requested` | New/recover passkey or assertion | Info | `Confirm the Creator passkey request in your browser.` | Keep form step busy; never show credential details. |
| `creator.passkey.confirmed` | SDK returns wallet/grant or auth endpoint succeeds | Success | `Creator passkey confirmed. Review the bounded authority.` | Durable review step. |
| `creator.authority.review` | Policy options returned | Info | `Review the exact calls, spend cap, and expiry before approving.` | Inline policy; approval checkbox. |
| `creator.authority.granted` | Altana grant returns confirmed | Success | `Bounded Creator authority granted for the reviewed policy.` | Show public authority metadata; next one-time handoff. |
| `creator.authority.rejected` | User rejects passkey grant | Neutral | `Creator authority approval canceled.` | No authority created (unless server says otherwise); retry review. |
| `creator.handoff.requested` | One-time runtime handoff starts | Info | `Handing off the bounded runtime session securely…` | No secret in UI; keep step pending. |
| `creator.handoff.confirmed` | Handoff endpoint confirms | Success | `Creator authority handed off. Deployment status is now persisted.` | Next queue/deployment step. |
| `creator.handoff.failed` | Handoff fails after authority exists | Danger | `Authority exists, but the one-time handoff failed. Revoke it before starting a new grant.` | Durable revoke CTA; never auto-create another authority. |
| `creator.deployment.queued` | Deploy API returns 202 | Info | `Deployment queued. The Creator dashboard will report progress.` | Link dashboard; poll only via existing list/read seam. |
| `creator.deployment.blocked` | Studio readiness or authority gate blocks | Warning | `Deployment is blocked until the required Studio/runtime condition is ready.` | Show safe reason and dashboard/readiness path. |
| `creator.deployment.failed` | Worker/deployment error | Danger | `Deployment stopped at <step>. Review the persisted reason before retrying.` | Reconcile-first recovery. |
| `creator.registration.pending` | Mint/URI intent or pending result | Info | `ERC-8004 registration is pending finalized confirmation.` | Show phase and public operation/tx reference. |
| `creator.registration.confirmed` | Mint/URI finalized and read | Success | `ERC-8004 identity confirmed. Marketplace listing remains a separate step.` | Link only to real listing when projection exists. |
| `creator.registration.failed` | Registration failure | Danger | `ERC-8004 registration failed or needs reconciliation.` | Show safe reason; no duplicate mint. |
| `creator.authority.revoked` | Passkey revoke + public status record | Success | `Creator authority revoked. The next delegated write will be denied.` | Durable revoked state; new grant requires deliberate start. |
| `evidence.verified` | Greenfield profile/run bundle readback/hash verified | Success | `Public evidence verified and linked.` | Show safe link, version, digest, seal/readback metadata. |
| `evidence.pending` | Upload/seal/readback pending | Info | `Public evidence is still being verified. No link is shown yet.` | Durable pending state; no browser retry without API. |
| `evidence.failed` | Hash/seal/readback verification fails | Danger | `Public evidence could not be verified. Browsing and hiring remain available.` | Show reason, no link. |

## 20-hour MVP implementation priorities for Astra

The visual redesign should not consume the remaining submission window with a broad refactor. Implement in this order:

1. Establish a cohesive shell/nav/typography/status language across existing routes without changing read contracts.
2. Make marketplace browse/category/detail/compare the polished public path: filter hierarchy, card scanability, detail information order, mobile behavior, empty/degraded/error recovery.
3. Improve the existing gated commerce panel and step/toast states. Keep activation disabled where the environment says so; use the local canary only when its flags are explicitly enabled.
4. Make `/create` and `/creator` a clear bounded wizard/dashboard with authority/revoke states and no secret leakage.
5. Add Greenfield evidence presentation refinements and safe external-link treatment.
6. Add a shared accessible toast/status primitive and wire only the existing state transitions in the matrix above.
7. Build the hired-agent hub against the implemented authenticated buyer-scoped `GET /api/commerce/jobs`; do not substitute browser localStorage for account history.

### Definition of done for the redesign handoff

- Every existing route has a clear “where am I / what is here / where can I go / how do I get out” path.
- Browse filters map directly to the current URL/query contract and preserve category context.
- Cards, comparison, and detail use the same labels for identity, provenance, six axes, freshness, health, reputation, jobs, pricing, authority, and evidence.
- WalletConnect/SIWE and transaction notifications distinguish request, user confirmation, submission, mining, operation-specific confirmation, rejection, unknown, and reconciliation.
- Buyer actions remain explicit: no blind retry, auto-settlement, fabricated metrics, or hidden network switch.
- Creator review shows exact calls/spend/expiry and keeps revoke accessible; runtime secret material never appears.
- Greenfield links are exposed only for verified artifacts, with historical and seal semantics preserved.
- Loading, empty, degraded, error, unavailable, stale, rejected, and recovery states are designed and keyboard/screen-reader reachable.
- Any newly proposed route or API is marked in the implementation PR as missing/blocked rather than silently treated as existing.
