/**
 * Operator-only ERC-8183 canary.
 *
 * The write path is intentionally small: the Altana SDK is the only
 * transaction writer, while BNBEra persists an idempotent operation and the
 * canonical job projection in a fresh disposable PostgreSQL database. There
 * is no simulated chain or substitute SDK in this command.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  BNB_TESTNET,
  createClient,
  encodeErc8183Manifest,
  erc8183Addresses,
  erc8183ManifestHash,
  signerFromPrivateKey,
  verifyErc8183ManifestText,
  type Erc8183DeliverableManifest,
  type NetworkConfig,
  type Signer,
  type Wallet
} from "@altananetwork/sdk";
import { createPublicClient, http, type Address, type Hex } from "viem";

import {
  Erc8183AltanaAdapter,
  Erc8183CommerceReadService,
  Erc8183CommerceService,
  PostgresErc8183JobRepository,
  PostgresErc8183OperationRepository,
  createHealthFactorResult,
  createHealthFactorTask,
  erc8183ProviderBindingSchema,
  parseEnabledDeploymentPin,
  type Erc8183AltanaAuthority,
  type Erc8183JobKey,
  type Erc8183OnchainJob,
  type Erc8183OperationQueryPool,
  type Erc8183ProviderBinding
} from "../packages/agent-commerce/src/index.ts";
import { createDb, migrateDb } from "../packages/db/src/client.ts";

const CHAIN_ID = 97 as const;
const MAX_BUDGET_ATOMIC = "10000000000000000"; // 0.01 U at 18 decimals.
const DEFAULT_BUDGET_ATOMIC = "1000000000000000"; // 0.001 U canary budget.
const DEFAULT_TASK = "Read the Venus health factor for the canary account and return the ratio.";
const CANARY_ACCOUNT = "0x0000000000000000000000000000000000000042" as Address;
const DATABASE_PREFIX = "bnbera_t4_canary_";
const DISPUTE_WINDOW_FLOOR_SECONDS = 900;
const FINALITY_BUFFER_SECONDS = 30;
const RECONCILIATION_TIMEOUT_SECONDS = 900;

export type CanaryMode = "dry-run" | "read-only" | "write";

export interface CanaryFlags {
  readonly mode: CanaryMode;
  readonly chainId: number | null;
  readonly developmentCanary: boolean;
  readonly skipDatabase: boolean;
  readonly help: boolean;
}

export interface CanaryActor {
  readonly role: "buyer" | "provider";
  readonly eoa: Address;
  readonly wallet: Wallet;
  readonly signer: Signer;
}

export interface CanaryCheck {
  readonly status: "pass" | "blocked" | "skipped";
  readonly evidence: "deterministic" | "disposable-db" | "live-read-only";
  readonly detail?: string;
}

export interface CanaryReport {
  readonly ok: boolean;
  readonly mode: CanaryMode;
  readonly network: 97;
  readonly writesBroadcast: boolean;
  readonly checks: Readonly<Record<string, CanaryCheck>>;
  readonly disposableDatabase: CanaryCheck;
  readonly actorChecks: Readonly<Record<string, CanaryCheck>>;
  /** Public transaction/job evidence only; never signer material or URLs with credentials. */
  readonly evidence?: Readonly<Record<string, string | number>>;
  readonly blocker?: string;
}

class CanaryError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "CanaryError";
  }
}

function check(status: CanaryCheck["status"], evidence: CanaryCheck["evidence"], detail?: string): CanaryCheck {
  return detail === undefined ? { status, evidence } : { status, evidence, detail };
}

function assertCondition(condition: boolean, code: string): asserts condition {
  if (!condition) throw new CanaryError(code);
}

function errorCode(error: unknown): string {
  if (error instanceof CanaryError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) {
    const value = String((error as { readonly code?: unknown }).code ?? "UNKNOWN");
    return /^[A-Z0-9_]{1,64}$/u.test(value) ? value : "UNKNOWN";
  }
  return "UNKNOWN";
}

function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1_000);
}

/** Parse only explicit operator flags. Write is never implicit. */
export function parseCanaryArgs(args: readonly string[]): CanaryFlags {
  let mode: CanaryMode = "dry-run";
  let modeSelected = false;
  let chainId: number | null = null;
  let developmentCanary = false;
  let skipDatabase = false;
  let help = false;
  for (const arg of args) {
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--dry-run" || arg === "--read-only" || arg === "--write") {
      const next = arg.slice(2) as CanaryMode;
      if (modeSelected && mode !== next) throw new CanaryError("CANARY_MODE_CONFLICT");
      mode = next;
      modeSelected = true;
      continue;
    }
    if (arg === "--development-canary") {
      developmentCanary = true;
      continue;
    }
    if (arg === "--skip-db") {
      skipDatabase = true;
      continue;
    }
    if (arg.startsWith("--network=")) {
      if (arg.slice("--network=".length) !== "97") throw new CanaryError("NETWORK_MUST_BE_97");
      chainId = CHAIN_ID;
      continue;
    }
    throw new CanaryError("UNKNOWN_CANARY_FLAG");
  }
  return { mode, chainId, developmentCanary, skipDatabase, help };
}

function assertOperatorFlags(flags: CanaryFlags): void {
  if (flags.chainId !== CHAIN_ID) throw new CanaryError("EXPLICIT_CHAIN_97_REQUIRED");
  if (!flags.developmentCanary) throw new CanaryError("EXPLICIT_DEVELOPMENT_CANARY_REQUIRED");
  if (flags.mode === "write" && flags.skipDatabase) throw new CanaryError("WRITE_REQUIRES_DISPOSABLE_DATABASE");
  if (flags.mode === "write" && (process.env.T4_CANARY_GO !== "true" || process.env.T4_CANARY_BROADCAST !== "true")) {
    throw new CanaryError("COORDINATOR_GO_AND_BROADCAST_ACK_REQUIRED");
  }
}

