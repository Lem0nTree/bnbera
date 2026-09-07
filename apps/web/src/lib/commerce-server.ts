/**
 * Server-only ERC-8183 application composition.
 *
 * This module is intentionally an adapter seam, not an authentication system:
 * the caller must provide a server-authenticated identity resolver. Browser
 * signing remains outside this server composition; server-side SDK authority
 * is still a separate, explicit boundary.
 */
import { evmAddressSchema, type CommerceJobStatus } from "@bnbera/domain";
import { readFile } from "node:fs/promises";
import { AppError } from "@bnbera/config";
import {
  CommerceError,
  Erc8183AltanaAdapter,
  Erc8183CommerceReadService,
  Erc8183CommerceService,
  PostgresErc8183MarketplaceProjection,
  PostgresErc8183JobRepository,
  PostgresErc8183OperationRepository,
  erc8183JobKeySchema,
  erc8183ProviderBindingSchema,
  type Erc8183AltanaAuthority,
  type Erc8183CommerceServiceOptions,
  type Erc8183JobKey,
  type Erc8183JobRead,
  type Erc8183ProviderBinding,
  type Erc8183ProviderResult,
  type Erc8183ProviderTask,
  type Erc8183SubmitResult,
  type Erc8183CommerceOperationStatus,
  type EnabledErc8183DeploymentPin,
  type Erc8183OperationQueryPool,
  type Erc8183OperationCoordinatorResult,
  type Erc8183OperationRecord,
  type Erc8183HireResult,
  type Erc8183SettleResult,
  type Erc8183ClaimRefundResult
} from "@bnbera/agent-commerce";
import {
  buildErc8183EoaCall,
  ERC8183_EOA_CONTRACTS,
  parseEnabledDeploymentPin,
  type Erc8183SubmitInput,
  type Erc8183EoaStep
} from "@bnbera/agent-commerce";
import { commerceBrowserDispatchSchema, type CommerceBrowserDispatch } from "./commerce-contract";
import {
  getCommerceAuthDatabasePool,
  requireAuthenticatedCommerceIdentity
} from "./commerce-auth";
import {
  PostgresCommerceReservationStore,
  type CommerceQuoteSnapshot
} from "./commerce-reservations";

/** Stable blocker for server-side SDK writes until a signer authority exists. */
export const T4_AUTHORITY_BOUNDARY_BLOCKER = "T4_AUTHENTICATED_ALTANA_AUTHORITY_BOUNDARY_UNAVAILABLE" as const;

export function commerceAuthorityBoundaryError(): CommerceError {
  return new CommerceError({
    code: "COMMERCE_DISABLED",
    message: `${T4_AUTHORITY_BOUNDARY_BLOCKER}: no server-authenticated wallet/session resolver can supply an Altana execution authority.`,
    nextAction: "configure_auth_boundary"
  });
}

/**
 * Read identity is deliberately independent from an Altana signer. A
 * concrete implementation must validate the server session/cookie and return
 * only non-secret identity fields. No serialized session, private key, or
 * actor field is accepted by any API request body.
 */
export interface CommerceIdentityResolver {
  resolve(request: Request): Promise<AuthenticatedCommerceIdentity>;
}

export interface AuthenticatedCommerceIdentity {
  readonly authenticated: true;
  readonly userId: string;
  readonly requesterAddress: string;
  /** SIWE session chain; legacy test seams may omit it. */
  readonly chainId?: number;
}

/**
 * Mutation-only authority boundary. The resolver may return a wallet or
 * bounded session from the pinned Altana SDK, but it must never derive that
 * authority from request-body data. Keeping this separate lets status reloads
 * work when a signer is unavailable.
 */
export interface CommerceAuthorityResolver {
  resolve(request: Request, identity: AuthenticatedCommerceIdentity): Promise<Erc8183AltanaAuthority>;
}

export interface CommerceParentHireResolutionInput {
  /** Stable persisted `commerce_jobs.id`, not the protocol job ID. */
  readonly commerceJobId: string;
  readonly buyerUserId: string;
  /** Optional legacy assertion. Production T5 resolves both from the quote snapshot. */
  readonly task?: string;
  /** Optional legacy assertion. Production T5 resolves both from the quote snapshot. */
  readonly budgetAtomic?: string;
  readonly chainId: 56 | 97;
  readonly commerceContract: string;
  readonly paymentToken: string;
  readonly paymentDecimals: number;
}

export interface CommerceHireListingTerms {
  readonly chainId: 56 | 97;
  readonly commerceContract: string;
  readonly paymentToken: string;
  readonly paymentDecimals: number;
  readonly priceAtomic: string;
}

/**
 * Persistent marketplace binding returned by the parent-hire resolver. The
 * resolver is expected to join `commerce_jobs`, `agents`,
 * `erc8004_identities`, and the current `agent_versions` row. The composition
 * validates the repeated values again before invoking the SDK.
 */
export interface CommerceEligibleHireListing {
  readonly providerAddress: string;
  readonly providerBinding: Erc8183ProviderBinding;
  readonly terms: CommerceHireListingTerms;
  /** Values come from the joined marketplace listing, never the request. */
  readonly listingStatus: "published";
  readonly verificationStatus: "verified";
  readonly runtimeStatus: "live";
  readonly authorityStatus: "active";
  readonly version: { readonly id: string; readonly number: number };
}

export interface CommerceParentHireRecord {
  readonly commerceJobId: string;
  readonly buyerUserId: string | null;
  readonly status: CommerceJobStatus;
  readonly priceAtomic: string;
  /** Exact task persisted in the buyer-owned quote snapshot. */
  readonly task: string;
  readonly taskInputDigest: string;
  readonly fundingTransactionHash: string | null;
  readonly fulfillmentTransactionHash: string | null;
  readonly disputeTransactionHash: string | null;
  readonly settlementTransactionHash: string | null;
  readonly providerAddress: string;
  readonly providerBinding: Erc8183ProviderBinding;
  readonly listing: CommerceEligibleHireListing;
}

/**
 * Required persistent seam for hire authorization. A missing resolver is a
 * composition error; an unresolved row is a closed denial and must happen
 * before `Erc8183CommerceService.hire` can reach the SDK.
 */
export interface CommerceParentHireResolver {
  resolve(input: CommerceParentHireResolutionInput): Promise<CommerceParentHireRecord | null>;
}

export interface Erc8183CommerceCompositionOptions {
  /** Checked-in standards.lock projection; never read from a request. */
  readonly standardsLock: unknown;
  /** Application terms pin, reviewed alongside standardsLock. */
  readonly pin: EnabledErc8183DeploymentPin;
  /** A persistent PostgreSQL pool; disposable/mocked pools are for tests only. */
  readonly pool: Erc8183OperationQueryPool;
  /** Server-authenticated read identity resolver. Required in every environment. */
  readonly identityResolver: CommerceIdentityResolver;
  /** Mutation-only Altana authority. Status reads do not require this value. */
  readonly authorityResolver?: CommerceAuthorityResolver;
  /** Optional override for tests or a later marketplace repository. */
  readonly parentHireResolver?: CommerceParentHireResolver;
  /** Explicit constructor-only development/test canary opt-in. */
  readonly developmentCanaryEnabled?: boolean;
  readonly runtimeEnvironment?: "development" | "test" | "production";
}

function invalidComposition(message: string, nextAction: string): CommerceError {
  return new CommerceError({ code: "COMMERCE_DISABLED", message, nextAction });
}

