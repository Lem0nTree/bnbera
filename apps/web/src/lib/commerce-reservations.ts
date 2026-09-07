import { randomUUID } from "node:crypto";
import { canonicalSha256Hex, erc8004IdentityKey, erc8004IdentitySchema, evmAddressSchema, type CommerceJobStatus, type Erc8004Identity } from "@bnbera/domain";
import {
  CommerceError,
  erc8183ProviderBindingSchema,
  type Erc8183OperationQueryPool,
  type Erc8183ProviderBinding,
  type EnabledErc8183DeploymentPin
} from "@bnbera/agent-commerce";
export {
  commerceQuoteRequestSchema,
  commerceQuoteResponse,
  commerceQuoteResponseSchema,
  commerceQuoteSnapshotSchema,
  type CommerceQuoteRequest,
  type CommerceQuoteResponse,
  type CommerceQuoteSnapshot
} from "./commerce-quote-contract";
import {
  commerceQuoteRequestSchema,
  commerceQuoteSnapshotSchema,
  type CommerceQuoteSnapshot
} from "./commerce-quote-contract";

type ListingRow = {
  readonly agent_id: string;
  readonly identity_id: string;
  readonly namespace: string;
  readonly chain_id: number;
  readonly identity_registry: string;
  readonly agent_identity_id: string;
  readonly agent_wallet: string | null;
  readonly identity_observed_block: number | string | null;
  readonly identity_read_consistency: string | null;
  readonly listing_status: string;
  readonly verification_status: string;
  readonly runtime_status: string;
  readonly authority_status: string;
  readonly execution_wallet: string | null;
  readonly agent_version_id: string;
  readonly agent_version: number;
  readonly pricing_manifest: unknown;
  readonly service_kind: "a2a" | "adapter";
  readonly service_url: string;
  readonly service_protocol_version: string;
  readonly service_observed_at: Date | string;
  readonly probe_observed_at: Date | string;
};

type ReservationRow = {
  readonly id: string;
  readonly erc8183_job_id: string;
  readonly buyer_user_id: string | null;
  readonly provider_agent_id: string;
  readonly quote: unknown;
  readonly price: string;
  readonly task_input_digest: string;
  readonly status: CommerceJobStatus;
  readonly funding_transaction_hash: string | null;
  readonly fulfillment_transaction_hash: string | null;
  readonly dispute_transaction_hash: string | null;
  readonly settlement_transaction_hash: string | null;
};

type ParsedPricing = {
  readonly priceAtomic: string;
  readonly tokenSymbol: string | null;
  readonly tokenAddress: string;
  readonly decimals: number;
  readonly network: number;
};

const listingSelect = `
  SELECT
    a.id AS agent_id,
    i.id AS identity_id,
    i.namespace,
    i.chain_id,
    i.identity_registry,
    i.agent_id AS agent_identity_id,
    i.agent_wallet,
    i.observed_block AS identity_observed_block,
    i.read_consistency AS identity_read_consistency,
    a.listing_status,
    a.verification_status,
    a.runtime_status,
    a.authority_status,
    a.execution_wallet,
    v.id AS agent_version_id,
    v.version AS agent_version,
    v.pricing_manifest,
    service.kind AS service_kind,
    service.url AS service_url,
    service.protocol_version AS service_protocol_version,
    service.observed_at AS service_observed_at,
    probe.observed_at AS probe_observed_at
  FROM agents a
  JOIN erc8004_identities i ON i.id = a.identity_id
  JOIN LATERAL (
    SELECT av.id, av.version, av.pricing_manifest
    FROM agent_versions av
    WHERE av.agent_id = a.id
      AND a.current_version_id IS NOT NULL
      AND av.id = a.current_version_id
    ORDER BY av.version DESC, av."createdAt" DESC, av.id DESC
    LIMIT 1
  ) v ON TRUE
  JOIN LATERAL (
    SELECT s.kind, s.url, s.protocol_version, s.observed_at
    FROM agent_services s
    WHERE s.agent_version_id = v.id
      AND s.kind IN ('a2a', 'adapter')
      AND s.validation_status = 'healthy'
      AND s.url ~ '^https://'
    ORDER BY s.observed_at DESC, s."updatedAt" DESC, s.id DESC
    LIMIT 1
  ) service ON TRUE
  JOIN LATERAL (
    SELECT p.observed_at
    FROM agent_service_probe_results p
    WHERE p.identity_id = i.id
      AND p.kind = service.kind
      AND p.url = service.url
      AND p.validation_status = 'healthy'
      AND p.observed_at >= now() - interval '2 minutes'
    ORDER BY p.observed_at DESC, p.id DESC
    LIMIT 1
  ) probe ON TRUE
`;