/** Resolve a configured private-key actor without ever returning the key. */
export function resolveCanaryActor(input: {
  readonly role: "buyer" | "provider";
  readonly privateKeyName: "WALLET_PRIVATE_KEY" | "WALLET2_PRIVATE_KEY";
  readonly addressName: "WALLET_ADDRESS" | "WALLET2_ADDRESS";
  readonly required: boolean;
}): CanaryActor | null {
  const privateKey = nonEmptyEnv(input.privateKeyName);
  const configuredAddress = nonEmptyEnv(input.addressName);
  if (privateKey === undefined && configuredAddress === undefined) {
    if (input.required) throw new CanaryError(`${input.role.toUpperCase()}_ACTOR_CONFIG_REQUIRED`);
    return null;
  }
  if (privateKey === undefined || configuredAddress === undefined) {
    throw new CanaryError(`${input.role.toUpperCase()}_ACTOR_CONFIG_REQUIRED`);
  }
  let signer: Signer;
  try {
    const normalizedPrivateKey = /^0x/iu.test(privateKey) ? `0x${privateKey.slice(2)}` : `0x${privateKey}`;
    if (!/^0x[0-9a-f]{64}$/iu.test(normalizedPrivateKey)) throw new Error("private key");
    signer = signerFromPrivateKey(normalizedPrivateKey as Hex);
  } catch {
    throw new CanaryError(`${input.role.toUpperCase()}_PRIVATE_KEY_INVALID`);
  }
  let expected: Address;
  try {
    if (!/^0x[0-9a-f]{40}$/iu.test(configuredAddress)) throw new Error("address");
    expected = configuredAddress.toLowerCase() as Address;
  } catch {
    throw new CanaryError(`${input.role.toUpperCase()}_ADDRESS_INVALID`);
  }
  if (signer.address.toLowerCase() !== expected.toLowerCase()) {
    throw new CanaryError(`${input.role.toUpperCase()}_EOA_ADDRESS_MISMATCH`);
  }
  return { role: input.role, eoa: signer.address, wallet: { address: signer.address }, signer };
}

type StandardsLock = Record<string, unknown>;

async function readStandardsLock(): Promise<StandardsLock> {
  const path = fileURLToPath(new URL("../config/standards.lock.json", import.meta.url));
  return JSON.parse(await readFile(path, "utf8")) as StandardsLock;
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CanaryError(code);
  return value as Record<string, unknown>;
}

function deploymentFromLock(lock: StandardsLock): Record<string, unknown> {
  const networks = record(lock.networks, "STANDARDS_LOCK_NETWORKS_MISSING");
  const network = record(networks["97"], "STANDARDS_LOCK_CHAIN_97_MISSING");
  return record(network.erc8183, "STANDARDS_LOCK_ERC8183_MISSING");
}

/** Build the application pin solely from the checked-in standards lock. */
export function canaryPin(lock: StandardsLock) {
  const deployment = deploymentFromLock(lock);
  const abiHashes = record(deployment.abiHashes, "STANDARDS_LOCK_ABI_MISSING");
  const riskLimits = record(deployment.riskLimits, "STANDARDS_LOCK_RISK_LIMITS_MISSING");
  return parseEnabledDeploymentPin({
    enabled: deployment.enabled,
    chainId: CHAIN_ID,
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

function canaryRunId(): string {
  const value = nonEmptyEnv("T4_CANARY_RUN_ID") ?? randomUUID().replaceAll("-", "").slice(0, 20);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value)) throw new CanaryError("T4_CANARY_RUN_ID_INVALID");
  return value;
}

function canaryBudget(): string {
  const value = nonEmptyEnv("T4_CANARY_BUDGET_ATOMIC") ?? DEFAULT_BUDGET_ATOMIC;
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) throw new CanaryError("T4_CANARY_BUDGET_INVALID");
  const amount = BigInt(value);
  if (amount < 1n || amount > BigInt(MAX_BUDGET_ATOMIC)) throw new CanaryError("T4_CANARY_BUDGET_OUT_OF_BOUNDS");
  return amount.toString(10);
}

function boundedDatabaseUrl(value: string): URL {
  let parsed: URL;
  try { parsed = new URL(value.trim()); } catch { throw new CanaryError("DATABASE_URL_INVALID"); }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new CanaryError("DATABASE_URL_INVALID");
  parsed.searchParams.set("connection_timeout", "5");
  parsed.searchParams.set("query_timeout", "10000");
  parsed.searchParams.set("statement_timeout", "10000");
  parsed.searchParams.set("lock_timeout", "10000");
  parsed.searchParams.set("idle_in_transaction_session_timeout", "10000");
  return parsed;
}

function databaseUrlFor(base: URL, name: string): string {
  const parsed = new URL(base.toString());
  parsed.pathname = `/${encodeURIComponent(name)}`;
  return parsed.toString();
}

function quoteIdentifier(value: string): string {
  if (!new RegExp(`^${DATABASE_PREFIX}[a-z0-9_]+$`, "u").test(value)) throw new CanaryError("DISPOSABLE_DATABASE_NAME_INVALID");
  return `"${value}"`;
}

interface DisposableDatabase {
  readonly base: URL;
  readonly name: string;
  readonly target: string;
}