function assertPersistentPool(pool: unknown): asserts pool is Erc8183OperationQueryPool {
  if (
    typeof pool !== "object" ||
    pool === null ||
    typeof (pool as { query?: unknown }).query !== "function" ||
    typeof (pool as { connect?: unknown }).connect !== "function"
  ) {
    throw invalidComposition(
      "T4 production composition requires a persistent PostgreSQL operation and canonical-job repository.",
      "configure_database"
    );
  }
}

function authorityExecutionAddress(authority: Erc8183AltanaAuthority): string {
  if ("session" in authority) return authority.session.walletAddress;
  return authority.wallet.address;
}

function assertIdentityShape(identity: unknown): asserts identity is AuthenticatedCommerceIdentity {
  if (typeof identity !== "object" || identity === null) {
    throw new CommerceError({
      code: "UNAUTHORIZED_ACTOR",
      message: "The server-authenticated requester identity is unavailable.",
      nextAction: "authenticate_actor"
    });
  }
  const value = identity as Partial<AuthenticatedCommerceIdentity>;
  if (
    value.authenticated !== true ||
    typeof value.userId !== "string" ||
    value.userId.trim() === "" ||
    typeof value.requesterAddress !== "string" ||
    !evmAddressSchema.safeParse(value.requesterAddress).success
  ) throw new CommerceError({
    code: "UNAUTHORIZED_ACTOR",
    message: "The server-authenticated requester identity is invalid.",
    nextAction: "authenticate_actor"
  });
  if (value.chainId !== undefined && value.chainId !== 97) throw new CommerceError({ code: "INVALID_CHAIN", message: "The authenticated requester session is not bound to BSC testnet.", nextAction: "authenticate_actor" });
}

function assertAuthorityShape(authority: unknown): asserts authority is Erc8183AltanaAuthority {
  if (typeof authority !== "object" || authority === null) throw commerceAuthorityBoundaryError();
  try {
    const executionAddress = authorityExecutionAddress(authority as Erc8183AltanaAuthority);
    if (!evmAddressSchema.safeParse(executionAddress).success) throw new Error("missing execution address");
  } catch {
    throw commerceAuthorityBoundaryError();
  }
}

function assertJobActor(job: Erc8183JobRead, requesterAddress: string): void {
  const normalized = requesterAddress.toLowerCase();
  const client = job.job.terms.clientAddress.toLowerCase();
  const provider = job.job.terms.providerAddress?.toLowerCase() ?? null;
  if (normalized !== client && normalized !== provider) {
    throw new CommerceError({
      code: "UNAUTHORIZED_ACTOR",
      message: "The authenticated requester is not an actor on this ERC-8183 job.",
      nextAction: "authenticate_actor"
    });
  }
}

function sameProviderBinding(a: Erc8183ProviderBinding, b: Erc8183ProviderBinding): boolean {
  return a.agentVersionId.toLowerCase() === b.agentVersionId.toLowerCase() &&
    a.agentVersion === b.agentVersion &&
    a.identity.namespace === b.identity.namespace &&
    a.identity.chainId === b.identity.chainId &&
    a.identity.identityRegistry.toLowerCase() === b.identity.identityRegistry.toLowerCase() &&
    a.identity.agentId === b.identity.agentId;
}

function assertParentHireAuthorization(
  parent: CommerceParentHireRecord | null,
  input: { readonly commerceJobId: string; readonly task?: string; readonly budgetAtomic?: string },
  identity: AuthenticatedCommerceIdentity,
  pin: EnabledErc8183DeploymentPin
): CommerceParentHireRecord {
  if (parent === null) {
    throw new CommerceError({
      code: "UNKNOWN_JOB",
      message: "The requested parent commerce reservation is unavailable for this buyer.",
      nextAction: "reload_quote"
    });
  }
  if (parent.commerceJobId !== input.commerceJobId) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The parent commerce reservation identity is inconsistent.", nextAction: "reload_quote" });
  }
  if (parent.buyerUserId === null || parent.buyerUserId !== identity.userId) {
    throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The parent commerce reservation does not belong to the authenticated buyer.", nextAction: "authenticate_actor" });
  }
  if (!(parent.status === "draft" || parent.status === "negotiating") || parent.fundingTransactionHash !== null || parent.fulfillmentTransactionHash !== null || parent.disputeTransactionHash !== null || parent.settlementTransactionHash !== null) {
    throw new CommerceError({ code: "STALE_JOB", message: "The parent commerce reservation is no longer unpaid and reservable.", nextAction: "reload_quote" });
  }
  if (input.budgetAtomic !== undefined && parent.priceAtomic !== input.budgetAtomic) {
    throw new CommerceError({ code: "INVALID_QUOTE", message: "The requested budget does not match the persisted parent quote.", nextAction: "reload_quote" });
  }
  if (input.task !== undefined && parent.taskInputDigest.toLowerCase() !== taskDigest(input.task)) {
    throw new CommerceError({ code: "INVALID_QUOTE", message: "The requested task does not match the persisted parent reservation.", nextAction: "reload_quote" });
  }
  if (parent.task !== undefined && (parent.task.trim() === "" || parent.taskInputDigest.toLowerCase() !== taskDigest(parent.task))) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted parent task snapshot does not match its digest.", nextAction: "manual_review" });
  }
  if (input.task === undefined && parent.task === undefined) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted parent reservation has no exact task snapshot.", nextAction: "manual_review" });
  }

  const listing = parent.listing;
  if (listing.listingStatus !== "published" || listing.verificationStatus !== "verified" || listing.runtimeStatus !== "live" || listing.authorityStatus !== "active") {
    throw new CommerceError({ code: "STALE_JOB", message: "The provider marketplace listing is not currently eligible for execution.", nextAction: "reload_listing" });
  }
  try {
    evmAddressSchema.parse(parent.providerAddress);
    evmAddressSchema.parse(listing.providerAddress);
    evmAddressSchema.parse(listing.terms.commerceContract);
    evmAddressSchema.parse(listing.terms.paymentToken);
    erc8183ProviderBindingSchema.parse(parent.providerBinding);
    erc8183ProviderBindingSchema.parse(listing.providerBinding);
  } catch (cause) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted parent provider/listing binding is invalid.", nextAction: "manual_review", cause });
  }
  if (parent.providerAddress.toLowerCase() !== listing.providerAddress.toLowerCase() || !sameProviderBinding(parent.providerBinding, listing.providerBinding)) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The parent provider does not match the eligible marketplace listing version.", nextAction: "reload_listing" });
  }
  if (listing.providerBinding.agentVersionId.toLowerCase() !== listing.version.id.toLowerCase() || listing.providerBinding.agentVersion !== listing.version.number) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The marketplace listing version binding is inconsistent.", nextAction: "reload_listing" });
  }
  if (listing.providerBinding.identity.chainId !== pin.chainId || listing.terms.chainId !== pin.chainId) {
    throw new CommerceError({ code: "INVALID_CHAIN", message: "The provider listing chain does not match the pinned ERC-8183 deployment." });
  }
  if (listing.terms.commerceContract.toLowerCase() !== pin.commerceContract.toLowerCase() || listing.terms.paymentToken.toLowerCase() !== pin.paymentToken.toLowerCase() || listing.terms.paymentDecimals !== pin.paymentDecimals) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The provider listing terms do not match the pinned ERC-8183 deployment.", nextAction: "reload_listing" });
  }
  if (listing.terms.priceAtomic !== parent.priceAtomic) {
    throw new CommerceError({ code: "INVALID_QUOTE", message: "The parent quote does not match the eligible listing terms.", nextAction: "reload_quote" });
  }
  try {
    const amount = BigInt(parent.priceAtomic);
    if (amount < BigInt(pin.minBudgetAtomic) || amount > BigInt(pin.maxBudgetAtomic)) {
      throw new CommerceError({ code: "INVALID_AMOUNT", message: "The persisted parent quote is outside the standards-locked budget bounds." });
    }
  } catch (cause) {
    if (cause instanceof CommerceError) throw cause;
    throw new CommerceError({ code: "INVALID_AMOUNT", message: "The persisted parent quote is not a valid atomic budget.", cause });
  }
  return parent;
}