function asDate(value: Date | string, label: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The persisted ${label} timestamp is invalid.`, nextAction: "manual_review" });
  return date;
}

function iso(value: Date | string, label: string): string {
  return asDate(value, label).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CommerceError({ code: "INVALID_QUOTE", message: "The marketplace price snapshot is unavailable.", nextAction: "reload_listing" });
  }
  return value as Record<string, unknown>;
}

function asAtomic(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new CommerceError({ code: "INVALID_QUOTE", message: `The persisted ${label} is not an atomic amount.`, nextAction: "reload_listing" });
  }
  return value;
}

function optionalAtomic(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  return asAtomic(value, label);
}

/**
 * A paid ERC-8183 quote needs one persisted amount. Ranges and quote-only
 * listings are intentionally denied unless the stored range is a single
 * exact value; the server never chooses a price on behalf of the provider.
 */
export function parsePersistedPricing(value: unknown, pin: EnabledErc8183DeploymentPin): ParsedPricing {
  const pricing = asRecord(value);
  const model = pricing.model;
  if (model !== "fixed" && model !== "range") {
    throw new CommerceError({ code: "INVALID_QUOTE", message: "This marketplace listing has no fixed persisted ERC-8183 price.", nextAction: "choose_priced_agent" });
  }
  const network = typeof pricing.network === "number" ? pricing.network : Number(pricing.network);
  if (!Number.isSafeInteger(network) || network !== pin.chainId) {
    throw new CommerceError({ code: "INVALID_CHAIN", message: "The persisted listing network does not match the pinned ERC-8183 network.", nextAction: "reload_listing" });
  }
  const tokenAddress = evmAddressSchema.safeParse(pricing.tokenAddress).success ? String(pricing.tokenAddress) : null;
  if (tokenAddress === null || tokenAddress.toLowerCase() !== pin.paymentToken.toLowerCase()) {
    throw new CommerceError({ code: "INVALID_TOKEN", message: "The persisted listing payment token does not match the standards-locked token.", nextAction: "reload_listing" });
  }
  const decimals = typeof pricing.decimals === "number" ? pricing.decimals : Number(pricing.decimals);
  if (!Number.isSafeInteger(decimals) || decimals !== pin.paymentDecimals) {
    throw new CommerceError({ code: "INVALID_TOKEN", message: "The persisted listing payment decimals do not match the standards lock.", nextAction: "reload_listing" });
  }
  const amount = optionalAtomic(pricing.amountAtomic, "price");
  const min = optionalAtomic(pricing.minAtomic, "minimum price") ?? amount;
  const max = optionalAtomic(pricing.maxAtomic, "maximum price") ?? amount;
  if (min === null || max === null || min !== max) {
    throw new CommerceError({ code: "INVALID_QUOTE", message: "This listing exposes a price range rather than one persisted quote amount.", nextAction: "choose_fixed_price_agent" });
  }
  let price: bigint;
  try {
    price = BigInt(min);
    if (price <= 0n || price < BigInt(pin.minBudgetAtomic) || price > BigInt(pin.maxBudgetAtomic)) throw new Error("outside pin");
  } catch (cause) {
    throw new CommerceError({ code: "INVALID_AMOUNT", message: "The persisted listing price is outside the standards-locked budget bounds.", nextAction: "reload_listing", cause });
  }
  const tokenSymbol = typeof pricing.tokenSymbol === "string" && pricing.tokenSymbol.trim() !== ""
    ? pricing.tokenSymbol.trim().slice(0, 32)
    : null;
  return { priceAtomic: price.toString(10), tokenSymbol, tokenAddress, decimals, network };
}

function identityFromListing(row: ListingRow): Erc8004Identity {
  return erc8004IdentitySchema.parse({
    namespace: row.namespace,
    chainId: row.chain_id,
    identityRegistry: row.identity_registry,
    agentId: row.agent_identity_id
  });
}

function providerFromListing(row: ListingRow): { readonly address: string; readonly source: CommerceQuoteSnapshot["providerAddressSource"] } {
  // Prefer the marketplace's persisted execution wallet. The ERC-8004 agent
  // wallet is a persisted on-chain fallback only when no execution wallet was
  // published; neither address is inferred from a request.
  const candidate = row.execution_wallet ?? row.agent_wallet;
  if (candidate === null || !evmAddressSchema.safeParse(candidate).success || /^0x0{40}$/iu.test(candidate)) {
    throw new CommerceError({ code: "INVALID_ADDRESS", message: "The published listing has no genuine provider execution address.", nextAction: "reload_listing" });
  }
  return {
    address: candidate.toLowerCase(),
    source: row.execution_wallet === null ? "erc8004_agent_wallet" : "persisted_execution_wallet"
  };
}

function assertLiveListing(row: ListingRow): void {
  if (row.listing_status !== "published" || row.verification_status !== "verified") {
    throw new CommerceError({ code: "STALE_JOB", message: "The selected marketplace listing is not currently published and verified.", nextAction: "reload_listing" });
  }
  if (row.runtime_status !== "live" || row.authority_status !== "active") {
    throw new CommerceError({ code: "STALE_JOB", message: "The selected marketplace provider is not currently live and authorized.", nextAction: "reload_listing" });
  }
  if (row.identity_observed_block === null || row.identity_read_consistency !== "finalized") {
    throw new CommerceError({ code: "STALE_JOB", message: "The selected listing has no finalized ERC-8004 identity observation.", nextAction: "reload_listing" });
  }
}

function providerBinding(row: ListingRow): Erc8183ProviderBinding {
  return erc8183ProviderBindingSchema.parse({
    identity: identityFromListing(row),
    agentVersionId: row.agent_version_id,
    agentVersion: row.agent_version
  });
}

function rowToListing(row: ListingRow, pin: EnabledErc8183DeploymentPin): {
  readonly identity: Erc8004Identity;
  readonly providerAddress: string;
  readonly providerAddressSource: CommerceQuoteSnapshot["providerAddressSource"];
  readonly binding: Erc8183ProviderBinding;
  readonly price: ParsedPricing;
  readonly service: CommerceQuoteSnapshot["service"];
} {
  assertLiveListing(row);
  const identity = identityFromListing(row);
  if (identity.chainId !== pin.chainId) throw new CommerceError({ code: "INVALID_CHAIN", message: "The published listing identity is on a different network than the ERC-8183 deployment.", nextAction: "reload_listing" });
  const provider = providerFromListing(row);
  const price = parsePersistedPricing(row.pricing_manifest, pin);
  const serviceUrl = new URL(row.service_url);
  if (serviceUrl.protocol !== "https:" || serviceUrl.username !== "" || serviceUrl.password !== "") {
    throw new CommerceError({ code: "INVALID_QUOTE", message: "The published callable service URL is unsafe or unavailable.", nextAction: "reload_listing" });
  }
  const service = {
    kind: row.service_kind,
    url: serviceUrl.toString(),
    protocolVersion: row.service_protocol_version,
    observedAt: iso(row.service_observed_at, "service observation"),
    probeObservedAt: iso(row.probe_observed_at, "service probe")
  } satisfies CommerceQuoteSnapshot["service"];
  return {
    identity,
    providerAddress: provider.address,
    providerAddressSource: provider.source,
    binding: providerBinding(row),
    price,
    service
  };
}

function digestTask(task: string): string {
  return canonicalSha256Hex(task).toLowerCase();
}

function parseReservationRow(row: ReservationRow): CommerceQuoteSnapshot {
  const quote = commerceQuoteSnapshotSchema.safeParse(row.quote);
  if (!quote.success) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted quote reservation is malformed.", nextAction: "manual_review", cause: quote.error });
  if (row.price !== quote.data.priceAtomic || row.task_input_digest.toLowerCase() !== quote.data.taskDigest.toLowerCase()) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted quote reservation does not match its snapshot.", nextAction: "manual_review" });
  }
  return quote.data;
}

type ReservationParent = {
  readonly commerceJobId: string;
  readonly buyerUserId: string | null;
  readonly status: "draft" | "negotiating" | "funded" | "accepted" | "submitted" | "completed" | "rejected" | "disputed" | "settled" | "cancelled";
  readonly priceAtomic: string;
  readonly task: string;
  readonly taskInputDigest: string;
  readonly fundingTransactionHash: string | null;
  readonly fulfillmentTransactionHash: string | null;
  readonly disputeTransactionHash: string | null;
  readonly settlementTransactionHash: string | null;
  readonly providerAddress: string;
  readonly providerBinding: Erc8183ProviderBinding;
  readonly listing: {
    readonly providerAddress: string;
    readonly providerBinding: Erc8183ProviderBinding;
    readonly terms: { readonly chainId: 56 | 97; readonly commerceContract: string; readonly paymentToken: string; readonly paymentDecimals: number; readonly priceAtomic: string };
    readonly listingStatus: "published";
    readonly verificationStatus: "verified";
    readonly runtimeStatus: "live";
    readonly authorityStatus: "active";
    readonly version: { readonly id: string; readonly number: number };
  };
};

function reservationParent(row: ReservationRow, quote: CommerceQuoteSnapshot, listing: ReturnType<typeof rowToListing>): ReservationParent {
  const status = row.status as ReservationParent["status"];
  if (!["draft", "negotiating", "funded", "accepted", "submitted", "completed", "rejected", "disputed", "settled", "cancelled"].includes(status)) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted reservation has an unknown status.", nextAction: "manual_review" });
  }
  if (quote.identity.chainId !== listing.identity.chainId || quote.agentVersionId !== listing.binding.agentVersionId || quote.agentVersion !== listing.binding.agentVersion || quote.providerAddress.toLowerCase() !== listing.providerAddress.toLowerCase() || quote.priceAtomic !== listing.price.priceAtomic) {
    throw new CommerceError({ code: "STALE_JOB", message: "The quote no longer matches the current published listing.", nextAction: "reload_quote" });
  }
  return {
    commerceJobId: row.id,
    buyerUserId: row.buyer_user_id,
    status,
    priceAtomic: quote.priceAtomic,
    task: quote.task,
    taskInputDigest: quote.taskDigest,
    fundingTransactionHash: row.funding_transaction_hash,
    fulfillmentTransactionHash: row.fulfillment_transaction_hash,
    disputeTransactionHash: row.dispute_transaction_hash,
    settlementTransactionHash: row.settlement_transaction_hash,
    providerAddress: listing.providerAddress,
    providerBinding: listing.binding,
    listing: {
      providerAddress: listing.providerAddress,
      providerBinding: listing.binding,
      terms: {
        chainId: quote.chainId,
        commerceContract: quote.commerceContract,
        paymentToken: quote.paymentToken,
        paymentDecimals: quote.paymentDecimals,
        priceAtomic: quote.priceAtomic
      },
      listingStatus: "published",
      verificationStatus: "verified",
      runtimeStatus: "live",
      authorityStatus: "active",
      version: { id: listing.binding.agentVersionId, number: listing.binding.agentVersion }
    }
  };
}

/**
 * Narrow persistence seam used by the commerce composition. It intentionally
 * combines the quote writer and parent-hire resolver so a quote can never be
 * converted into a hire using a separately re-resolved or client-provided
 * provider/price.
 */
export class PostgresCommerceReservationStore {
  public constructor(
    private readonly pool: Erc8183OperationQueryPool,
    private readonly pin: EnabledErc8183DeploymentPin,
    private readonly quoteLifetimeSeconds = 10 * 60
  ) {}

  private async listingByIdentifier(identifier: string): Promise<ListingRow> {
    const result = await this.pool.query<ListingRow>(`${listingSelect}
      WHERE (
        (i.namespace || ':' || i.chain_id::text || ':' || lower(i.identity_registry) || ':' || i.agent_id) = $1
        OR EXISTS (
          SELECT 1 FROM agent_versions selected_version
          WHERE selected_version.id = v.id
            AND selected_version.public_metadata->>'slug' = $1
        )
      )
      LIMIT 1`, [identifier]);
    const row = result.rows[0];
    if (row === undefined) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The selected marketplace agent is not available.", nextAction: "reload_listing" });
    return row;
  }

  private async listingByAgentId(agentId: string): Promise<ListingRow> {
    const result = await this.pool.query<ListingRow>(`${listingSelect}
      WHERE a.id = $1
      LIMIT 1`, [agentId]);
    const row = result.rows[0];
    if (row === undefined) throw new CommerceError({ code: "STALE_JOB", message: "The quoted marketplace agent is no longer available.", nextAction: "reload_listing" });
    return row;
  }

  private async reservationRow(commerceJobId: string, buyerUserId: string): Promise<ReservationRow | null> {
    const result = await this.pool.query<ReservationRow>(`
      SELECT id, erc8183_job_id, buyer_user_id, provider_agent_id, quote, price,
        task_input_digest, status, funding_transaction_hash,
        fulfillment_transaction_hash, dispute_transaction_hash, settlement_transaction_hash
      FROM commerce_jobs
      WHERE id = $1 AND buyer_user_id = $2
      LIMIT 1
    `, [commerceJobId, buyerUserId]);
    return result.rows[0] ?? null;
  }

  private assertQuoteStillCurrent(quote: CommerceQuoteSnapshot, listing: ReturnType<typeof rowToListing>, nowUnix: number): void {
    if (Date.parse(quote.expiresAt) <= nowUnix * 1_000) throw new CommerceError({ code: "STALE_JOB", message: "The quote has expired; request a fresh quote.", nextAction: "reload_quote" });
    if (
      erc8004IdentityKey(quote.identity) !== erc8004IdentityKey(listing.identity) ||
      quote.agentVersionId !== listing.binding.agentVersionId ||
      quote.agentVersion !== listing.binding.agentVersion ||
      quote.providerAddress.toLowerCase() !== listing.providerAddress.toLowerCase() ||
      quote.priceAtomic !== listing.price.priceAtomic ||
      quote.chainId !== this.pin.chainId ||
      quote.commerceContract.toLowerCase() !== this.pin.commerceContract.toLowerCase() ||
      quote.paymentToken.toLowerCase() !== this.pin.paymentToken.toLowerCase() ||
      quote.paymentDecimals !== this.pin.paymentDecimals
    ) {
      throw new CommerceError({ code: "STALE_JOB", message: "The quote no longer matches the current published marketplace state.", nextAction: "reload_quote" });
    }
  }

  public async quote(input: { readonly buyerUserId: string; readonly agentIdentifier: string; readonly task: string }): Promise<CommerceQuoteSnapshot> {
    const parsed = commerceQuoteRequestSchema.parse({ agentIdentifier: input.agentIdentifier, task: input.task });
    const listingRow = await this.listingByIdentifier(parsed.agentIdentifier);
    const listing = rowToListing(listingRow, this.pin);
    const nowUnix = Math.floor(Date.now() / 1_000);
    const issuedAt = new Date(nowUnix * 1_000);
    const expiresAt = new Date((nowUnix + this.quoteLifetimeSeconds) * 1_000);
    const taskDigest = digestTask(parsed.task);
    const snapshotWithoutId: Omit<CommerceQuoteSnapshot, "quoteId"> = {
      schemaVersion: "bnbera.erc8183-quote/v1",
      agentIdentifier: parsed.agentIdentifier,
      identity: listing.identity,
      agentVersionId: listing.binding.agentVersionId,
      agentVersion: listing.binding.agentVersion,
      providerAddress: listing.providerAddress,
      providerAddressSource: listing.providerAddressSource,
      service: listing.service,
      chainId: this.pin.chainId,
      commerceContract: this.pin.commerceContract,
      paymentToken: this.pin.paymentToken,
      paymentDecimals: this.pin.paymentDecimals,
      tokenSymbol: listing.price.tokenSymbol,
      priceAtomic: listing.price.priceAtomic,
      task: parsed.task,
      taskDigest,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: "draft"
    };

    const commerceJobId = randomUUID();
    const snapshot = commerceQuoteSnapshotSchema.parse({ ...snapshotWithoutId, quoteId: commerceJobId });
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize only the same buyer/listing/task reservation. This keeps a
      // double click from creating two unpaid draft rows without a new table.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalSha256Hex({ buyerUserId: input.buyerUserId, agentId: listingRow.agent_id, taskDigest })]);
      const existing = await client.query<ReservationRow>(`
        SELECT id, erc8183_job_id, buyer_user_id, provider_agent_id, quote, price,
          task_input_digest, status, funding_transaction_hash,
          fulfillment_transaction_hash, dispute_transaction_hash, settlement_transaction_hash
        FROM commerce_jobs
        WHERE buyer_user_id = $1
          AND provider_agent_id = $2
          AND task_input_digest = $3
          AND status IN ('draft', 'negotiating')
        ORDER BY "createdAt" DESC, id DESC
        LIMIT 1
        FOR UPDATE
      `, [input.buyerUserId, listingRow.agent_id, taskDigest]);
      const existingRow = existing.rows[0];
      if (existingRow !== undefined) {
        const existingQuote = parseReservationRow(existingRow);
        const current = rowToListing(listingRow, this.pin);
        try {
          this.assertQuoteStillCurrent(existingQuote, current, nowUnix);
          await client.query("COMMIT");
          return existingQuote;
        } catch (cause) {
          // A stale/expired draft is not reused, but it also must not prevent
          // the buyer from obtaining a new snapshot. Malformed or otherwise
          // tampered rows remain hard failures and never get overwritten.
          if (!(cause instanceof CommerceError) || cause.code !== "STALE_JOB") throw cause;
        }
      }
      await client.query(`
        INSERT INTO commerce_jobs (
          id, erc8183_job_id, buyer_user_id, provider_agent_id, quote, price,
          task_input_digest, status, "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, 'draft', $8, $8)
      `, [commerceJobId, `draft:${commerceJobId}`, input.buyerUserId, listingRow.agent_id, JSON.stringify(snapshot), snapshot.priceAtomic, taskDigest, issuedAt]);
      await client.query("COMMIT");
      return snapshot;
    } catch (cause) {
      try { await client.query("ROLLBACK"); } catch { /* preserve the original safe error */ }
      if (cause instanceof CommerceError) throw cause;
      throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The quote reservation could not be persisted.", nextAction: "retry_quote", cause });
    } finally {
      client.release();
    }
  }

  /** Resolve an unpaid reservation for the authenticated buyer only. */
  public async resolve(input: {
    readonly commerceJobId: string;
    readonly buyerUserId: string;
    readonly task?: string;
    readonly budgetAtomic?: string;
    readonly chainId: 56 | 97;
    readonly commerceContract: string;
    readonly paymentToken: string;
    readonly paymentDecimals: number;
  }): Promise<{
    readonly commerceJobId: string;
    readonly buyerUserId: string | null;
    readonly status: CommerceJobStatus;
    readonly priceAtomic: string;
    readonly task: string;
    readonly taskInputDigest: string;
    readonly fundingTransactionHash: string | null;
    readonly fulfillmentTransactionHash: string | null;
    readonly disputeTransactionHash: string | null;
    readonly settlementTransactionHash: string | null;
    readonly providerAddress: string;
    readonly providerBinding: Erc8183ProviderBinding;
    readonly listing: {
      readonly providerAddress: string;
      readonly providerBinding: Erc8183ProviderBinding;
      readonly terms: { readonly chainId: 56 | 97; readonly commerceContract: string; readonly paymentToken: string; readonly paymentDecimals: number; readonly priceAtomic: string };
      readonly listingStatus: "published";
      readonly verificationStatus: "verified";
      readonly runtimeStatus: "live";
      readonly authorityStatus: "active";
      readonly version: { readonly id: string; readonly number: number };
    };
  } | null> {
    const row = await this.reservationRow(input.commerceJobId, input.buyerUserId);
    if (row === null) return null;
    const quote = parseReservationRow(row);
    if (row.buyer_user_id !== input.buyerUserId || row.status !== "draft" && row.status !== "negotiating") return null;
    if (input.task !== undefined && digestTask(input.task) !== quote.taskDigest) {
      throw new CommerceError({ code: "INVALID_QUOTE", message: "The requested task does not match the persisted quote.", nextAction: "reload_quote" });
    }
    if (input.budgetAtomic !== undefined && input.budgetAtomic !== quote.priceAtomic) {
      throw new CommerceError({ code: "INVALID_QUOTE", message: "The requested budget does not match the persisted quote.", nextAction: "reload_quote" });
    }
    const listingRow = await this.listingByAgentId(row.provider_agent_id);
    const listing = rowToListing(listingRow, this.pin);
    this.assertQuoteStillCurrent(quote, listing, Math.floor(Date.now() / 1_000));
    if (input.chainId !== this.pin.chainId || input.commerceContract.toLowerCase() !== this.pin.commerceContract.toLowerCase() || input.paymentToken.toLowerCase() !== this.pin.paymentToken.toLowerCase() || input.paymentDecimals !== this.pin.paymentDecimals) {
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The requested commerce deployment does not match the standards-locked quote.", nextAction: "verify_standards_lock" });
    }
    const parent = reservationParent(row, quote, listing);
    return parent;
  }

  /**
   * Atomically claim a buyer quote for the single hire intent. The existing
   * negotiating state is deliberately idempotent: a retry after a process
   * crash may continue the same server-derived operation key, but a funded or
   * otherwise terminal parent can never be claimed again.
   */
  public async claim(input: { readonly commerceJobId: string; readonly buyerUserId: string }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<ReservationRow>(`
        SELECT id, erc8183_job_id, buyer_user_id, provider_agent_id, quote, price,
          task_input_digest, status, funding_transaction_hash,
          fulfillment_transaction_hash, dispute_transaction_hash, settlement_transaction_hash
        FROM commerce_jobs
        WHERE id = $1 AND buyer_user_id = $2
        FOR UPDATE
      `, [input.commerceJobId, input.buyerUserId]);
      const row = result.rows[0];
      if (row === undefined) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The requested parent commerce reservation is unavailable for this buyer.", nextAction: "reload_quote" });
      // Parse the immutable snapshot before changing the claim state. A
      // malformed row must go to review, never into a fundable operation.
      const quote = parseReservationRow(row);
      if (Date.parse(quote.expiresAt) <= Date.now()) {
        throw new CommerceError({ code: "STALE_JOB", message: "The quote has expired; request a fresh quote.", nextAction: "reload_quote" });
      }
      if (row.status !== "draft" && row.status !== "negotiating") {
        throw new CommerceError({ code: "STALE_JOB", message: "The parent commerce reservation is no longer unpaid and reservable.", nextAction: "reload_quote" });
      }
      if (row.funding_transaction_hash !== null || row.fulfillment_transaction_hash !== null || row.dispute_transaction_hash !== null || row.settlement_transaction_hash !== null) {
        throw new CommerceError({ code: "STALE_JOB", message: "The parent commerce reservation already has chain evidence and cannot be claimed again.", nextAction: "reload_quote" });
      }
      if (row.status === "draft") {
        const updated = await client.query(`
          UPDATE commerce_jobs SET status = 'negotiating', "updatedAt" = now()
          WHERE id = $1 AND buyer_user_id = $2 AND status = 'draft'
        `, [input.commerceJobId, input.buyerUserId]);
        if (updated.rowCount !== undefined && updated.rowCount !== 1) {
          throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "Another hire claim won the parent reservation race.", nextAction: "reload_quote" });
        }
      }
      await client.query("COMMIT");
    } catch (cause) {
      try { await client.query("ROLLBACK"); } catch { /* preserve the original safe error */ }
      if (cause instanceof CommerceError) throw cause;
      throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The parent commerce reservation could not be claimed safely.", nextAction: "retry_quote", cause });
    } finally {
      client.release();
    }
  }
}