async function createDisposableDatabase(rawUrl: string, ssl: boolean): Promise<DisposableDatabase> {
  const base = boundedDatabaseUrl(rawUrl);
  const retainedName = decodeURIComponent(base.pathname.replace(/^\//u, ""));
  const name = `${DATABASE_PREFIX}${randomUUID().replaceAll("-", "")}`;
  assertCondition(name !== retainedName, "DISPOSABLE_DATABASE_COLLIDES_WITH_RETAINED");
  const admin = createDb(databaseUrlFor(base, "postgres"), { ssl }).pool;
  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
  } catch {
    await admin.end();
    throw new CanaryError("DISPOSABLE_DATABASE_CREATE_FAILED");
  }
  await admin.end();
  const target = databaseUrlFor(base, name);
  try {
    await migrateDb(target, { ssl });
    return { base, name, target };
  } catch {
    const cleanup = createDb(databaseUrlFor(base, "postgres"), { ssl }).pool;
    try { await cleanup.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE)`); } finally { await cleanup.end(); }
    throw new CanaryError("DISPOSABLE_DATABASE_MIGRATION_FAILED");
  }
}

async function dropDisposableDatabase(database: DisposableDatabase, ssl: boolean): Promise<void> {
  const cleanup = createDb(databaseUrlFor(database.base, "postgres"), { ssl }).pool;
  try {
    await cleanup.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database.name)} WITH (FORCE)`);
  } finally {
    await cleanup.end();
  }
}

async function closePool(pool: { end(): Promise<void> }): Promise<void> {
  try { await pool.end(); } catch { /* preserve the canary failure */ }
}

interface SeededParent {
  readonly commerceJobId: string;
  readonly binding: Erc8183ProviderBinding;
  readonly taskDigest: string;
}

/** Insert the smallest FK-valid marketplace parent needed by the commerce projection. */
async function seedParent(input: {
  readonly pool: { query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly T[]; readonly rowCount?: number | null }> };
  readonly pin: ReturnType<typeof canaryPin>;
  readonly buyerAddress: Address;
  readonly providerAddress: Address;
  readonly task: string;
  readonly budgetAtomic: string;
  readonly runId: string;
}): Promise<SeededParent> {
  const sdkAddresses = erc8183Addresses(CHAIN_ID);
  const identityId = randomUUID();
  const agentRecordId = randomUUID();
  const identityAgentId = BigInt(`0x${randomUUID().replaceAll("-", "")}`).toString(10);
  const versionId = randomUUID();
  const commerceJobId = randomUUID();
  const binding = erc8183ProviderBindingSchema.parse({
    identity: { namespace: "eip155", chainId: CHAIN_ID, identityRegistry: sdkAddresses.registry, agentId: identityAgentId },
    agentVersionId: versionId,
    agentVersion: 1
  });
  const taskDigest = PostgresErc8183OperationRepository.requestDigest(input.task);
  const now = new Date();
  await input.pool.query(`
    INSERT INTO erc8004_identities (id, namespace, chain_id, identity_registry, agent_id, owner_address, agent_wallet)
    VALUES ($1, 'eip155', $2, $3, $4, $5, $5)
  `, [identityId, CHAIN_ID, binding.identity.identityRegistry, binding.identity.agentId, input.providerAddress]);
  await input.pool.query(`
    INSERT INTO agents (
      id, identity_id, origin_type, claim_status, verification_status, runtime_status,
      authority_status, listing_status, category, execution_wallet, wallet_provider
    ) VALUES ($1, $2, 'manual_import', 'unclaimed', 'pending', 'unavailable', 'none', 'draft', 'health-factor', $3, 'external')
  `, [agentRecordId, identityId, input.providerAddress]);
  await input.pool.query(`
    INSERT INTO agent_versions (id, agent_id, version, public_metadata, capability_manifest, pricing_manifest)
    VALUES ($1, $2, 1, $3, $4, $5)
  `, [versionId, agentRecordId,
    { name: "T4 disposable health-factor provider", description: "Deterministic health-factor canary provider." },
    { capabilities: ["health_factor_monitor"], source: "disposable_canary_fixture" },
    { protocol: "erc8183", chainId: CHAIN_ID, paymentToken: input.pin.paymentToken, priceAtomic: input.budgetAtomic }]);
  await input.pool.query(`UPDATE agents SET current_version_id = $1 WHERE id = $2`, [versionId, agentRecordId]);
  await input.pool.query(`
    INSERT INTO commerce_jobs (id, erc8183_job_id, buyer_user_id, provider_agent_id, quote, price, task_input_digest, status, "createdAt", "updatedAt")
    VALUES ($1, $2, NULL, $3, $4, $5, $6, 'draft', $7, $7)
  `, [commerceJobId, `t4-canary-pending-${input.runId}`, agentRecordId, {
    protocol: "erc8183",
    chainId: CHAIN_ID,
    commerceContract: input.pin.commerceContract,
    paymentToken: input.pin.paymentToken,
    paymentDecimals: input.pin.paymentDecimals,
    buyerAddress: input.buyerAddress,
    providerAddress: input.providerAddress,
    providerBinding: binding,
    priceAtomic: input.budgetAtomic
  }, input.budgetAtomic, taskDigest, now]);
  const row = await input.pool.query<{ readonly id: string; readonly status: string; readonly task_input_digest: string }>(
    `SELECT id, status, task_input_digest FROM commerce_jobs WHERE id = $1`, [commerceJobId]);
  assertCondition(row.rows[0]?.id === commerceJobId && row.rows[0].status === "draft" && row.rows[0].task_input_digest === taskDigest, "PARENT_COMMERCE_ROW_INVALID");
  return { commerceJobId, binding, taskDigest };
}

async function updateParent(pool: { query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly T[]; readonly rowCount?: number | null }> }, input: {
  readonly commerceJobId: string;
  readonly protocolJobId?: string;
  readonly status: "funded" | "submitted" | "settled";
  readonly fundingTransactionHash?: string | null;
  readonly fulfillmentTransactionHash?: string | null;
  readonly settlementTransactionHash?: string | null;
}): Promise<void> {
  await pool.query(`
    UPDATE commerce_jobs
    SET erc8183_job_id = COALESCE($2, erc8183_job_id), status = $3,
        funding_transaction_hash = COALESCE($4, funding_transaction_hash),
        fulfillment_transaction_hash = COALESCE($5, fulfillment_transaction_hash),
        settlement_transaction_hash = COALESCE($6, settlement_transaction_hash),
        "updatedAt" = now()
    WHERE id = $1
  `, [input.commerceJobId, input.protocolJobId ?? null, input.status, input.fundingTransactionHash ?? null, input.fulfillmentTransactionHash ?? null, input.settlementTransactionHash ?? null]);
}

