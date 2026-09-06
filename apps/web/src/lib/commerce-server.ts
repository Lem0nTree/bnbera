/**
 * Server-only ERC-8183 application composition.
 *
 * This module is intentionally an adapter seam, not an authentication system:
 * the caller must provide a server-authenticated wallet/session resolver. The
 * current web app has no such resolver, so its default composition remains a
 * truthful, explicit blocker and cannot be enabled by request data.
 */
import {
  CommerceError,
  Erc8183AltanaAdapter,
  Erc8183CommerceReadService,
  Erc8183CommerceService,
  PostgresErc8183JobRepository,
  PostgresErc8183OperationRepository,
  erc8183JobKeySchema,
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
  type Erc8183HireResult,
  type Erc8183SettleResult,
  type Erc8183ClaimRefundResult
} from "@bnbera/agent-commerce";
import type { Erc8183SubmitInput } from "@bnbera/agent-commerce";

/** Stable blocker exposed by the current app until an auth/authority adapter exists. */
export const T4_AUTHORITY_BOUNDARY_BLOCKER = "T4_AUTHENTICATED_ALTANA_AUTHORITY_BOUNDARY_UNAVAILABLE" as const;

export function commerceAuthorityBoundaryError(): CommerceError {
  return new CommerceError({
    code: "COMMERCE_DISABLED",
    message: `${T4_AUTHORITY_BOUNDARY_BLOCKER}: no server-authenticated wallet/session resolver can supply an Altana execution authority.`,
    nextAction: "configure_auth_boundary"
  });
}

/**
 * The resolver is the only accepted source of request identity and execution
 * authority. It must validate the session/cookie server-side and return the
 * matching Altana SDK wallet or session in memory. No serialized session,
 * private key, or actor field is accepted by any API request body.
 */
export interface CommerceAuthorityResolver {
  resolve(request: Request): Promise<AuthenticatedCommerceActor>;
}

export interface AuthenticatedCommerceActor {
  readonly authenticated: true;
  readonly userId: string;
  readonly requesterAddress: string;
  readonly authority: Erc8183AltanaAuthority;
}