function taskDigest(task: string): string {
  // The canonical digest is computed by the commerce package before the SDK
  // call. The injected resolver must return the same persisted digest; this
  // small seam avoids accepting a client-claimed provider/task binding.
  return PostgresErc8183OperationRepository.requestDigest(task).toLowerCase();
}

/** Server-owned operation identity; request-body keys cannot create another hire. */
function serverHireIdempotencyKey(commerceJobId: string): string {
  return `t5-hire:${commerceJobId}`;
}

function jobKeyFor(adapter: Erc8183AltanaAdapter, jobId: string): Erc8183JobKey {
  return erc8183JobKeySchema.parse({
    chainId: adapter.pin.chainId,
    commerceContract: adapter.pin.commerceContract,
    jobId
  });
}

/**
 * Reconstruct only the public SDK parameters needed by a browser reload.
 * Operation context remains server-side and is never returned wholesale;
 * malformed or incomplete intent context fails closed.
 */
function browserDispatchFor(operation: Erc8183OperationRecord, adapter?: Erc8183AltanaAdapter, allowClaimed = false): CommerceBrowserDispatch | null {
  if (operation.status !== "awaiting_signature" && !(allowClaimed && operation.status === "unknown" && operation.transactionHash === null && operation.context?.dispatchClaimed === true)) return null;
  if (!allowClaimed && operation.context?.dispatchClaimed === true) return null;
  const parameters = operation.context?.parameters;
  const persistedStep = parameters?.eoaStep;
  if (persistedStep !== undefined) {
    const steps: readonly Erc8183EoaStep[] = ["create", "register", "set_budget", "approve", "fund", "settle", "dispute", "claim_refund"];
    if (typeof persistedStep !== "string" || !steps.includes(persistedStep as Erc8183EoaStep)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted browser EOA step is invalid.", nextAction: "manual_review" });
    if (operation.context?.signerAddress === undefined) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted browser EOA intent has no actor binding.", nextAction: "manual_review" });
    if (parameters?.connector !== "walletConnect") throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted browser EOA intent is not bound to the WalletConnect connector.", nextAction: "manual_review" });
    const step = persistedStep as Erc8183EoaStep;
    const contracts = adapter === undefined ? ERC8183_EOA_CONTRACTS : {
      commerceContract: adapter.pin.commerceContract,
      routerContract: adapter.routerContract,
      policyContract: adapter.policyContract,
      paymentToken: adapter.paymentToken
    };
    const call = buildErc8183EoaCall({
      chainId: operation.chainId,
      contracts,
      step,
      ...(typeof parameters?.providerAddress === "string" ? { providerAddress: parameters.providerAddress } : {}),
      ...(typeof parameters?.task === "string" ? { task: parameters.task } : {}),
      ...(typeof parameters?.budgetAtomic === "string" ? { budgetAtomic: parameters.budgetAtomic } : {}),
      ...(typeof parameters?.expiredAtUnix === "number" ? { expiredAtUnix: parameters.expiredAtUnix } : {}),
      ...(operation.jobId === null ? {} : { jobId: operation.jobId })
    });
    if (operation.context.to === undefined || operation.context.data === undefined || operation.context.valueAtomic !== "0" || operation.context.to.toLowerCase() !== call.to.toLowerCase() || operation.context.data.toLowerCase() !== call.data.toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted browser EOA calldata does not match the pinned contract or operation parameters.", nextAction: "manual_review" });
    const action = step === "settle" ? "settle" : step === "dispute" ? "dispute" : step === "claim_refund" ? "refund" : "hire";
    return commerceBrowserDispatchSchema.parse({
      operationId: operation.operationId,
      action,
      chainId: operation.chainId,
      actorAddress: operation.context.signerAddress,
      providerAddress: typeof parameters?.providerAddress === "string" ? parameters.providerAddress : null,
      task: typeof parameters?.task === "string" ? parameters.task : null,
      budgetAtomic: typeof parameters?.budgetAtomic === "string" ? parameters.budgetAtomic : null,
      deadlineSeconds: typeof parameters?.deadlineSeconds === "number" ? parameters.deadlineSeconds : null,
      jobId: operation.jobId,
      step,
      to: call.to,
      data: call.data,
      valueAtomic: "0"
    });
  }
  const action = operation.context?.sdkAction;
  if (action === "hire") {
    if (
      typeof parameters?.providerAddress !== "string" ||
      typeof parameters.task !== "string" ||
      typeof parameters.budgetAtomic !== "string"
    ) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted browser hire intent is incomplete.", nextAction: "manual_review" });
    if (operation.context?.signerAddress === undefined) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted browser hire intent has no actor binding.", nextAction: "manual_review" });
    return commerceBrowserDispatchSchema.parse({
      operationId: operation.operationId,
      action: "hire",
      chainId: operation.chainId,
      actorAddress: operation.context.signerAddress,
      providerAddress: parameters.providerAddress,
      task: parameters.task,
      budgetAtomic: parameters.budgetAtomic,
      deadlineSeconds: typeof parameters.deadlineSeconds === "number" ? parameters.deadlineSeconds : null,
      jobId: operation.jobId
    });
  }
  if (action === "settle" || action === "dispute") {
    if (operation.jobId === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted browser settlement intent has no protocol job ID.", nextAction: "manual_review" });
    if (operation.context?.signerAddress === undefined) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted browser settlement intent has no actor binding.", nextAction: "manual_review" });
    return commerceBrowserDispatchSchema.parse({
      operationId: operation.operationId,
      action,
      chainId: operation.chainId,
      actorAddress: operation.context.signerAddress,
      providerAddress: null,
      task: null,
      budgetAtomic: null,
      deadlineSeconds: null,
      jobId: operation.jobId
    });
  }
  return null;
}

export type CommerceHireCompositionResult = Erc8183OperationCoordinatorResult<Erc8183HireResult>;
export type CommerceSubmitCompositionResult = Erc8183OperationCoordinatorResult<Erc8183SubmitResult>;
export type CommerceSettleCompositionResult = Erc8183OperationCoordinatorResult<Erc8183SettleResult>;
export type CommerceRefundCompositionResult = Erc8183OperationCoordinatorResult<Erc8183ClaimRefundResult>;

export interface CommerceBrowserIntentResult {
  readonly operation: Erc8183OperationRecord;
  readonly replayed: boolean;
  readonly dispatch: CommerceBrowserDispatch | null;
  readonly read: Erc8183JobRead | null;
}

/**
 * Composed T4 service used by route handlers. Construction is deliberately
 * strict for the standards lock, persistent stores, and authenticated read
 * boundary. Mutation-only seams fail closed at their call site so status
 * reloads remain available without an Altana signer.
 */
export class Erc8183CommerceComposition {
  public readonly adapter: Erc8183AltanaAdapter;
  public readonly operations: PostgresErc8183OperationRepository;
  public readonly jobs: PostgresErc8183JobRepository;
  public readonly service: Erc8183CommerceService;
  public readonly reads: Erc8183CommerceReadService;
  public readonly marketplace: PostgresErc8183MarketplaceProjection;
  private readonly identityResolver: CommerceIdentityResolver;
  private readonly authorityResolver: CommerceAuthorityResolver | undefined;
  private readonly parentHireResolver: CommerceParentHireResolver;
  private readonly reservationResolver: PostgresCommerceReservationStore | undefined;

  public constructor(options: Erc8183CommerceCompositionOptions) {
    if (options.standardsLock === undefined || options.standardsLock === null) {
      throw invalidComposition("T4 production composition requires the authoritative standards.lock snapshot.", "verify_standards_lock");
    }
    assertPersistentPool(options.pool);
    if (options.identityResolver === undefined || typeof options.identityResolver.resolve !== "function") {
      throw invalidComposition("T4 production composition requires a server-authenticated read identity resolver.", "configure_auth_boundary");
    }
    this.identityResolver = options.identityResolver;
    this.authorityResolver = options.authorityResolver;
    this.adapter = new Erc8183AltanaAdapter({
      pin: options.pin,
      standardsLock: options.standardsLock,
      ...(options.developmentCanaryEnabled === undefined ? {} : { developmentCanaryEnabled: options.developmentCanaryEnabled }),
      ...(options.runtimeEnvironment === undefined ? {} : { runtimeEnvironment: options.runtimeEnvironment })
    });
    this.operations = new PostgresErc8183OperationRepository(options.pool);
    this.jobs = new PostgresErc8183JobRepository(options.pool);
    this.marketplace = new PostgresErc8183MarketplaceProjection(options.pool);
    this.reservationResolver = options.parentHireResolver instanceof PostgresCommerceReservationStore
      ? options.parentHireResolver
      : new PostgresCommerceReservationStore(options.pool, options.pin);
    this.parentHireResolver = options.parentHireResolver ?? this.reservationResolver;
    const serviceOptions: Erc8183CommerceServiceOptions = {
      adapter: this.adapter,
      operations: this.operations,
      approvals: this.jobs,
      jobs: this.jobs
    };
    this.service = new Erc8183CommerceService(serviceOptions);
    this.reads = new Erc8183CommerceReadService(this.jobs, this.operations);
  }

  private async identity(request: Request): Promise<AuthenticatedCommerceIdentity> {
    let identity: unknown;
    try {
      identity = await this.identityResolver.resolve(request);
    } catch (cause) {
      if (cause instanceof CommerceError || cause instanceof AppError) throw cause;
      throw new CommerceError({
        code: "UNAUTHORIZED_ACTOR",
        message: "The server-authenticated requester identity could not be resolved.",
        nextAction: "authenticate_actor",
        cause
      });
    }
    assertIdentityShape(identity);
    if (identity.chainId !== undefined && identity.chainId !== this.adapter.pin.chainId) throw new CommerceError({ code: "INVALID_CHAIN", message: "The authenticated requester session is not bound to the pinned commerce chain.", nextAction: "authenticate_actor" });
    return identity;
  }

  private async authority(request: Request, identity: AuthenticatedCommerceIdentity): Promise<Erc8183AltanaAuthority> {
    if (this.authorityResolver === undefined) throw commerceAuthorityBoundaryError();
    let authority: unknown;
    try {
      authority = await this.authorityResolver.resolve(request, identity);
    } catch (cause) {
      if (cause instanceof CommerceError) throw cause;
      throw new CommerceError({
        code: "UNAUTHORIZED_ACTOR",
        message: "The authenticated Altana execution authority could not be resolved.",
        nextAction: "authenticate_actor",
        cause
      });
    }
    assertAuthorityShape(authority);
    const execution = authorityExecutionAddress(authority).toLowerCase();
    if (identity.requesterAddress.toLowerCase() !== execution) {
      throw new CommerceError({
        code: "UNAUTHORIZED_ACTOR",
        message: "The server-authenticated requester does not match the Altana execution wallet.",
        nextAction: "authenticate_actor"
      });
    }
    return authority;
  }

  private async resolveParentHire(identity: AuthenticatedCommerceIdentity, input: {
    readonly commerceJobId: string;
    readonly task?: string;
    readonly budgetAtomic?: string;
  }): Promise<CommerceParentHireRecord> {
    if (this.parentHireResolver === undefined || typeof this.parentHireResolver.resolve !== "function") {
      throw invalidComposition(
        "T4 production composition requires a persistent parent-hire resolver before an ERC-8183 write can be prepared.",
        "configure_parent_hire_repository"
      );
    }
    let parent: CommerceParentHireRecord | null;
    try {
      const resolverInput: CommerceParentHireResolutionInput = {
        commerceJobId: input.commerceJobId,
        buyerUserId: identity.userId,
        chainId: this.adapter.pin.chainId,
        commerceContract: this.adapter.pin.commerceContract,
        paymentToken: this.adapter.pin.paymentToken,
        paymentDecimals: this.adapter.pin.paymentDecimals
      };
      parent = await this.parentHireResolver.resolve({
        ...resolverInput,
        ...(input.task === undefined ? {} : { task: input.task }),
        ...(input.budgetAtomic === undefined ? {} : { budgetAtomic: input.budgetAtomic })
      });
    } catch (cause) {
      if (cause instanceof CommerceError) throw cause;
      throw new CommerceError({
        code: "COMMERCE_DISABLED",
        message: "The persistent parent-hire authorization could not be resolved; the SDK write is disabled.",
        nextAction: "configure_parent_hire_repository",
        cause
      });
    }
    return assertParentHireAuthorization(parent, input, identity, this.adapter.pin);
  }

  /** Create a buyer-scoped quote/reservation without invoking a chain SDK. */
  public async createQuote(request: Request, input: { readonly agentIdentifier: string; readonly task: string }): Promise<CommerceQuoteSnapshot> {
    const identity = await this.identity(request);
    if (this.reservationResolver === undefined) {
      throw invalidComposition("T5 quote reservations require the persistent marketplace reservation store.", "configure_parent_hire_repository");
    }
    return this.reservationResolver.quote({
      buyerUserId: identity.userId,
      agentIdentifier: input.agentIdentifier,
      task: input.task
    });
  }

  public async status(request: Request, jobId: string): Promise<Erc8183JobRead> {
    const identity = await this.identity(request);
    const read = await this.reads.get(jobKeyFor(this.adapter, jobId));
    assertJobActor(read, identity.requesterAddress);
    return read;
  }

  public async hire(request: Request, input: {
    readonly idempotencyKey: string;
    readonly commerceJobId: string;
    /** Deprecated server-to-server assertion; browser requests omit it. */
    readonly task?: string;
    /** Deprecated server-to-server assertion; browser requests omit it. */
    readonly budgetAtomic?: string;
    readonly deadlineSeconds?: number | undefined;
  }): Promise<CommerceHireCompositionResult> {
    const identity = await this.identity(request);
    let parent = await this.resolveParentHire(identity, input);
    if (this.reservationResolver !== undefined) {
      await this.reservationResolver.claim({ commerceJobId: input.commerceJobId, buyerUserId: identity.userId });
      // Re-read after the row lock so listing freshness/expiry is checked on
      // the exact claimed snapshot, not only on the pre-lock authorization read.
      parent = await this.resolveParentHire(identity, input);
    }
    const authority = await this.authority(request, identity);
    const task = parent.task;
    if (task === undefined) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted quote has no task snapshot.", nextAction: "manual_review" });
    return this.service.hire({
      idempotencyKey: serverHireIdempotencyKey(input.commerceJobId),
      commerceJobId: input.commerceJobId,
      providerAddress: parent.providerAddress,
      task,
      budgetAtomic: parent.priceAtomic,
      providerBinding: parent.providerBinding,
      authority,
      requesterAddress: identity.requesterAddress,
      ...(input.deadlineSeconds === undefined ? {} : { deadlineSeconds: input.deadlineSeconds })
    });
  }

  /**
   * Authenticate and persist a hire intent, then hand its public parameters
   * to the browser. No Altana authority is resolved and no SDK call occurs.
   */
  public async prepareHireIntent(request: Request, input: {
    readonly idempotencyKey: string;
    readonly commerceJobId: string;
    /** Deprecated server-to-server assertion; browser requests omit it. */
    readonly task?: string;
    /** Deprecated server-to-server assertion; browser requests omit it. */
    readonly budgetAtomic?: string;
    readonly deadlineSeconds?: number | undefined;
  }): Promise<CommerceBrowserIntentResult> {
    const identity = await this.identity(request);
    const idempotencyKey = serverHireIdempotencyKey(input.commerceJobId);
    const replay = await this.replayPreparedEoaIntent(identity, idempotencyKey);
    if (replay !== null) return replay;
    let parent = await this.resolveParentHire(identity, input);
    if (this.reservationResolver !== undefined) {
      await this.reservationResolver.claim({ commerceJobId: input.commerceJobId, buyerUserId: identity.userId });
      // Re-read after the row lock so a quote/listing that changed during the
      // claim cannot become a browser-fundable operation.
      parent = await this.resolveParentHire(identity, input);
    }
    const task = parent.task;
    if (task === undefined) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted quote has no task snapshot.", nextAction: "manual_review" });
    const verifyNetwork = (this.adapter as Erc8183AltanaAdapter & { readonly verifyNetwork?: () => Promise<unknown> }).verifyNetwork;
    if (typeof verifyNetwork === "function") await verifyNetwork.call(this.adapter);
    const deadlineSeconds = input.deadlineSeconds ?? 1_800;
    const disputeWindow = typeof (this.adapter as Erc8183AltanaAdapter & { readDisputeWindow?: () => Promise<number> }).readDisputeWindow === "function"
      ? await (this.adapter as Erc8183AltanaAdapter & { readDisputeWindow: () => Promise<number> }).readDisputeWindow()
      : this.adapter.pin.minExpiryLeadSeconds;
    const expiredAtUnix = Math.floor(Date.now() / 1_000) + Math.max(disputeWindow, this.adapter.pin.minExpiryLeadSeconds) + deadlineSeconds;
    if (expiredAtUnix > Math.floor(Date.now() / 1_000) + this.adapter.pin.maxExpiryHorizonSeconds) throw new CommerceError({ code: "INVALID_JOB", message: "The requested hire expiry exceeds the standards-locked horizon.", nextAction: "reload_quote" });
    const prepared = this.service.prepareHireIntent({
      idempotencyKey,
      commerceJobId: input.commerceJobId,
      providerAddress: parent.providerAddress,
      task,
      budgetAtomic: parent.priceAtomic,
      providerBinding: parent.providerBinding,
      requesterAddress: identity.requesterAddress,
      deadlineSeconds,
      expiredAtUnix
    });
    const reservation = await this.service.reserveExternal({ operation: prepared, idempotencyKey });
    const job = reservation.operation.jobId === null ? null : await this.readWithoutActor(reservation.operation.jobId);
    return {
      operation: reservation.operation,
      replayed: reservation.replayed,
      dispatch: reservation.dispatchable ? browserDispatchFor(reservation.operation, this.adapter) : null,
      read: job
    };
  }

  public async submit(request: Request, jobId: string, input: {
    readonly idempotencyKey: string;
    readonly resultDigest: string;
    readonly chainDeliverable?: string | undefined;
    readonly deliverableUrl?: string | undefined;
    readonly manifest?: unknown | undefined;
    readonly optParams?: string | undefined;
    readonly providerBinding?: Erc8183ProviderBinding | undefined;
    readonly task?: Erc8183ProviderTask | undefined;
    readonly result?: Erc8183ProviderResult | undefined;
  }): Promise<CommerceSubmitCompositionResult> {
    const identity = await this.identity(request);
    const authority = await this.authority(request, identity);
    const submission = {
      jobId,
      resultDigest: input.resultDigest,
      authority,
      idempotencyKey: input.idempotencyKey,
      requesterAddress: identity.requesterAddress,
      ...(input.chainDeliverable === undefined ? {} : { chainDeliverable: input.chainDeliverable }),
      ...(input.deliverableUrl === undefined ? {} : { deliverableUrl: input.deliverableUrl }),
      ...(input.manifest === undefined ? {} : { manifest: input.manifest as Erc8183SubmitInput["manifest"] }),
      ...(input.optParams === undefined ? {} : { optParams: input.optParams }),
      ...(input.providerBinding === undefined ? {} : { providerBinding: input.providerBinding }),
      ...(input.task === undefined ? {} : { task: input.task }),
      ...(input.result === undefined ? {} : { result: input.result })
    } as unknown as Erc8183SubmitInput & { readonly idempotencyKey: string; readonly requesterAddress: string };
    return this.service.submit(submission);
  }

  public async approveOrDispute(request: Request, jobId: string, input: { readonly action: "approve" | "dispute"; readonly idempotencyKey: string; readonly resultDigest?: string | undefined }): Promise<CommerceBrowserIntentResult & { readonly action: "approve" | "dispute" }> {
    const identity = await this.identity(request);
    const jobKey = jobKeyFor(this.adapter, jobId);
    const current = await this.reads.get(jobKey);
    assertJobActor(current, identity.requesterAddress);
    if (input.action === "approve") {
      if (input.resultDigest === undefined) throw new CommerceError({ code: "INVALID_JOB", message: "Buyer approval requires the submitted local result digest.", nextAction: "inspect_result" });
      await this.service.approveResult({ jobKey, actorAddress: identity.requesterAddress, requesterAddress: identity.requesterAddress, resultDigest: input.resultDigest, nowUnix: Math.floor(Date.now() / 1_000) });
    }
    const prepared = await this.service.prepareSettleIntent({ idempotencyKey: input.idempotencyKey, requesterAddress: identity.requesterAddress, jobId, action: input.action });
    const reservation = await this.service.reserveExternal({ operation: prepared, idempotencyKey: input.idempotencyKey });
    return {
      action: input.action,
      operation: reservation.operation,
      replayed: reservation.replayed,
      dispatch: reservation.dispatchable ? browserDispatchFor(reservation.operation, this.adapter) : null,
      read: await this.reads.get(jobKey)
    };
  }

  /** Prepare a previously persisted approval for the browser-owned settle call. */
  public async settle(request: Request, jobId: string, idempotencyKey: string): Promise<CommerceBrowserIntentResult> {
    const identity = await this.identity(request);
    const prepared = await this.service.prepareSettleIntent({ idempotencyKey, requesterAddress: identity.requesterAddress, jobId, action: "approve" });
    const reservation = await this.service.reserveExternal({ operation: prepared, idempotencyKey });
    const job = reservation.operation.jobId === null ? null : await this.readWithoutActor(reservation.operation.jobId);
    return { operation: reservation.operation, replayed: reservation.replayed, dispatch: reservation.dispatchable ? browserDispatchFor(reservation.operation, this.adapter) : null, read: job };
  }

  private eoaStep(operation: Erc8183OperationRecord): Erc8183EoaStep | null {
    const value = operation.context?.parameters?.eoaStep;
    return typeof value === "string" && ["create", "register", "set_budget", "approve", "fund", "settle", "dispute", "claim_refund"].includes(value) ? value as Erc8183EoaStep : null;
  }

  private isEarlyEoaStep(step: Erc8183EoaStep): boolean {
    return step === "create" || step === "register" || step === "set_budget" || step === "approve";
  }

  private nextEoaStep(step: Erc8183EoaStep): Erc8183EoaStep | null {
    if (step === "create") return "register";
    if (step === "register") return "set_budget";
    if (step === "set_budget") return "approve";
    if (step === "approve") return "fund";
    return null;
  }

  private async optionalJob(jobId: string | null): Promise<Erc8183JobRead | null> {
    if (jobId === null) return null;
    try {
      return await this.readWithoutActor(jobId);
    } catch (cause) {
      if (cause instanceof CommerceError && ["UNKNOWN_JOB", "RECONCILIATION_REQUIRED"].includes(cause.code)) return null;
      throw cause;
    }
  }

  private async replayPreparedEoaIntent(identity: AuthenticatedCommerceIdentity, idempotencyKey: string): Promise<CommerceBrowserIntentResult | null> {
    const getByIdempotencyKey = (this.operations as PostgresErc8183OperationRepository & { readonly getByIdempotencyKey?: (key: string) => Promise<Erc8183OperationRecord | null> }).getByIdempotencyKey;
    if (typeof getByIdempotencyKey !== "function") return null;
    const existing = await getByIdempotencyKey.call(this.operations, idempotencyKey);
    if (existing === null || this.eoaStep(existing) === null) return null;
    if (existing.chainId !== this.adapter.pin.chainId || existing.commerceContract.toLowerCase() !== this.adapter.pin.commerceContract.toLowerCase()) throw new CommerceError({ code: "INVALID_CHAIN", message: "The persisted browser intent is not bound to the pinned commerce deployment.", nextAction: "manual_review" });
    if (existing.context?.signerAddress.toLowerCase() !== identity.requesterAddress.toLowerCase()) throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The authenticated requester does not match the persisted browser intent actor.", nextAction: "authenticate_actor" });
    return {
      operation: existing,
      replayed: true,
      dispatch: browserDispatchFor(existing, this.adapter),
      read: await this.optionalJob(existing.jobId)
    };
  }

  private async advanceEoa(operation: Erc8183OperationRecord, verified?: Awaited<ReturnType<Erc8183AltanaAdapter["verifyEoaReceipt"]>>): Promise<CommerceBrowserIntentResult> {
    const step = this.eoaStep(operation);
    if (step === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The browser operation is missing its persisted EOA step.", nextAction: "manual_review" });
    const nextStep = this.nextEoaStep(step);
    if (nextStep === null) {
      return { operation, replayed: true, dispatch: null, read: await this.optionalJob(operation.jobId ?? verified?.jobId ?? null) };
    }
    const parameters = operation.context?.parameters ?? {};
    const jobId = operation.jobId ?? verified?.jobId ?? null;
    if (jobId === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The next browser EOA step has no actual protocol job ID.", nextAction: "manual_review" });
    const commerceJobId = typeof parameters.commerceJobId === "string" && parameters.commerceJobId.trim() !== "" ? parameters.commerceJobId : operation.idempotencyKey;
    const idempotencyKey = `t5-eoa:${commerceJobId}:${nextStep}`;
    const prepared = this.service.prepareEoaStep({
      idempotencyKey,
      step: nextStep,
      requesterAddress: operation.context?.signerAddress ?? "",
      jobId,
      ...(typeof parameters.providerAddress === "string" ? { providerAddress: parameters.providerAddress } : {}),
      ...(typeof parameters.task === "string" ? { task: parameters.task } : {}),
      ...(typeof parameters.budgetAtomic === "string" ? { budgetAtomic: parameters.budgetAtomic } : {}),
      ...(typeof parameters.expiredAtUnix === "number" ? { expiredAtUnix: parameters.expiredAtUnix } : {}),
      ...(typeof parameters.deadlineSeconds === "number" ? { deadlineSeconds: parameters.deadlineSeconds } : {}),
      commerceJobId,
      ...(parameters.providerBinding === undefined ? {} : { providerBinding: erc8183ProviderBindingSchema.parse(parameters.providerBinding) })
    });
    const reservation = await this.service.reserveExternal({ operation: prepared, idempotencyKey });
    const next = reservation.operation;
    if (reservation.replayed && ["confirmed", "reconciled"].includes(next.status)) {
      if (["fund", "settle", "dispute", "claim_refund"].includes(nextStep)) return this.confirmEoa(next);
      return this.advanceEoa(next);
    }
    if (reservation.replayed && next.status === "submitted") return this.confirmEoa(next);
    return {
      operation: next,
      replayed: reservation.replayed,
      dispatch: reservation.dispatchable || (next.status === "awaiting_signature" && next.context?.dispatchClaimed !== true)
        ? browserDispatchFor(next, this.adapter)
        : null,
      read: await this.optionalJob(next.jobId)
    };
  }

  private async confirmEoa(operation: Erc8183OperationRecord, suppliedHash?: string): Promise<CommerceBrowserIntentResult> {
    const step = this.eoaStep(operation);
    if (step === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The browser operation is not an EOA operation.", nextAction: "manual_review" });
    // A durable confirmed receipt is sufficient evidence for the setup steps.
    // Do not re-read the job as OPEN after a later fund call has legitimately
    // advanced it; the fund/terminal steps retain receipt-based repair below.
    if (["confirmed", "reconciled"].includes(operation.status) && operation.jobId !== null && this.isEarlyEoaStep(step)) return this.advanceEoa(operation);
    const transactionHash = suppliedHash ?? operation.transactionHash;
    if (transactionHash === undefined || transactionHash === null) {
      if (operation.status === "awaiting_signature") return { operation, replayed: true, dispatch: browserDispatchFor(operation, this.adapter), read: await this.optionalJob(operation.jobId) };
      const unknown = await this.operations.markUnknown({ operationId: operation.operationId, failureCode: "EOA_TRANSACTION_HASH_MISSING" });
      return { operation: unknown, replayed: false, dispatch: null, read: await this.optionalJob(unknown.jobId) };
    }
    if (operation.transactionHash !== null && operation.transactionHash.toLowerCase() !== transactionHash.toLowerCase()) throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The browser operation is already bound to a different transaction hash.", nextAction: "manual_review" });
    let submitted = operation;
    if (operation.status === "awaiting_signature" || operation.status === "unknown") submitted = await this.operations.markSubmitted({ operationId: operation.operationId, transactionHash });
    try {
      const parameters = operation.context?.parameters ?? {};
      const verified = await this.adapter.verifyEoaReceipt({
        transactionHash: transactionHash as `0x${string}`,
        step,
        actorAddress: operation.context?.signerAddress ?? "",
        jobId: submitted.jobId,
        ...(typeof parameters.providerAddress === "string" ? { providerAddress: parameters.providerAddress } : {}),
        ...(typeof parameters.task === "string" ? { task: parameters.task } : {}),
        ...(typeof parameters.budgetAtomic === "string" ? { budgetAtomic: parameters.budgetAtomic } : {}),
        ...(typeof parameters.expiredAtUnix === "number" ? { expiredAtUnix: parameters.expiredAtUnix } : {})
      });
      const confirmed = submitted.status === "confirmed" || submitted.status === "reconciled"
        ? submitted
        : await this.operations.markReceipt({ operationId: operation.operationId, status: "confirmed", transactionHash: verified.receipt.transactionHash, blockNumber: verified.receipt.blockNumber.toString(10), blockHash: verified.receipt.blockHash, logIndex: verified.logIndex, failureCode: null });
      let current = confirmed;
      if (step === "create" && current.jobId === null) current = await this.operations.attachJobId({ operationId: current.operationId, jobId: verified.jobId });
      if (step === "fund") await this.service.persistEoaFunding(current, verified.job, verified.receipt);
      if (step === "settle") await this.service.persistEoaTerminal(current, verified.job, verified.receipt, "completed");
      if (step === "claim_refund") await this.service.persistEoaTerminal(current, verified.job, verified.receipt, "expired");
      return await this.advanceEoa(current, verified);
    } catch (cause) {
      if (cause instanceof CommerceError && cause.code === "TRANSACTION_UNKNOWN") {
        if (operation.status === "confirmed" || operation.status === "manual_review" || operation.status === "reconciled") return { operation, replayed: false, dispatch: null, read: await this.optionalJob(operation.jobId) };
        const unknown = await this.operations.markUnknown({ operationId: operation.operationId, failureCode: "EOA_RECEIPT_PENDING" });
        return { operation: unknown, replayed: false, dispatch: null, read: await this.optionalJob(unknown.jobId) };
      }
      if (cause instanceof CommerceError && cause.code === "TRANSACTION_REVERTED") {
        const receipt = await this.adapter.getTransactionReceipt(transactionHash as `0x${string}`);
        if (receipt !== null) {
          const reverted = await this.operations.markReceipt({ operationId: operation.operationId, status: "reverted", transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(10), blockHash: receipt.blockHash, failureCode: "TRANSACTION_REVERTED" });
          return { operation: reverted, replayed: false, dispatch: null, read: await this.optionalJob(reverted.jobId) };
        }
      }
      try { await this.operations.markManualReview({ operationId: operation.operationId, failureCode: cause instanceof CommerceError ? cause.code : "EOA_RECEIPT_VALIDATION_FAILED" }); } catch { /* preserve validation failure */ }
      throw cause;
    }
  }

  private async assertBrowserOperationActor(request: Request, operationId: string): Promise<Erc8183OperationRecord> {
    const identity = await this.identity(request);
    const existing = await this.operations.get(operationId);
    if (existing === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The requested commerce operation does not exist." });
    if (existing.context?.signerAddress === undefined || existing.context.signerAddress.toLowerCase() !== identity.requesterAddress.toLowerCase()) {
      throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The authenticated requester does not match the browser operation actor.", nextAction: "authenticate_actor" });
    }
    return existing;
  }

  /** Atomically claim one browser step immediately before wallet signing. */
  public async claimExternalDispatch(request: Request, operationId: string): Promise<CommerceBrowserIntentResult> {
    const existing = await this.assertBrowserOperationActor(request, operationId);
    if (this.eoaStep(existing) === null) throw new CommerceError({ code: "INVALID_JOB", message: "The legacy browser relay operation does not support WalletConnect dispatch claims.", nextAction: "reconcile_transaction" });
    const claimed = await this.operations.claimExternalDispatch({ operationId });
    return {
      operation: claimed.operation,
      replayed: !claimed.claimed,
      dispatch: claimed.claimed ? browserDispatchFor(claimed.operation, this.adapter, true) : null,
      read: await this.optionalJob(claimed.operation.jobId)
    };
  }

  /** Re-open a claimed step only after an explicit wallet rejection CAS. */
  public async releaseExternalDispatch(request: Request, operationId: string): Promise<CommerceBrowserIntentResult> {
    const existing = await this.assertBrowserOperationActor(request, operationId);
    if (this.eoaStep(existing) === null) throw new CommerceError({ code: "INVALID_JOB", message: "The legacy browser relay operation does not support WalletConnect dispatch rejection.", nextAction: "reconcile_transaction" });
    const released = await this.operations.releaseExternalDispatch({ operationId });
    return {
      operation: released.operation,
      replayed: !released.released,
      dispatch: released.released ? browserDispatchFor(released.operation, this.adapter) : null,
      read: await this.optionalJob(released.operation.jobId)
    };
  }

  /** Attach browser-reported calls/transaction identity and reconcile reads. */
  public async attachExternalExecution(request: Request, input: { readonly operationId: string; readonly callsId?: string | undefined; readonly transactionHash?: string | undefined }): Promise<CommerceBrowserIntentResult> {
    const existing = await this.assertBrowserOperationActor(request, input.operationId);
    if (this.eoaStep(existing) !== null) {
      if (input.transactionHash === undefined) {
        const unknown = existing.status === "awaiting_signature" || existing.status === "submitted"
          ? await this.operations.markUnknown({ operationId: existing.operationId, failureCode: "EOA_TRANSACTION_HASH_MISSING" })
          : existing;
        return { operation: unknown, replayed: false, dispatch: null, read: await this.optionalJob(unknown.jobId) };
      }
      return this.confirmEoa(existing, input.transactionHash);
    }
    if (input.callsId === undefined) throw new CommerceError({ code: "INVALID_JOB", message: "The legacy browser relay operation requires its public calls ID.", nextAction: "reconcile_transaction" });
    const result = await this.service.attachExternalExecution({
      operationId: input.operationId,
      callsId: input.callsId,
      ...(input.transactionHash === undefined ? {} : { transactionHash: input.transactionHash })
    });
    const job = result.operation.jobId === null ? null : await this.optionalJob(result.operation.jobId);
    return {
      operation: result.operation,
      replayed: result.replayed,
      dispatch: browserDispatchFor(result.operation, this.adapter),
      read: job
    };
  }

  /** Actor-bound reload endpoint for a browser-owned operation. */
  public async operationStatus(request: Request, operationId: string): Promise<CommerceBrowserIntentResult> {
    const identity = await this.identity(request);
    const operation = await this.operations.get(operationId);
    if (operation === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The requested commerce operation does not exist." });
    if (operation.context?.signerAddress === undefined || operation.context.signerAddress.toLowerCase() !== identity.requesterAddress.toLowerCase()) {
      throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The authenticated requester does not match the browser operation actor.", nextAction: "authenticate_actor" });
    }
    if (this.eoaStep(operation) !== null) {
      let current = operation;
      const step = this.eoaStep(operation);
      if (["confirmed", "reconciled"].includes(operation.status) && operation.jobId !== null && step !== null && this.isEarlyEoaStep(step)) return this.advanceEoa(operation);
      if (operation.transactionHash !== null && ["submitted", "unknown", "confirmed", "reconciled"].includes(operation.status)) {
        const result = await this.confirmEoa(operation);
        current = result.operation;
        return result;
      }
      if (operation.status === "confirmed" || operation.status === "reconciled") return this.advanceEoa(operation);
      return {
        operation: current,
        replayed: true,
        dispatch: current.status === "awaiting_signature" ? browserDispatchFor(current, this.adapter) : null,
        read: await this.optionalJob(current.jobId)
      };
    }
    let current = operation;
    // A browser noWait result is reconciled by this actor-bound reload path.
    // Only a bounded public relay/receipt read occurs; no SDK writer is called.
    if (operation.context?.callsId !== undefined && operation.context.callsId !== null && ["awaiting_signature", "submitted", "unknown"].includes(operation.status)) {
      try {
        const reconciled = await this.service.reconcile(operationId);
        current = reconciled.operation;
      } catch (cause) {
        if (!(cause instanceof CommerceError) || !["TRANSACTION_UNKNOWN", "RECONCILIATION_REQUIRED"].includes(cause.code)) throw cause;
        const latest = await this.operations.get(operationId);
        if (latest !== null) current = latest;
      }
    }
    const job = current.jobId === null ? null : await this.optionalJob(current.jobId);
    // A claimed EOA step is never dispatched again on reload. An unclaimed
    // intent is safe to show because no wallet send was authorized yet.
    return { operation: current, replayed: true, dispatch: null, read: job };
  }

  public async createReview(request: Request, input: { readonly commerceJobId: string; readonly idempotencyKey: string; readonly score: number; readonly comment: string }): Promise<{ readonly replayed: boolean; readonly review: Awaited<ReturnType<PostgresErc8183MarketplaceProjection["createReview"]>>["review"] }> {
    const identity = await this.identity(request);
    return this.marketplace.createReview({
      commerceJobId: input.commerceJobId,
      idempotencyKey: input.idempotencyKey,
      score: input.score,
      comment: input.comment,
      buyerUserId: identity.userId,
      buyerAddress: identity.requesterAddress
    });
  }

  public async refund(request: Request, jobId: string, idempotencyKey: string): Promise<CommerceBrowserIntentResult> {
    const identity = await this.identity(request);
    const current = await this.reads.get(jobKeyFor(this.adapter, jobId));
    if (current.job.terms.clientAddress.toLowerCase() !== identity.requesterAddress.toLowerCase()) throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "Only the authenticated buyer may claim this refund.", nextAction: "authenticate_actor" });
    if ((current.job.state !== "funded" && current.job.state !== "submitted") || current.job.terms.expiresAtUnix > Math.floor(Date.now() / 1_000)) throw new CommerceError({ code: "STALE_JOB", message: "A refund is available only for an unresolved funded job after the pinned protocol expiry.", nextAction: "wait_for_expiry" });
    const prepared = this.service.prepareEoaStep({ idempotencyKey, step: "claim_refund", requesterAddress: identity.requesterAddress, jobId, commerceJobId: jobId });
    const reservation = await this.service.reserveExternal({ operation: prepared, idempotencyKey });
    return {
      operation: reservation.operation,
      replayed: reservation.replayed,
      dispatch: reservation.dispatchable ? browserDispatchFor(reservation.operation, this.adapter) : null,
      read: current
    };
  }

  public async reconcile(request: Request, operationId: string): Promise<Erc8183OperationCoordinatorResult<unknown>> {
    const identity = await this.identity(request);
    // Authorize against the durable operation/job before touching the chain or
    // changing its reconciliation state. An unauthorized caller must not be
    // able to trigger a receipt read or repair another actor's operation.
    const existing = await this.operations.get(operationId);
    if (existing === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The requested commerce operation does not exist." });
    if (existing.context?.signerAddress === undefined) {
      throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The pending operation has no persisted execution-wallet binding.", nextAction: "manual_review" });
    }
    if (existing.context?.signerAddress !== undefined && existing.context.signerAddress.toLowerCase() !== identity.requesterAddress.toLowerCase()) {
      throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The authenticated requester does not match the operation execution wallet.", nextAction: "authenticate_actor" });
    }
    // Do not read the canonical projection before reconciliation. A confirmed
    // receipt may be the only surviving evidence after a projection write was
    // interrupted; the service must be allowed to rebuild it from that
    // verified receipt.
    if (this.eoaStep(existing) !== null) return (await this.confirmEoa(existing)) as unknown as Erc8183OperationCoordinatorResult<unknown>;
    const result = await this.service.reconcile(operationId);
    return result as Erc8183OperationCoordinatorResult<unknown>;
  }

  public async readWithoutActor(jobId: string): Promise<Erc8183JobRead> {
    return this.reads.get(jobKeyFor(this.adapter, jobId));
  }
}

/**
 * Production composition entry point. The explicit options make it
 * impossible for a route body or environment toggle to provide actor
 * authority, switch the standards lock, or choose a second transaction
 * writer.
 */
export function createProductionCommerceComposition(options: Erc8183CommerceCompositionOptions): Erc8183CommerceComposition {
  return new Erc8183CommerceComposition(options);
}

type LockRecord = Readonly<Record<string, unknown>>;

function lockRecord(value: unknown, label: string): LockRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidComposition(`The standards lock has no valid ${label} record.`, "verify_standards_lock");
  }
  return value as LockRecord;
}

/** Build the application ERC-8183 pin only from the checked-in lock. */
export function commercePinFromStandardsLock(lock: unknown): EnabledErc8183DeploymentPin {
  const root = lockRecord(lock, "root");
  const networks = lockRecord(root.networks, "networks");
  const network = lockRecord(networks["97"], "BSC testnet");
  const deployment = lockRecord(network.erc8183, "BSC testnet ERC-8183 deployment");
  const abiHashes = lockRecord(deployment.abiHashes, "ERC-8183 ABI hashes");
  const riskLimits = lockRecord(deployment.riskLimits, "ERC-8183 risk limits");
  return parseEnabledDeploymentPin({
    enabled: deployment.enabled,
    chainId: 97,
    specRevision: deployment.specRevision,
    commerceContract: deployment.commerceProxy,
    paymentToken: deployment.paymentToken,
    paymentDecimals: deployment.paymentDecimals,
    abiHash: abiHashes.commerce,
    evaluatorProfile: "verified-policy-v1",
    confirmationThreshold: 1,
    minExpiryLeadSeconds: 60,
    maxExpiryHorizonSeconds: 86_400,
    minBudgetAtomic: "1",
    maxBudgetAtomic: riskLimits.maxBudgetAtomic
  });
}

async function readCommerceStandardsLock(): Promise<unknown> {
  try {
    return JSON.parse(await readFile(new URL("../../../../config/standards.lock.json", import.meta.url), "utf8")) as unknown;
  } catch {
    throw invalidComposition("The checked-in standards lock could not be loaded.", "verify_standards_lock");
  }
}

/**
 * Compose the browser-safe T5 boundary. The request supplies only public
 * quote/action identifiers; identity and the parent quote are resolved from
 * the authenticated Postgres session and reservation store. No signer,
 * serialized session, authority object, provider, price, or lock can come
 * from request data. Browser signing remains an explicit external SDK call.
 */
export async function getCommerceComposition(): Promise<Erc8183CommerceComposition> {
  const nodeEnvironment = process.env.NODE_ENV === "production"
    ? "production"
    : process.env.NODE_ENV === "test"
      ? "test"
      : "development";
  if (
    nodeEnvironment === "production" ||
    process.env.T5_COMMERCE_LOCAL_ACTIVATION !== "true" ||
    process.env.T5_COMMERCE_DEVELOPMENT_CANARY_ENABLED !== "true"
  ) {
    return Promise.reject(invalidComposition(
      "ERC-8183 browser activation is limited to the explicitly enabled local development canary; the standards-lock release gate remains closed.",
      "enable_local_development_canary"
    ));
  }

  const standardsLock = await readCommerceStandardsLock();
  try {
    const pool = getCommerceAuthDatabasePool();
    return createProductionCommerceComposition({
      standardsLock,
      pin: commercePinFromStandardsLock(standardsLock),
      pool,
      identityResolver: { resolve: requireAuthenticatedCommerceIdentity },
      // Server-side signer/session authority is intentionally not wired for
      // T5. Mutating SDK calls are browser-owned; provider/refund workers must
      // use a separately authenticated authority boundary before enablement.
      developmentCanaryEnabled: process.env.T5_COMMERCE_DEVELOPMENT_CANARY_ENABLED === "true",
      runtimeEnvironment: nodeEnvironment
    });
  } catch (cause) {
    if (cause instanceof CommerceError) throw cause;
    throw invalidComposition("The authenticated commerce dependencies are unavailable.", "configure_auth_boundary");
  }
}

export type CommerceReadOperationStatus = Erc8183CommerceOperationStatus;