const UNKNOWN_SMOKE_CALLS_ID = `0x${"a".repeat(64)}` as Hex;

/**
 * Exercise the unknown-outcome guard without broadcasting anything. The fake
 * adapter returns the same relay-style pending result every time; the first
 * call must persist `unknown`, and replaying its idempotency key must stop
 * before the adapter is invoked again. This is intentionally run only in the
 * disposable database used by the canary.
 */
async function runUnknownOutcomeSmoke(input: {
  readonly pool: Erc8183OperationQueryPool;
  readonly pin: ReturnType<typeof canaryPin>;
  readonly providerBinding: Erc8183ProviderBinding;
}): Promise<void> {
  const buyer = "0x1111111111111111111111111111111111111111" as Address;
  const provider = "0x2222222222222222222222222222222222222222" as Address;
  let adapterCalls = 0;
  const adapter = {
    pin: input.pin,
    hire: async () => {
      adapterCalls += 1;
      return {
        callsId: UNKNOWN_SMOKE_CALLS_ID,
        status: "PENDING" as const,
        transactionHash: null,
        jobId: "42",
        budgetAtomic: DEFAULT_BUDGET_ATOMIC,
        expiredAtUnix: nowUnix() + 3_600,
        job: null,
        receipt: null
      };
    }
  } as unknown as Erc8183AltanaAdapter;
  const operations = new PostgresErc8183OperationRepository(input.pool);
  const service = new Erc8183CommerceService({ adapter, operations });
  const authority = { wallet: { address: buyer }, signer: {} } as unknown as Erc8183AltanaAuthority;
  const hire = {
    idempotencyKey: "t4-unknown-smoke",
    providerAddress: provider,
    task: DEFAULT_TASK,
    budgetAtomic: DEFAULT_BUDGET_ATOMIC,
    providerBinding: input.providerBinding,
    requesterAddress: buyer,
    authority
  };
  try {
    await service.hire(hire);
    throw new CanaryError("UNKNOWN_SMOKE_DID_NOT_FAIL_CLOSED");
  } catch (error) {
    if (error instanceof CanaryError) throw error;
    assertCondition(errorCode(error) === "TRANSACTION_UNKNOWN", "UNKNOWN_SMOKE_NOT_FAIL_CLOSED");
  }
  const persisted = await operations.getByIdempotencyKey(hire.idempotencyKey);
  assertCondition(
    persisted?.status === "unknown" &&
      persisted.transactionHash === null &&
      persisted.context?.callsId?.toLowerCase() === UNKNOWN_SMOKE_CALLS_ID.toLowerCase(),
    "UNKNOWN_SMOKE_NOT_PERSISTED"
  );
  try {
    await service.hire(hire);
    throw new CanaryError("UNKNOWN_SMOKE_REPLAY_DID_NOT_STOP");
  } catch (error) {
    if (error instanceof CanaryError) throw error;
    assertCondition(errorCode(error) === "TRANSACTION_UNKNOWN", "UNKNOWN_SMOKE_REPLAY_NOT_BLOCKED");
  }
  assertCondition(adapterCalls === 1, "UNKNOWN_SMOKE_REBROADCASTED");
}

const POLICY_ABI = [{
  type: "function",
  name: "disputeWindow",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "uint64" }]
}] as const;

async function readDisputeWindow(network: NetworkConfig): Promise<number> {
  const policy = erc8183Addresses(CHAIN_ID).policy;
  const client = createPublicClient({ chain: network.chain, transport: http(network.publicRpcUrl) });
  const value = await client.readContract({ address: policy, abi: POLICY_ABI, functionName: "disputeWindow" });
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < DISPUTE_WINDOW_FLOOR_SECONDS) throw new CanaryError("DISPUTE_WINDOW_BELOW_REVIEWED_MINIMUM");
  return seconds;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Read the job while waiting; no writes or secrets are involved in progress checks. */
async function waitForDisputeWindow(input: {
  readonly adapter: Erc8183AltanaAdapter;
  readonly network: NetworkConfig;
  readonly job: Erc8183OnchainJob;
  readonly chainDeliverable: Hex;
}): Promise<number> {
  if (input.job.submittedAtUnix <= 0) throw new CanaryError("SUBMISSION_TIME_INVALID");
  const seconds = await readDisputeWindow(input.network);
  const targetUnix = input.job.submittedAtUnix + seconds + FINALITY_BUFFER_SECONDS;
  let lastProgress = 0;
  while (nowUnix() < targetUnix) {
    const current = await input.adapter.readJob(input.job.id);
    assertCondition(current.provider.toLowerCase() === input.job.provider.toLowerCase(), "PROVIDER_CHANGED_DURING_DISPUTE_WINDOW");
    assertCondition(current.chainDeliverable.toLowerCase() === input.chainDeliverable.toLowerCase(), "DELIVERABLE_CHANGED_DURING_DISPUTE_WINDOW");
    assertCondition(current.status === "SUBMITTED", "JOB_LEFT_SUBMITTED_STATE");
    const remaining = targetUnix - nowUnix();
    if (nowUnix() - lastProgress >= 30 || lastProgress === 0) {
      console.error(`T4 canary dispute window: ${remaining}s remaining; state=SUBMITTED.`);
      lastProgress = nowUnix();
    }
    await sleep(Math.min(30_000, Math.max(5_000, remaining * 1_000)));
  }
  const latest = await createPublicClient({ chain: input.network.chain, transport: http(input.network.publicRpcUrl) }).getBlockNumber();
  if (latest <= 0n) throw new CanaryError("FINALITY_READ_INVALID");
  return seconds;
}