export interface Erc8183CommerceCompositionOptions {
  /** Checked-in standards.lock projection; never read from a request. */
  readonly standardsLock: unknown;
  /** Application terms pin, reviewed alongside standardsLock. */
  readonly pin: EnabledErc8183DeploymentPin;
  /** A persistent PostgreSQL pool; disposable/mocked pools are for tests only. */
  readonly pool: Erc8183OperationQueryPool;
  /** Server-authenticated authority resolver. Required in every environment. */
  readonly authorityResolver: CommerceAuthorityResolver;
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

function assertActorShape(actor: unknown): asserts actor is AuthenticatedCommerceActor {
  if (typeof actor !== "object" || actor === null) throw commerceAuthorityBoundaryError();
  const value = actor as Partial<AuthenticatedCommerceActor>;
  if (
    value.authenticated !== true ||
    typeof value.userId !== "string" ||
    value.userId.trim() === "" ||
    typeof value.requesterAddress !== "string" ||
    value.authority === undefined ||
    typeof value.authority !== "object" ||
    value.authority === null
  ) throw commerceAuthorityBoundaryError();
  try {
    const executionAddress = authorityExecutionAddress(value.authority as Erc8183AltanaAuthority);
    if (typeof executionAddress !== "string" || executionAddress.trim() === "") throw new Error("missing execution address");
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

function jobKeyFor(adapter: Erc8183AltanaAdapter, jobId: string): Erc8183JobKey {
  return erc8183JobKeySchema.parse({
    chainId: adapter.pin.chainId,
    commerceContract: adapter.pin.commerceContract,
    jobId
  });
}

export type CommerceHireCompositionResult = Erc8183OperationCoordinatorResult<Erc8183HireResult>;
export type CommerceSubmitCompositionResult = Erc8183OperationCoordinatorResult<Erc8183SubmitResult>;
export type CommerceSettleCompositionResult = Erc8183OperationCoordinatorResult<Erc8183SettleResult>;
export type CommerceRefundCompositionResult = Erc8183OperationCoordinatorResult<Erc8183ClaimRefundResult>;

/**
 * Composed T4 service used by route handlers. Construction is deliberately
 * strict: missing lock, pool, or authority boundary prevents the app from
 * reaching the Altana SDK at all.
 */
export class Erc8183CommerceComposition {
  public readonly adapter: Erc8183AltanaAdapter;
  public readonly operations: PostgresErc8183OperationRepository;
  public readonly jobs: PostgresErc8183JobRepository;
  public readonly service: Erc8183CommerceService;
  public readonly reads: Erc8183CommerceReadService;
  private readonly authorityResolver: CommerceAuthorityResolver;

  public constructor(options: Erc8183CommerceCompositionOptions) {
    if (options.authorityResolver === undefined || typeof options.authorityResolver.resolve !== "function") throw commerceAuthorityBoundaryError();
    if (options.standardsLock === undefined || options.standardsLock === null) {
      throw invalidComposition("T4 production composition requires the authoritative standards.lock snapshot.", "verify_standards_lock");
    }
    assertPersistentPool(options.pool);
    this.authorityResolver = options.authorityResolver;
    this.adapter = new Erc8183AltanaAdapter({
      pin: options.pin,
      standardsLock: options.standardsLock,
      ...(options.developmentCanaryEnabled === undefined ? {} : { developmentCanaryEnabled: options.developmentCanaryEnabled }),
      ...(options.runtimeEnvironment === undefined ? {} : { runtimeEnvironment: options.runtimeEnvironment })
    });
    this.operations = new PostgresErc8183OperationRepository(options.pool);
    this.jobs = new PostgresErc8183JobRepository(options.pool);
    const serviceOptions: Erc8183CommerceServiceOptions = {
      adapter: this.adapter,
      operations: this.operations,
      approvals: this.jobs,
      jobs: this.jobs
    };
    this.service = new Erc8183CommerceService(serviceOptions);
    this.reads = new Erc8183CommerceReadService(this.jobs, this.operations);
  }

  private async actor(request: Request): Promise<AuthenticatedCommerceActor> {
    let actor: unknown;
    try {
      actor = await this.authorityResolver.resolve(request);
    } catch (cause) {
      if (cause instanceof CommerceError) throw cause;
      throw new CommerceError({
        code: "UNAUTHORIZED_ACTOR",
        message: "The authenticated Altana execution authority could not be resolved.",
        nextAction: "authenticate_actor",
        cause
      });
    }
    assertActorShape(actor);
    const execution = authorityExecutionAddress(actor.authority).toLowerCase();
    if (actor.requesterAddress.toLowerCase() !== execution) {
      throw new CommerceError({
        code: "UNAUTHORIZED_ACTOR",
        message: "The server-authenticated requester does not match the Altana execution wallet.",
        nextAction: "authenticate_actor"
      });
    }
    return actor;
  }

  public async status(request: Request, jobId: string): Promise<Erc8183JobRead> {
    const actor = await this.actor(request);
    const read = await this.reads.get(jobKeyFor(this.adapter, jobId));
    assertJobActor(read, actor.requesterAddress);
    return read;
  }

  public async hire(request: Request, input: {
    readonly idempotencyKey: string;
    readonly commerceJobId: string;
    readonly providerAddress: string;
    readonly task: string;
    readonly budgetAtomic: string;
    readonly deadlineSeconds?: number | undefined;
    readonly providerBinding: Erc8183ProviderBinding;
  }): Promise<CommerceHireCompositionResult> {
    const actor = await this.actor(request);
    return this.service.hire({
      idempotencyKey: input.idempotencyKey,
      commerceJobId: input.commerceJobId,
      providerAddress: input.providerAddress,
      task: input.task,
      budgetAtomic: input.budgetAtomic,
      providerBinding: input.providerBinding,
      authority: actor.authority,
      requesterAddress: actor.requesterAddress,
      ...(input.deadlineSeconds === undefined ? {} : { deadlineSeconds: input.deadlineSeconds })
    });
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
    const actor = await this.actor(request);
    const submission = {
      jobId,
      resultDigest: input.resultDigest,
      authority: actor.authority,
      idempotencyKey: input.idempotencyKey,
      requesterAddress: actor.requesterAddress,
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

  public async approveOrDispute(request: Request, jobId: string, input: { readonly action: "approve" | "dispute"; readonly idempotencyKey: string; readonly resultDigest?: string | undefined }): Promise<{ readonly action: "approve" | "dispute"; readonly operation: CommerceSettleCompositionResult["operation"] | null; readonly replayed: boolean; readonly read: Erc8183JobRead }> {
    const actor = await this.actor(request);
    const jobKey = jobKeyFor(this.adapter, jobId);
    const current = await this.reads.get(jobKey);
    assertJobActor(current, actor.requesterAddress);
    if (input.action === "approve") {
      if (input.resultDigest === undefined) throw new CommerceError({ code: "INVALID_JOB", message: "Buyer approval requires the submitted local result digest.", nextAction: "inspect_result" });
      const approval = await this.service.approveResult({ jobKey, actorAddress: actor.requesterAddress, requesterAddress: actor.requesterAddress, resultDigest: input.resultDigest, nowUnix: Math.floor(Date.now() / 1_000) }) as { readonly replayed: boolean };
      return { action: "approve", operation: null, replayed: approval.replayed, read: await this.reads.get(jobKey) };
    }
    const result = await this.service.settle({ idempotencyKey: input.idempotencyKey, authority: actor.authority, requesterAddress: actor.requesterAddress, jobId, action: "dispute" });
    return { action: "dispute", operation: result.operation, replayed: result.replayed, read: await this.reads.get(jobKey) };
  }

  public async settle(request: Request, jobId: string, idempotencyKey: string): Promise<CommerceSettleCompositionResult> {
    const actor = await this.actor(request);
    return this.service.settle({ idempotencyKey, authority: actor.authority, requesterAddress: actor.requesterAddress, jobId, action: "approve" });
  }

  public async refund(request: Request, jobId: string, idempotencyKey: string): Promise<CommerceRefundCompositionResult> {
    const actor = await this.actor(request);
    return this.service.claimRefund({ idempotencyKey, authority: actor.authority, requesterAddress: actor.requesterAddress, jobId });
  }

  public async reconcile(request: Request, operationId: string): Promise<Erc8183OperationCoordinatorResult<unknown>> {
    const actor = await this.actor(request);
    // Authorize against the durable operation/job before touching the chain or
    // changing its reconciliation state. An unauthorized caller must not be
    // able to trigger a receipt read or repair another actor's operation.
    const existing = await this.operations.get(operationId);
    if (existing === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The requested commerce operation does not exist." });
    if (existing.jobId === null && existing.context?.signerAddress === undefined) {
      throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The pending operation has no persisted execution-wallet binding.", nextAction: "manual_review" });
    }
    if (existing.context?.signerAddress !== undefined && existing.context.signerAddress.toLowerCase() !== actor.requesterAddress.toLowerCase()) {
      throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The authenticated requester does not match the operation execution wallet.", nextAction: "authenticate_actor" });
    }
    if (existing.jobId !== null) {
      const read = await this.reads.get(jobKeyFor(this.adapter, existing.jobId));
      assertJobActor(read, actor.requesterAddress);
    }
    const result = await this.service.reconcile(operationId);
    if (result.operation.jobId !== null) {
      const read = await this.reads.get(jobKeyFor(this.adapter, result.operation.jobId));
      assertJobActor(read, actor.requesterAddress);
    }
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

/**
 * Current web wiring has no authenticated session/Altana authority adapter.
 * Route handlers call this function and return its stable 503 blocker. T6
 * may later supply a resolver to createProductionCommerceComposition without
 * changing the API request contract.
 */
export function getCommerceComposition(): Promise<Erc8183CommerceComposition> {
  return Promise.reject(commerceAuthorityBoundaryError());
}

export type CommerceReadOperationStatus = Erc8183CommerceOperationStatus;
