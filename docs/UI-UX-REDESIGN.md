# BNBEra marketplace UI/UX redesign

Implementation brief · 2026-09-08 · Astra low · base `5632782` (PR #36).

This brief turns [UI-UX-ACTION-INVENTORY.md](UI-UX-ACTION-INVENTORY.md) into one cohesive product. That inventory remains the exhaustive action/state contract; IDs below identify coverage. The user explicitly requested this redesign after the sprint plan: replace its blanket visual-redesign deferral with the bounded P0 work here, while retaining its 20-hour implementation freeze and four-hour submission reserve. This document proposes presentation and two small read seams; it does not enable releases or claim new gate acceptance.

## Product direction and navigation

Make the first screen useful immediately: real agents, a clear category choice, and a search field. The experience should feel calm, precise and approachable. Keep BNBEra's dark violet identity, reduce decorative glow, and give content more room. A user should understand what an agent does before seeing protocol internals.

Use one shared header: brand links to `/`; `Marketplace` → `/marketplace`; `Hired agents` → `/hired` only after the list seam below ships; `My agents` → `/creator`; a quiet primary `Create agent` → `/create`. Compare belongs in the selection tray and detail actions, not as an empty primary destination. Mark the active destination with `aria-current`. Mobile navigation wraps into a second visible row; no new hamburger/dialog implementation is needed.

Keep wallet controls inside the hire flow for P0: the current provider is journey-scoped. Show network and wallet alongside the transaction they authorize. Creator explicitly says `Creator passkey` and `Execution authority`, preventing confusion with the buyer wallet. A global wallet widget would require shared provider/session ownership and is P1, not decorative header work.

Replace obsolete static W0/W1 and blanket “all rails disabled” copy in home/header/footer. Use `BNB Chain agent marketplace` globally and actual per-listing/runtime availability at each action. Public browse can contain mainnet and testnet records; do not label the entire marketplace chain 97. Keep testnet prominent on a chain-97 hire or Creator flow. Put source mode beside the actual data and release limitations beside affected actions.

## Home, browsing and comparison — HOME, BROWSE, CMP

Home `/` uses the same server read seam as marketplace, with at most six returned eligible agents. Heading: `Find an agent for your next task.` Supporting sentence: `Explore capabilities, inspect evidence, and hire when available.` Search submits to `/marketplace?q=…`; category chips link to the existing four routes. Follow with `Explore agents` and the real card grid, `Browse all agents`, then a compact Creator invitation. Remove illustrative fixture artwork and engineering gate cards from the hero.

Do not call the home selection “top”, “recommended”, or “featured” without a supported selection rationale. Default to the existing relevance order and label it simply `Explore agents`. Never pad a short response. Empty source shows `No agents are available to display yet`; a failed read shows retry/back-to-browse; fixture/degraded modes retain visible labels. Do not invent total market, category, trading-volume or success counters from a six-card sample.

Marketplace structure, in order:

1. Title and one-line introduction; source mode and observed freshness nearby.
2. Full-width labelled search. Use existing submit semantics and 120-character limit.
3. `All agents`, Rebalancing, Grid trading, Yield optimisation, Health factor category links. Explain each category in one sentence on its route. Unknown-category supply remains accessible in All agents; do not create an unsupported category URL.
4. Visible network and sort controls; `More filters` native disclosure containing origin, verification, runtime, freshness and protocol. Keep the existing query keys, options and server ranking. Label score sorting `Eligibility score`, never “best rated”. An advertised X402 service is not an enabled payment rail.
5. Applied-filter chips with remove controls, `Clear filters`, returned result count and grid. Preserve unrelated query state and category; explicit Clear filters resets filters, not compare selection. Mark pending reads without pretending draft filters are already applied. Announce the resulting count once.
6. Excluded candidates and technical source details in separate disclosures below eligible results. Contract version and retrieval mode belong here; source/degraded warnings remain visible above.

Cards use a stable five-part hierarchy: category + network; name + two-line purpose; advertised capability/protocol tags; last endpoint check + freshness + confirmed-job count/unknown; `View agent` and compare toggle. Three small, separately labelled reputation counts may follow in a compact evidence row. Keep the six axes available in a `Listing status` disclosure and full tuple in `Identity details`; no single “trusted” badge. Preserve current source labels, unknown price and unavailable activation explanation. Cards do not mount a full wallet journey: their action opens the detail's hire section if eligible.

Compare selection stays URL-backed, up to three slugs, with `aria-pressed`, visible selected names and remove actions. A sticky bottom tray appears only with selections and respects mobile safe-area padding. Comparison keeps identity/category, capability, price, health/freshness, three reputation sources, completed jobs, authority and evidence in that order. Full identity and six axes remain accessible. On narrow screens use a horizontally scrollable semantic table with a sticky row-header column and named scroll region; no crushed three-column text. Preserve partial/missing-record warnings and the read-only explanation.

## Agent detail — DETAIL, GF

Use a two-column desktop layout: flexible content and a 20–24rem action rail; below 64rem, place the action summary after the hero and the full journey in normal flow. No sticky full-height transaction form. One page with anchor navigation is faster and more discoverable than hidden data tabs. Anchors: `Overview`, `Capabilities`, `Live data`, `Track record`, `Identity & evidence`. All sections remain server-rendered and searchable.

| Order | Visible summary | Expandable detail and source |
| --- | --- | --- |
| Hero | Breadcrumbs, name, category, purpose, network, separate verification/runtime/freshness labels | Full identity tuple and current version; copy controls with full accessible values |
| Overview | What it does, suitable task, pricing availability, current availability, source/observation boundary | All six independent state axes, eligibility factors and exclusion reasons |
| Capabilities & services | Advertised skills, separately tested skills, service kind and last actual test | Input/output schemas; card URL versus invocation URL; protocol version, test source/time/latency. No raw endpoint “Run” action |
| Current data | Existing labelled values with units/source and available/stale/unavailable state | Observation/block details when provided. Stale data remains visibly stale and cannot imply execution readiness |
| Track record | Confirmed BNBEra completed jobs and latest settled result; observed endpoint reliability | Successful/attempted checks, actual observed span, monitoring horizon and coverage; missing periods unknown |
| Reputation | Three separate sections: BNBEra verified-job reviews; recognized reviewers; raw on-chain feedback | Reviewer, score/decimals/tags, source/time/block, revoked history, bound job/result/receipt. No combined star average |
| Identity & provenance | Origin, observed owner/agent wallet, finality status, first/last seen | Full tuple, registry, block/hash, source references, ingestion version and digest; never join by slug alone |
| Execution authority | Active/expired/revoked/none with scope and expiry | Public wallet/provider/spend/call policy. Discovery, ownership and claim are distinct from execution permission |
| Public artifacts | Profile and completed-job bundle as two labelled rows; verified/pending/failed/unavailable | Version/current version, historical label, bound job, hashes, size/provider/locator, verification time and honest seal state |

This order intentionally places purpose/capability before detailed state machinery while preserving every inventory field. The action rail shows price, network and `Hire agent`/`Resume hire`; when disabled, show a concise reason and useful next action rather than a dominant dead button. Comparison is secondary. Advanced hashes are collapsed by default but verification status, historical version and receipt availability remain visible.

Greenfield links appear only after verified readback, using existing safe HTTPS handling. `Historical snapshot · version 11` is a badge beside that artifact, never a claim about today's agent. A run bundle names its exact job/version. Keep `Seal confirmed; transaction hash unavailable.` when applicable. Pending/failed artifacts have explanatory text and no open/retry button. Storage availability does not gate browsing or hiring.

## Hire and hired-agent management — WALLET, HIRE, MANAGE

The unit of management is a job, not merely an agent: one agent may have multiple jobs, versions and outcomes. Display immutable hired identity/version alongside current listing availability. Use a five-stage journey: `Task → Quote → Fund escrow → Review result → Complete`. A persistent summary above it shows agent, job ID when known, amount/token, buyer, network and latest observed status. No percentage progress unless the backend supplies real progress.

Task entry retains the existing 4,096-character limit. A server quote shows the complete task, formatted amount and token, provider, chain, service, identity/version and expiry; exact atomic amount/contracts/digest remain inspectable. Explain gas separately from the escrow budget without estimating unsupported values. The existing exact-quote checkbox stays before funding preparation.

Wallet onboarding is a compact prerequisite strip: `Connect wallet` (WalletConnect) → `Switch to BNB testnet` if required → `Sign in with wallet`. Explain SIWE as gasless ownership proof. Connected is not authenticated; a switch request is not a confirmed switch. Account/network changes pause mutations and require matching authentication/reconciliation. Never silently rebind an old job to a new account or discard its recovery evidence.

Funding has five explicit substeps: `Create job`, `Register job`, `Set budget`, `Approve exact token amount`, `Fund escrow`. Explain upfront that separate wallet confirmations are required. Each row has awaiting-wallet/submitted/verifying/confirmed/failed state and an available public receipt link. Reveal the current call's recipient, amount and network before its wallet prompt; calldata is an advanced read-only detail. The actual job ID appears only after verified `JobCreated`. Do not replace these calls with a single misleading “Pay now” spinner.

| Canonical situation | Heading and next action |
| --- | --- |
| Quote draft or expired | `Review your quote` or `Quote expired`; request a new quote. Cancelling a draft does not cancel an on-chain job |
| Job open / funding incomplete | `Finish funding escrow`; current explicit wallet substep, with prior confirmed steps retained |
| Funded, no execution signal | `Escrow funded · awaiting the agent`; show deadline and last update. Do not invent provider acceptance or work progress |
| Actual provider work signal, if present | `Agent is working`; show only persisted signal/time. Protocol funded remains separately visible |
| Canonical submitted result | `Your result is ready`; structured readable result where the known schema permits, exact manifest disclosure, local SHA-256 and on-chain Keccak distinctly labelled |
| Submitted, settlement waiting period active | `Review period ends …`; server-derived eligibility/time, explicit review and dispute controls. Current documented canary has a 900-second dispute wait; do not hardcode it as universal policy |
| Eligible explicit approval | `Approve and settle`; exact result acknowledgement, then wallet dispatch and reconciliation. A recorded approval is not final settlement |
| Dispute | `Dispute result`; explain recorded consequence, no prior approval requirement, no promise of immediate refund |
| Completed with confirmed settlement | `Completed`; result/receipt, one verified-job review (1–5 and optional comment), saved state |
| Rejected/disputed | `Rejected`/`Disputed` from the correct state family; evidence/reason preserved, no successful-job count |
| Protocol expiry/refund eligible | `Refund available` only when allowed; explicit `Claim refund`, pending receipt then `Refund confirmed`. Expired alone is not refunded |
| Unknown/manual review/reverted | Prominent recovery panel with exact operation/step, public hash, last update, safe reason and server next action; `Reload status`/`Attach and reconcile`, never “retry payment” |

Rejecting the current wallet prompt does not undo prior setup transactions. Copy should say `This wallet request was canceled` and retain the already-confirmed steps. A generic provider error after claiming a send remains unknown. Reload resumes the persisted operation, not a freshly generated intent. Keep the current bounded polling and idempotency guards.

### Small missing seam: account-wide hired jobs

P0 target, bounded to a read-only addition: `/hired` backed by a **new, proposed** authenticated `GET /api/commerce/jobs?cursor=…&limit=…`. This endpoint does not exist at the base. It derives buyer/chain from the existing authenticated session; no client-supplied arbitrary wallet lookup. Reuse PostgreSQL and existing public job/operation serializers, with bounded pagination and deterministic ordering. Return job/reservation ID, exact agent identity/version, safe name/slug or unavailable-listing fallback, protocol job ID, quoted amount/token, canonical job status, latest public operation ID/status/step, updated/observed time, expiry, result availability, review state when actually available, and next cursor. Do not include raw task inputs, manifests or private data in list summaries by default. Existing detail reads enforce authorization independently.

Dashboard: heading `Hired agents`, authenticated buyer address, `All / Needs attention / In progress / Completed`; rows show agent, job, status, amount and last update, with `Resume`, `Review result` or `View receipt`. Group/filter only proven states. Attention includes wallet action, result review, recovery and eligible refund; completed requires canonical completion, not an internal “accepted” reservation. Counts cover the returned page unless the endpoint explicitly returns full counts. Empty/auth/error states are distinct.

A **new UI seam** accepts a known operation ID for resume, validates it through the existing authorized operation read, and binds it to that exact job before rendering `CommerceJourney`. P0 deep-link may be `/agents/[slug]?operation=<id>#hire`; if a listing is no longer readable, the hub must still expose the authorized persisted job/read panel without depending on current publication. Do not choose an arbitrary latest localStorage operation. No new payment mutation endpoint is required.

Timebox list + resume implementation to 90 minutes. If repository/auth shape makes that impossible, omit Hired navigation and ship a clearly labelled `Recent hire on this device` link only for the currently known recoverable operation. Mark account-wide management incomplete in the handoff. This fallback is usable recovery, not satisfaction of MANAGE-01/02.

## Guided Creator and My agents — CREATE, CREATOR

`/create` heading: `Create your first agent`. Intro: `Configure a bounded testnet swap agent. You control its execution permissions.` Show one real template tile, `One-shot swap`, with supported pairs and a plain example; no disabled grid of imaginary templates.

Use four labelled sections in one form with a current-step indicator and Back/Continue controls. Keep values in the mounted form; do not add browser storage for authority/session material.

1. **Describe:** name (3–80), slug (3–80 and existing pattern), public description (20–500). Inline errors and public-metadata guidance; required publication consent.
2. **Configure:** pair tBNB→CAKE/BUSD; amount 0.0001/0.0005/0.001 tBNB; slippage 0.10/0.25/0.50%; freshness 30/60s; deadline 60/120s. Use existing defaults and server validation. Put advanced timing in a disclosure; selected values appear in review. Addresses, router and caps stay locked.
3. **Review permissions:** create/recover Creator passkey; show exact wallet/network, pair/amount, allowed actions, spend cap and expiry returned by the server. Exact targets/selectors/policy digest are expandable. Existing approval checkbox gates `Approve authority and save draft`. Back/cancel before grant has no authority side effect.
4. **Deploy & publish:** show separate confirmed grant, secure handoff, queued/deployed, identity registration and marketplace publication states. A queue response is not deployed; registration is not listed. Link to My agents while waiting. If handoff fails after grant, keep a prominent revoke action and forbid silently creating another grant.

`/creator` is labelled `My agents`, with the existing authenticated draft list. Each card shows template/configuration summary, authority status/expiry, deployment stage, registration status and listing status as separate rows. Primary action is the next real step (authenticate, queue deployment, register/reconcile, or open real listing); `Revoke authority` remains visible near authority. Explain it stops future delegated writes, not deletion of identity/history or cancellation of already-submitted transactions. Confirm passkey revoke and persisted public status separately if recording fails.

Small optional read seam: resolve finalized created identity to a real marketplace slug via the existing read model, then show `View listing`; never infer it from the draft slug. Renewal/pause UI is P1 only if a reviewed lifecycle API exists; current browser controls do not justify inventing these mutations. Keep one active created agent per wallet, existing bounds and Studio readiness gates.

## Notifications and persistent status

The Apple directive informs immediate press feedback, clear hierarchy, restrained reversible transitions and accessible alternatives. P0 uses existing React/CSS and native disclosures, with no gesture system or animation dependency. See the complete requested [Apple design directive](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md).

Current official Reown guidance separates account/connection state from network state and exposes modal events for notifications. Map those concepts onto the repository's existing Wagmi `useAccount`, `useConnect`, `useSwitchChain` and disconnect flow; AppKit is not installed and should not be added for this redesign. Observe the resulting account/chain before announcing success. [Reown hooks](https://docs.reown.com/appkit/react/core/hooks).

Reown's transaction recipe uses separate signing and transaction calls and returns a transaction hash; that recipe alone does not establish confirmation. Retain the repository's viem receipt wait and server operation/event reconciliation. Never drive escrow success from a WalletConnect modal close or event toast. [Reown Wagmi recipe](https://docs.reown.com/appkit/recipes/wagmi-send-transaction).

Add one small web-level `ToastProvider`/`useToast` and viewport. Proposed interface: `notify({ id, tone, title, description?, action? })`, `dismiss(id)`; tone uses existing `StatusTone`. Mount once under the layout, independent of wallet providers. A stable ID includes operation ID + step (or draft/authority ID + phase); updates replace that toast. Max three visible, pending transitions update in place, repeat polling/replay/restoration does not reannounce old success. No notification backend or persistent toast log.

| Trigger | Toast | Persistent source of truth |
| --- | --- | --- |
| Connection/signature/switch requested | `Confirm in your wallet` with specific request | Prerequisite strip and busy control |
| Observed connection/chain or verified SIWE response | Specific connected/network/sign-in success | Address/network/auth strip; these remain separate |
| Wallet explicitly rejects | Neutral `Request canceled` | Current step ready only as server permits |
| Hash attached | `Transaction submitted` | Hash and current step, waiting for receipt |
| Receipt mined | Update same toast: `Verifying transaction` | Receipt is not final commerce proof |
| Server operation confirmed | `<Step> confirmed` | Reconciled step and canonical job state |
| Unknown or verification stopped | `Outcome unknown. Do not resend.` | Persistent recovery panel with next action |
| Account/network changes | `Wallet changed. Sign in again.` | Pause mutation and preserve old job binding |
| Result/settlement/review confirmed | `Result ready` / `Settlement confirmed` / `Review saved` | Result, receipt or saved review |
| Creator grant/handoff/deploy/revoke changes | Specific phase and confirmed/pending/failed outcome | Separate authority/deployment/publication rows |

Use the inventory's full notification matrix for other events, but initial data loads and ordinary navigation need no success toast. P0 transient success/info lasts about six seconds, pauses on hover/focus; warning/error remains until dismissed. Important status remains inline even after dismissal. One polite live announcer handles progress/success; urgent new failures use an alert once. Avoid duplicate announcements from the toast and inline panel. Dismiss does not cancel an operation; no toast action sends funds. Render only safe public references and safe error messages.

## Visual tokens, components and responsive behavior

Keep existing CSS variable names and shared components. Values below are a concrete starting palette, to be checked in the rendered UI; do not introduce a second theme framework.

| Token/use | Decision |
| --- | --- |
| Canvas / surface / elevated | `#0B0A10` / `#15131D` / `#211D2C`; solid content panels, fewer nested borders |
| Text / secondary | `#F5F3F8` / `#B5AFC0`; body 1rem/1.5 system-ui, optical sizing auto |
| Primary / hover / focus | Existing violet `#7C3AED` / `#6D28D9`; focus `#C4B5FD` 2px with offset; white primary-button text |
| Status | Keep existing success/warning/danger/info tones and explicit words/icons; violet means action/selection, not verification |
| Type | Hero clamp 2–3rem, 1.1 leading, -0.025em; section 1.5rem/1.25; card 1.125rem/1.3; metadata 0.8125rem/1.45. Avoid uppercase tiny badge paragraphs |
| Space / width | 0.25, 0.5, 0.75, 1, 1.5, 2, 3rem scale; page max 80rem; prose max 68ch; gaps 1–1.5rem |
| Shape | Controls 0.625rem, cards 1rem, floating surfaces 1.25rem; pills only for categories/status |
| Depth | Quiet card border, small shadow only on floating header/tray/toast; remove decorative glow and tilted illustrative cards |
| Motion | Immediate `:active` response, subtle ≤100ms button feedback, 120–180ms opacity/color for non-gesture UI; no staggered card entrances or fake progress |

Reuse `BrandMark`, `StatusBadge`, `DataModeBadge`, `StateAxisGrid`, `Callout`, `EmptyState`, `LoadingState`, `SectionHeading`. Make `DetailSection`, public-value copy/disclosure patterns and progress rows small presentational additions only where duplication warrants them. Do not rewrite domain/read-model packages to make layout easier.

Three card columns ≥64rem, two ≥40rem, one below; detail stacks below 64rem. At 320 CSS pixels there is no page-wide horizontal overflow; hashes wrap or scroll inside their labelled region. Touch controls target 44px; visible labels, not placeholder-only forms. Primary actions remain reachable at 200% text zoom. Native disclosures preserve keyboard behavior; route/step changes move focus to the relevant heading, validation to the first invalid field. Headers/trays must not cover focus or final actions.

Use one lightly translucent header/tray only where it overlaps content, with solid readable text. Reduced transparency gets solid backgrounds; increased contrast gets defined borders and near-solid surfaces; reduced motion removes transforms/sliding. Do not add sound, haptics, drag sheets or animated gradients for this sprint.

## Delivery cutline and two-worker batches

Coordinator owns integration and reviews each handoff before its dependent batch. Two Luna implementation workers maximum, isolated worktrees from the reviewed common base. Do not run overlapping CSS or layout ownership. This design document itself launches no workers.

| Batch / elapsed target | Luna A ownership | Luna B ownership | Review exit |
| --- | --- | --- | --- |
| 1 / first 90 min | `packages/ui/src/{styles.css,components.tsx,index.ts}`, `apps/web/app/{layout.tsx,globals.css,page.tsx}`, new toast provider; tokens, shell, real home | `marketplace-explorer.tsx`, `agent-card.tsx`, `compare-table.tsx`, `compare-toggle.tsx`; browse/card/compare JSX using agreed existing classes, no shared CSS edits | Home has real data; navigation/category/search work; toast API available. A receives B's scoped CSS requirements |
| 2 / by hour 4 | `agent-detail-view.tsx`, presentation helpers only as needed, shared CSS; ordered enrichment/Greenfield | `commerce-journey.tsx`, `activation-panel.tsx`, new commerce-local presentational helpers; wallet/step/toast/result UX, no auth/adapter rewrite | Public find→understand→hire path coherent; existing safety checks intact |
| 3 / by hour 6, while G2 acceptance proceeds | `creator-form.tsx`, `creator-dashboard.tsx`, create/creator page copy and scoped CSS | Bounded proposed jobs list contract/repository read/route plus `/hired` and resume UI; at most 90 min, read auth-boundary instructions first | Creator flow/revoke clear; hub has real buyer scoping or explicitly cut; coordinator adds Hired nav only after pass |
| 4 / remaining accepted sprint window | Blocking responsive/focus/contrast fixes in owned styles | Focused commerce/recovery regression fixes and browser evidence | Return to original deployment/evidence schedule; no feature creep |

P0 is home with real agents/category filtering, readable browse/compare/detail, one coherent gated hire lifecycle and recovery, core toasts, guided existing Creator, visible revoke, historical Greenfield links, and responsive/accessibility blockers. Account-wide Hired is a requested P0 target with the explicit seam/timebox above; report incomplete if cut. It must not consume the G2/deployment reserve.

P1: global wallet widget, richer dashboard grouping, additional result renderers, extra source-detail polish, Creator listing-link seam if not trivial, custom motion, theme toggle. Out of scope: new templates, arbitrary strategies, simulated progress/metrics, ratings aggregation, review editing without API, public storage console, new payment/connector/deployment framework, new release enablement, mainnet writes. No newly introduced paid resources.

## Acceptance and handoff

- Home and category filters show only real returned records or explicit fixture/degraded/empty states. Search/filter/back navigation preserves meaningful URL state; empty categories remain honest.
- Cards, compare and detail agree on identity/version, independent statuses, measured availability, three reputation sources, jobs and unknown price. A reviewer can find every enrichment/evidence field without reading an engineering essay.
- One eligible detail can enter the existing gated quote flow. Wallet connection, chain observation, SIWE, each signed transaction, receipt and server confirmation have distinct readable states. No changed payment authorization/retry semantics.
- Reload, duplicate action, rejected prompt, account/chain change, unknown outcome and expiry show safe next actions. Result review precedes explicit settlement; disputed/rejected/expired/refunded are distinct. Existing operation-specific tests remain green; real browser G2 acceptance is still required separately.
- If Hired ships, two authenticated buyers cannot read each other's jobs; pagination, empty/error/auth states and old-unlisted-agent resume work. Real DB/API read verification is required for that new seam. No mutation or raw private inputs in list responses.
- Creator selected configuration survives step navigation; server bounds remain authoritative; grant/handoff/deploy/register/listing are distinct; revoke is visible and errors do not silently create a second grant.
- Verified Greenfield links preserve exact version/job binding, historical label, digest and unavailable seal hash semantics; unavailable storage does not break other flows.
- Check 320px and desktop, keyboard-only, 200% zoom, reduced motion and contrast; no clipped primary action, focus trap or duplicate toast announcements. Use existing web tests/typecheck/lint and one relevant build; add focused tests only for changed safety/state behavior, not static typography.
- Handoff records task/gate, changed paths, commands/results, screenshots or browser evidence, real versus mocked evidence, remaining gaps, unchanged flags and base/head SHA. G2/public-preview acceptance cannot be inferred from this redesign or unit tests. Final four hours remain submission-only.