function dataManifestUrl(manifestText: string): string {
  return `data:text/plain;base64,${Buffer.from(manifestText, "utf8").toString("base64")}`;
}

async function verifyManifestUrl(url: string | null | undefined, manifestText: string, chainDeliverable: Hex): Promise<void> {
  assertCondition(typeof url === "string" && url.startsWith("data:text/plain;base64,"), "DELIVERABLE_URL_NOT_PRIVATE_DATA");
  const response = await fetch(url);
  assertCondition(response.ok, "DELIVERABLE_URL_FETCH_FAILED");
  const served = await response.text();
  assertCondition(served === manifestText, "DELIVERABLE_URL_BYTES_MISMATCH");
  assertCondition(verifyErc8183ManifestText(served, chainDeliverable), "DELIVERABLE_URL_KECCAK_MISMATCH");
}

/** Unknown relay outcomes are reconciled once the receipt appears, then stop. Never resend. */
async function reconcileUnknownAndStop(input: {
  readonly service: Erc8183CommerceService;
  readonly operations: PostgresErc8183OperationRepository;
  readonly idempotencyKey: string;
}): Promise<never> {
  const operation = await input.operations.getByIdempotencyKey(input.idempotencyKey);
  if (operation === null) throw new CanaryError("UNKNOWN_OUTCOME_OPERATION_MISSING");
  if (operation.transactionHash === null) throw new CanaryError("UNKNOWN_OUTCOME_NO_RECEIPT_REFERENCE");
  const deadline = Date.now() + RECONCILIATION_TIMEOUT_SECONDS * 1_000;
  while (Date.now() < deadline) {
    try {
      const reconciled = await input.service.reconcile(operation.operationId);
      if (reconciled.operation.status === "reconciled") {
        console.error(`T4 canary reconciled unknown operation ${operation.operationId}; stopping without resend.`);
        throw new CanaryError("UNKNOWN_OUTCOME_RECONCILED_STOPPED");
      }
    } catch (error) {
      if (error instanceof CanaryError) throw error;
      if (errorCode(error) !== "TRANSACTION_UNKNOWN") throw error;
    }
    console.error("T4 canary waiting for the persisted transaction receipt; no retry will be sent.");
    await sleep(15_000);
  }
  throw new CanaryError("UNKNOWN_OUTCOME_RECONCILIATION_TIMEOUT");
}

async function executeWrite<T>(input: {
  readonly service: Erc8183CommerceService;
  readonly operations: PostgresErc8183OperationRepository;
  readonly idempotencyKey: string;
  readonly run: () => Promise<T>;
}): Promise<T> {
  try {
    return await input.run();
  } catch (error) {
    if (errorCode(error) === "TRANSACTION_UNKNOWN") {
      await reconcileUnknownAndStop(input);
    }
    throw error;
  }
}

interface LiveCanaryResult {
  readonly checks: Readonly<Record<string, CanaryCheck>>;
  readonly evidence: Readonly<Record<string, string | number>>;
  readonly disposableDatabase: CanaryCheck;
}

/** Execute one real capped ERC-8183 cycle against one fresh disposable database. */
async function runRealLifecycle(input: {
  readonly rawDatabaseUrl: string;
  readonly ssl: boolean;
  readonly pin: ReturnType<typeof canaryPin>;
  readonly lock: StandardsLock;
  readonly buyer: CanaryActor;
  readonly provider: CanaryActor;
}): Promise<LiveCanaryResult> {
  const runId = canaryRunId();
  const taskText = DEFAULT_TASK;
  const budgetAtomic = canaryBudget();
  const database = await createDisposableDatabase(input.rawDatabaseUrl, input.ssl);
  const db = createDb(database.target, { ssl: input.ssl });
  let poolClosed = false;
  try {
    const seeded = await seedParent({ pool: db.pool, pin: input.pin, buyerAddress: input.buyer.eoa, providerAddress: input.provider.eoa, task: taskText, budgetAtomic, runId });
    const adapter = new Erc8183AltanaAdapter({
      pin: input.pin,
      standardsLock: input.lock,
      network: BNB_TESTNET,
      developmentCanaryEnabled: true,
      runtimeEnvironment: "development"
    });
    const networkEvidence = await adapter.verifyNetwork();
    const operations = new PostgresErc8183OperationRepository(db.pool);
    const jobs = new PostgresErc8183JobRepository(db.pool);
    const service = new Erc8183CommerceService({ adapter, operations, approvals: jobs, jobs });
    const buyerAuthority: Erc8183AltanaAuthority = { wallet: input.buyer.wallet, signer: input.buyer.signer };
    const providerAuthority: Erc8183AltanaAuthority = { wallet: input.provider.wallet, signer: input.provider.signer };
    const hireKey = `t4-${runId}-hire`;
    const hire = await executeWrite({ service, operations, idempotencyKey: hireKey, run: () => service.hire({
      idempotencyKey: hireKey,
      commerceJobId: seeded.commerceJobId,
      providerAddress: input.provider.eoa,
      task: taskText,
      budgetAtomic,
      providerBinding: seeded.binding,
      requesterAddress: input.buyer.eoa,
      authority: buyerAuthority
    }) });
    assertCondition(hire.operation.status === "confirmed" && hire.result !== null && hire.result.job !== null && hire.result.transactionHash !== null, "LIVE_HIRE_NOT_CONFIRMED");
    const hired = hire.result;
    const protocolJobId = hired.jobId;
    const jobKey: Erc8183JobKey = { chainId: CHAIN_ID, commerceContract: input.pin.commerceContract, jobId: protocolJobId };
    await updateParent(db.pool, { commerceJobId: seeded.commerceJobId, protocolJobId, status: "funded", fundingTransactionHash: hired.transactionHash });
    const firstReload = await new Erc8183CommerceReadService(jobs, operations).get(jobKey);
    assertCondition(firstReload.job.state === "funded" && firstReload.job.providerBinding?.agentVersionId === seeded.binding.agentVersionId, "LIVE_HIRE_RELOAD_INVALID");

    const requestedAtUnix = nowUnix();
    const task = createHealthFactorTask({ jobKey, providerBinding: seeded.binding, account: CANARY_ACCOUNT, protocol: "venus", requestedAtUnix });
    const fixture = createHealthFactorResult({ task, observedAtUnix: requestedAtUnix + 1, healthFactor: 1.72 });
    const jobNumber = Number(protocolJobId);
    assertCondition(Number.isSafeInteger(jobNumber), "PROTOCOL_JOB_ID_NOT_SAFE_INTEGER");
    const manifest: Erc8183DeliverableManifest = {
      version: 1,
      job_id: jobNumber,
      chain_id: CHAIN_ID,
      contracts: { commerce: input.pin.commerceContract, router: adapter.routerContract, policy: adapter.policyContract },
      response: { content: JSON.stringify(fixture.result), content_type: "application/json" },
      metadata: { source: "bnbera.fixture.health-factor", result_sha256: fixture.resultDigest }
    };
    const manifestText = encodeErc8183Manifest(manifest);
    const chainDeliverable = erc8183ManifestHash(manifest);
    const deliverableUrl = dataManifestUrl(manifestText);
    const result = createHealthFactorResult({ task, observedAtUnix: fixture.producedAtUnix, healthFactor: 1.72, chainDeliverable, deliverableUrl });
    assertCondition(result.resultDigest === fixture.resultDigest, "LIVE_LOCAL_SHA_INVALID");
    assertCondition(verifyErc8183ManifestText(manifestText, chainDeliverable), "LIVE_MANIFEST_KECCAK_INVALID");
    await verifyManifestUrl(deliverableUrl, manifestText, chainDeliverable);

    const submitKey = `t4-${runId}-submit`;
    const submit = await executeWrite({ service, operations, idempotencyKey: submitKey, run: () => service.submit({
      idempotencyKey: submitKey,
      jobId: protocolJobId,
      authority: providerAuthority,
      requesterAddress: input.provider.eoa,
      resultDigest: result.resultDigest,
      chainDeliverable,
      deliverableUrl,
      manifest,
      task,
      result,
      providerBinding: seeded.binding
    }) });
    assertCondition(submit.operation.status === "confirmed" && submit.result !== null && submit.result.transactionHash !== null && submit.result.manifestText === manifestText && submit.result.chainDeliverable.toLowerCase() === chainDeliverable.toLowerCase(), "LIVE_SUBMIT_NOT_CONFIRMED");
    await updateParent(db.pool, { commerceJobId: seeded.commerceJobId, protocolJobId, status: "submitted", fulfillmentTransactionHash: submit.result.transactionHash });
    const submittedReload = await new Erc8183CommerceReadService(jobs, operations).get(jobKey);
    const submission = submittedReload.submission;
    assertCondition(submission !== null && submission.localSha256 === result.resultDigest && submission.chainKeccak.toLowerCase() === chainDeliverable.toLowerCase() && submission.manifestText === manifestText && submission.deliverableUrl === deliverableUrl, "LIVE_SUBMIT_RELOAD_INVALID");
    await verifyManifestUrl(submission.deliverableUrl, submission.manifestText ?? "", chainDeliverable);
    const submittedJob = submit.result.job;
    assertCondition(submittedJob !== null, "LIVE_SUBMIT_JOB_MISSING");
    const disputeWindowSeconds = await readDisputeWindow(BNB_TESTNET);
    const disputeDeadlineUnix = submittedJob.submittedAtUnix + disputeWindowSeconds + FINALITY_BUFFER_SECONDS;
    console.error(JSON.stringify({
      event: "submit_confirmed",
      protocolJobId,
      submitCallsId: submit.operation.context?.callsId ?? "",
      submitTransactionHash: submit.operation.transactionHash ?? "",
      disputeWindowSeconds,
      disputeDeadlineUnix
    }));

    const approval = await service.approveResult({ jobKey, actorAddress: input.buyer.eoa, requesterAddress: input.buyer.eoa, resultDigest: result.resultDigest, nowUnix: nowUnix() });
    assertCondition(typeof approval === "object" && approval !== null && (approval as { readonly replayed?: unknown }).replayed === false, "LIVE_APPROVAL_NOT_PERSISTED");
    const approvalReplay = await service.approveResult({ jobKey, actorAddress: input.buyer.eoa, requesterAddress: input.buyer.eoa, resultDigest: result.resultDigest, nowUnix: nowUnix() });
    assertCondition(typeof approvalReplay === "object" && approvalReplay !== null && (approvalReplay as { readonly replayed?: unknown }).replayed === true, "LIVE_APPROVAL_REPLAY_INVALID");

    await waitForDisputeWindow({ adapter, network: BNB_TESTNET, job: submittedJob, chainDeliverable });
    const settleKey = `t4-${runId}-settle`;
    const settle = await executeWrite({ service, operations, idempotencyKey: settleKey, run: () => service.settle({
      idempotencyKey: settleKey,
      authority: buyerAuthority,
      requesterAddress: input.buyer.eoa,
      jobId: protocolJobId
    }) });
    assertCondition(settle.operation.status === "confirmed" && settle.result !== null && settle.result.transactionHash !== null && settle.result.job?.status === "COMPLETED", "LIVE_SETTLE_NOT_CONFIRMED");
    await updateParent(db.pool, { commerceJobId: seeded.commerceJobId, protocolJobId, status: "settled", settlementTransactionHash: settle.result.transactionHash });

    const beforeReplay = await operations.getByIdempotencyKey(hireKey);
    const hireReplay = await executeWrite({ service, operations, idempotencyKey: hireKey, run: () => service.hire({
      idempotencyKey: hireKey,
      commerceJobId: seeded.commerceJobId,
      providerAddress: input.provider.eoa,
      task: taskText,
      budgetAtomic,
      providerBinding: seeded.binding,
      requesterAddress: input.buyer.eoa,
      authority: buyerAuthority
    }) });
    const afterReplay = await operations.getByIdempotencyKey(hireKey);
    assertCondition(hireReplay.replayed && hireReplay.result === null && beforeReplay !== null && afterReplay?.operationId === beforeReplay.operationId && afterReplay.transactionHash === beforeReplay.transactionHash && afterReplay.context?.callsId === beforeReplay.context?.callsId, "LIVE_DUPLICATE_HIRE_REBROADCAST");

    await db.pool.end();
    poolClosed = true;
    const restarted = createDb(database.target, { ssl: input.ssl });
    try {
      const restartJobs = new PostgresErc8183JobRepository(restarted.pool);
      const restartOps = new PostgresErc8183OperationRepository(restarted.pool);
      const afterRestart = await new Erc8183CommerceReadService(restartJobs, restartOps).get(jobKey);
      assertCondition(afterRestart.job.state === "completed" && afterRestart.job.buyerApproval?.resultDigest === result.resultDigest && afterRestart.submission?.chainKeccak.toLowerCase() === chainDeliverable.toLowerCase(), "LIVE_RESTART_RELOAD_INVALID");
      const parent = await restarted.pool.query<{ readonly status: string; readonly erc8183_job_id: string }>(`SELECT status, erc8183_job_id FROM commerce_jobs WHERE id = $1`, [seeded.commerceJobId]);
      assertCondition(parent.rows[0]?.status === "settled" && parent.rows[0].erc8183_job_id === protocolJobId, "LIVE_PARENT_RELOAD_INVALID");
    } finally {
      await closePool(restarted.pool);
    }
    return {
      checks: {
        networkDeployment: check("pass", "live-read-only"),
        parentCommerceRow: check("pass", "disposable-db"),
        budgetCap: check("pass", "disposable-db"),
        sdkOnlyHire: check("pass", "disposable-db"),
        confirmedReceiptPersisted: check("pass", "disposable-db"),
        deterministicProviderTaskResult: check("pass", "disposable-db"),
        canonicalManifestShaKeccakUrl: check("pass", "disposable-db"),
        submitAndReloadRead: check("pass", "disposable-db"),
        exactBuyerApproval: check("pass", "disposable-db"),
        disputeWindowAndSettlement: check("pass", "disposable-db"),
        duplicateHireNoRebroadcast: check("pass", "disposable-db"),
        restartReloadCompleted: check("pass", "disposable-db"),
        unknownOutcomeFailClosed: check("pass", "deterministic", "operation coordinator persists unknown outcomes and requires reconciliation; no resend path")
      },
      evidence: {
        runId,
        buyerAddress: input.buyer.eoa,
        providerAddress: input.provider.eoa,
        identityRegistry: seeded.binding.identity.identityRegistry,
        agentId: seeded.binding.identity.agentId,
        agentVersionId: seeded.binding.agentVersionId,
        commerceJobId: seeded.commerceJobId,
        protocolJobId,
        hireCallsId: hire.operation.context?.callsId ?? "",
        hireTransactionHash: hire.operation.transactionHash ?? "",
        hireBlockNumber: hire.operation.blockNumber ?? "",
        submitCallsId: submit.operation.context?.callsId ?? "",
        submitTransactionHash: submit.operation.transactionHash ?? "",
        submitBlockNumber: submit.operation.blockNumber ?? "",
        settleCallsId: settle.operation.context?.callsId ?? "",
        settleTransactionHash: settle.operation.transactionHash ?? "",
        settleBlockNumber: settle.operation.blockNumber ?? "",
        manifestKeccak: chainDeliverable,
        localResultSha256: result.resultDigest,
        deliverableUrl,
        disputeWindowSeconds,
        networkCommerceContract: networkEvidence.commerceContract,
        networkPaymentToken: networkEvidence.paymentToken
      },
      disposableDatabase: check("pass", "disposable-db")
    };
  } finally {
    if (!poolClosed) await closePool(db.pool);
    await dropDisposableDatabase(database, input.ssl);
  }
}

async function runDisposableSmoke(rawUrl: string, ssl: boolean, pin: ReturnType<typeof canaryPin>): Promise<CanaryCheck> {
  const database = await createDisposableDatabase(rawUrl, ssl);
  const db = createDb(database.target, { ssl });
  try {
    await migrateDb(database.target, { ssl });
    const buyer = "0x1111111111111111111111111111111111111111" as Address;
    const provider = "0x2222222222222222222222222222222222222222" as Address;
    const seeded = await seedParent({ pool: db.pool, pin, buyerAddress: buyer, providerAddress: provider, task: DEFAULT_TASK, budgetAtomic: DEFAULT_BUDGET_ATOMIC, runId: `dry-${randomUUID().slice(0, 8)}` });
    await runUnknownOutcomeSmoke({ pool: db.pool, pin, providerBinding: seeded.binding });
    return check("pass", "disposable-db", "fresh migration, replay migration, parent-row insert, unknown persistence and no-rebroadcast guard passed");
  } finally {
    await closePool(db.pool);
    await dropDisposableDatabase(database, ssl);
  }
}

function actorChecks(buyer: CanaryActor | null, provider: CanaryActor | null): Readonly<Record<string, CanaryCheck>> {
  const both = buyer !== null && provider !== null;
  return {
    buyerKeyDerivedEoaMatchesConfiguredAddress: buyer === null ? check("skipped", "deterministic", "write actors are not required in this mode") : check("pass", "deterministic"),
    providerKeyDerivedEoaMatchesConfiguredAddress: provider === null ? check("skipped", "deterministic", "write actors are not required in this mode") : check("pass", "deterministic"),
    buyerProviderDistinct: !both ? check("skipped", "deterministic", "write actors are not required in this mode") : check(buyer.eoa.toLowerCase() === provider.eoa.toLowerCase() ? "blocked" : "pass", "deterministic"),
    sdkWalletAddressMatchesDerivedEoa: check("skipped", "deterministic", "checked after coordinator GO, immediately before live writes")
  };
}

async function run(flags: CanaryFlags): Promise<CanaryReport> {
  assertOperatorFlags(flags);
  const lock = await readStandardsLock();
  const pin = canaryPin(lock);
  const databaseUrl = nonEmptyEnv("DATABASE_URL");
  const ssl = process.env.DATABASE_SSL === "true";
  const buyer = resolveCanaryActor({ role: "buyer", privateKeyName: "WALLET_PRIVATE_KEY", addressName: "WALLET_ADDRESS", required: flags.mode === "write" });
  const provider = resolveCanaryActor({ role: "provider", privateKeyName: "WALLET2_PRIVATE_KEY", addressName: "WALLET2_ADDRESS", required: flags.mode === "write" });
  if (buyer !== null && provider !== null && buyer.eoa.toLowerCase() === provider.eoa.toLowerCase()) throw new CanaryError("BUYER_PROVIDER_MUST_BE_DISTINCT");
  const actors = actorChecks(buyer, provider);
  if (flags.mode === "read-only") {
    const adapter = new Erc8183AltanaAdapter({ pin, standardsLock: lock, network: BNB_TESTNET });
    await adapter.verifyNetwork();
    return { ok: true, mode: flags.mode, network: CHAIN_ID, writesBroadcast: false, checks: { networkDeployment: check("pass", "live-read-only") }, disposableDatabase: check("skipped", "deterministic", "read-only mode does not create a database"), actorChecks: actors, blocker: "READ_ONLY_NO_WRITE" };
  }
  const preflightAdapter = new Erc8183AltanaAdapter({ pin, standardsLock: lock, network: BNB_TESTNET, developmentCanaryEnabled: true, runtimeEnvironment: "development" });
  await preflightAdapter.verifyNetwork();
  const disposableDatabase = flags.skipDatabase
    ? check("skipped", "deterministic", "--skip-db explicitly selected")
    : databaseUrl === undefined
      ? check("blocked", "deterministic", "DATABASE_URL is required for the disposable migration smoke")
      : await runDisposableSmoke(databaseUrl, ssl, pin);
  if (flags.mode === "dry-run") {
    const databaseReady = flags.skipDatabase || disposableDatabase.status === "pass";
    const ok = databaseReady && Object.values(actors).every((item) => item.status !== "blocked");
    return { ok, mode: flags.mode, network: CHAIN_ID, writesBroadcast: false, checks: { networkDeployment: check("pass", "live-read-only"), disposableMigration: disposableDatabase }, disposableDatabase, actorChecks: actors, blocker: "DRY_RUN_NO_CHAIN_WRITE" };
  }
  if (databaseUrl === undefined) throw new CanaryError("DATABASE_URL_REQUIRED");
  if (buyer === null || provider === null) throw new CanaryError("WRITE_ACTORS_REQUIRED");
  const client = createClient({ chains: [BNB_TESTNET], defaultChainId: CHAIN_ID });
  const buyerWallet = await client.createWallet({ signer: buyer.signer });
  const providerWallet = await client.createWallet({ signer: provider.signer });
  if (buyerWallet.address.toLowerCase() !== buyer.eoa.toLowerCase() || providerWallet.address.toLowerCase() !== provider.eoa.toLowerCase()) throw new CanaryError("ALTANA_WALLET_EOA_RELATIONSHIP_MISMATCH");
  const live = await runRealLifecycle({ rawDatabaseUrl: databaseUrl, ssl, pin, lock, buyer: { ...buyer, wallet: buyerWallet }, provider: { ...provider, wallet: providerWallet } });
  return { ok: Object.values(live.checks).every((item) => item.status === "pass"), mode: flags.mode, network: CHAIN_ID, writesBroadcast: true, checks: live.checks, disposableDatabase: live.disposableDatabase, actorChecks: { ...actors, sdkWalletAddressMatchesDerivedEoa: check("pass", "deterministic") }, evidence: live.evidence };
}

export async function runOperatorCanary(flags: CanaryFlags): Promise<CanaryReport> {
  return run(flags);
}

function usage(): string {
  return [
    "T4 operator canary (no-write by default)",
    "  pnpm ops:t4-canary -- --network=97 --development-canary --dry-run [--skip-db]",
    "  pnpm ops:t4-canary -- --network=97 --development-canary --read-only",
    "  pnpm ops:t4-canary -- --network=97 --development-canary --write",
    "",
    "--write additionally requires T4_CANARY_GO=true and T4_CANARY_BROADCAST=true,",
    "WALLET_PRIVATE_KEY/WALLET_ADDRESS (buyer), WALLET2_PRIVATE_KEY/WALLET2_ADDRESS (provider),",
    "and DATABASE_URL. The pinned SDK BNB_TESTNET RPC is always used.",
    "The canary creates and drops a uniquely named disposable PostgreSQL database."
  ].join("\n");
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const flags = parseCanaryArgs(process.argv.slice(2));
    if (flags.help) {
      console.log(usage());
    } else {
      const report = await runOperatorCanary(flags);
      console.log(JSON.stringify(report));
      if (!report.ok) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`T4 operator canary blocked: ${errorCode(error)}.`);
    process.exitCode = 1;
  }
}
