import { BNB_TESTNET } from "@altananetwork/sdk";
import { erc8004IdentitySchema, type Erc8004Identity } from "@bnbera/domain";
import { z } from "zod";
import {
  Erc8183AltanaAdapter,
  resolveErc8183DeploymentVerification
} from "./chain.js";
import { CommerceError } from "./errors.js";
import {
  PostgresErc8183OperationRepository,
  type Erc8183OperationQueryPool
} from "./operations.js";
import {
  Erc8183CommerceService,
  type Erc8183CommerceServiceOptions
} from "./service.js";
import {
  healthFactorLendingSnapshotSchema
} from "./provider.js";
import {
  Erc8183ReferenceProviderRunner,
  referenceProviderRunnerConfigSchema,
  type ReferenceHealthFactorProviderClient,
  type ReferenceProviderAuthorityResolver,
  type ReferenceProviderJobSelector,
  type ReferenceProviderRunnerConfig,
  type ReferenceProviderOwnedJob
} from "./reference-provider.js";
import {
  PostgresErc8183JobRepository
} from "./postgres-jobs.js";
import {
  nonZeroAddressSchema,
  unixSecondsSchema,
  type EnabledErc8183DeploymentPin,
  type Erc8183JobKey
} from "./types.js";
import {
  parseEnabledDeploymentPin,
  normalizeAddress
} from "./validation.js";

type EnabledReferenceProviderRunnerConfig = ReferenceProviderRunnerConfig & {
  readonly enabled: true;
  readonly identity: Erc8004Identity;
  readonly jobKey: Erc8183JobKey;
  readonly expectedOwnerAddress: string;
  readonly providerAddress: string;
  readonly providerEndpoint: string;
  readonly authoritySecretReference: string;
  readonly routerContract: string;
  readonly policyContract: string;
};

function enabledReferenceProviderConfig(input: ReferenceProviderRunnerConfig): EnabledReferenceProviderRunnerConfig {
  const config = referenceProviderRunnerConfigSchema.parse(input);
  if (
    !config.enabled ||
    config.identity === undefined ||
    config.jobKey === undefined ||
    config.expectedOwnerAddress === undefined ||
    config.providerAddress === undefined ||
    config.providerEndpoint === undefined ||
    config.authoritySecretReference === undefined ||
    config.routerContract === undefined ||
    config.policyContract === undefined
  ) {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The enabled reference provider worker is incompletely configured.", nextAction: "configure_reference_provider" });
  }
  return config as EnabledReferenceProviderRunnerConfig;
}

/**
 * Public, bounded input for the one configured reference job. The worker does
 * not infer a lending snapshot from an arbitrary task string or invent one
 * from a provider response; the operator supplies this exact public fixture
 * through the runtime boundary.
 */
export const referenceProviderTaskInputSchema = z.object({
  account: nonZeroAddressSchema,
  chainId: z.literal(97),
  protocol: z.string().trim().min(1).max(120),
  requestedAtUnix: unixSecondsSchema,
  lendingSnapshot: healthFactorLendingSnapshotSchema
}).strict().superRefine((value, ctx) => {
  if (value.lendingSnapshot.observedAtUnix > value.requestedAtUnix) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lendingSnapshot", "observedAtUnix"], message: "The source snapshot cannot be observed after the request." });
  }
});
export type ReferenceProviderTaskInput = z.infer<typeof referenceProviderTaskInputSchema>;

type LockRecord = Readonly<Record<string, unknown>>;

function lockRecord(value: unknown, label: string): LockRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: `The standards lock has no valid ${label} record.`, nextAction: "verify_standards_lock" });
  }
  return value as LockRecord;
}

function lockString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: `The standards lock has no valid ${label}.`, nextAction: "verify_standards_lock" });
  }
  return value;
}

function lockInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: `The standards lock has no valid ${label}.`, nextAction: "verify_standards_lock" });
  }
  return value as number;
}

/**
 * Build the enabled application pin solely from the checked-in standards
 * lock. The Altana adapter separately verifies the SDK address/runtime pins
 * before it can perform a write.
 */
export function referenceProviderPinFromStandardsLock(lock: unknown): EnabledErc8183DeploymentPin {
  const deploymentVerification = resolveErc8183DeploymentVerification(lock, 97);
  if (!deploymentVerification.enabled || deploymentVerification.releaseEnabled) {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The standards-locked ERC-8183 reference worker is not enabled for local canary use.", nextAction: "verify_standards_lock" });
  }
  const root = lockRecord(lock, "root");
  const networks = lockRecord(root.networks, "networks");
  const network = lockRecord(networks["97"], "BSC testnet");
  const deployment = lockRecord(network.erc8183, "BSC testnet ERC-8183 deployment");
  const abiHashes = lockRecord(deployment.abiHashes, "ERC-8183 ABI hashes");
  const riskLimits = lockRecord(deployment.riskLimits, "ERC-8183 risk limits");
  const pin = parseEnabledDeploymentPin({
    enabled: true,
    chainId: 97,
    specRevision: lockString(deployment.specRevision, "ERC-8183 spec revision"),
    commerceContract: lockString(deployment.commerceProxy, "ERC-8183 commerce proxy"),
    paymentToken: lockString(deployment.paymentToken, "ERC-8183 payment token"),
    paymentDecimals: lockInteger(deployment.paymentDecimals, "ERC-8183 payment decimals"),
    abiHash: lockString(abiHashes.commerce, "ERC-8183 commerce ABI hash"),
    evaluatorProfile: "verified-policy-v1",
    confirmationThreshold: 1,
    minExpiryLeadSeconds: 60,
    maxExpiryHorizonSeconds: 86_400,
    minBudgetAtomic: "1",
    maxBudgetAtomic: lockString(riskLimits.maxBudgetAtomic, "ERC-8183 maximum budget")
  });
  if (
    riskLimits.network !== 97 ||
    typeof riskLimits.token !== "string" ||
    riskLimits.token.toLowerCase() !== pin.paymentToken.toLowerCase() ||
    BigInt(pin.maxBudgetAtomic) !== 10_000_000_000_000_000n
  ) {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The reference worker budget cap does not match the standards-locked 0.01 U risk limit.", nextAction: "verify_standards_lock" });
  }
  return pin;
}

export function referenceProviderIdentityRegistryFromStandardsLock(lock: unknown): `0x${string}` {
  const root = lockRecord(lock, "root");
  const networks = lockRecord(root.networks, "networks");
  const network = lockRecord(networks["97"], "BSC testnet");
  const erc8004 = lockRecord(network.erc8004, "BSC testnet ERC-8004 deployment");
  try {
    return nonZeroAddressSchema.parse(lockString(erc8004.identityRegistry, "ERC-8004 identity registry")) as `0x${string}`;
  } catch (cause) {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The standards-locked ERC-8004 identity registry is invalid.", nextAction: "verify_standards_lock", cause });
  }
}

type IdentityProjectionRow = {
  readonly owner_address: string | null;
  readonly owner_observed_block: number | string | null;
  readonly agent_wallet: string | null;
  readonly agent_wallet_observed_block: number | string | null;
  readonly agent_uri: string | null;
  readonly agent_uri_observed_block: number | string | null;
  readonly observed_block: number | string | null;
  readonly observed_block_hash: string | null;
  readonly read_consistency: string | null;
};

/**
 * Select exactly one configured full identity tuple and one protocol job. The
 * job projection and operation repository remain the canonical PostgreSQL
 * surfaces; this selector only joins the finalized identity ownership facts
 * needed by the provider runner.
 */
export class PostgresReferenceProviderJobSelector implements ReferenceProviderJobSelector {
  private readonly expectedOwnerAddress: `0x${string}`;

  public constructor(
    private readonly pool: Erc8183OperationQueryPool,
    private readonly jobs: Pick<PostgresErc8183JobRepository, "get">,
    private readonly taskInput: ReferenceProviderTaskInput,
    expectedOwnerAddress: string
  ) {
    referenceProviderTaskInputSchema.parse(taskInput);
    this.expectedOwnerAddress = normalizeAddress(expectedOwnerAddress, "expected reference identity owner");
  }

  public async select(input: {
    readonly identity: Erc8004Identity;
    readonly jobKey: Erc8183JobKey;
    readonly providerAddress: string;
  }): Promise<ReferenceProviderOwnedJob | null> {
    const identity = erc8004IdentitySchema.parse(input.identity);
    const providerAddress = normalizeAddress(input.providerAddress, "reference provider address");
    const taskInput = referenceProviderTaskInputSchema.parse(this.taskInput);
    const job = await this.jobs.get(input.jobKey);
    if (job === null) return null;
    if (job.terms.providerAddress === null || normalizeAddress(job.terms.providerAddress, "job provider address") !== providerAddress) return null;
    const identityResult = await this.pool.query<IdentityProjectionRow>(`
      SELECT owner_address, owner_observed_block,
             agent_wallet, agent_wallet_observed_block,
             agent_uri, agent_uri_observed_block,
             observed_block, observed_block_hash, read_consistency
      FROM erc8004_identities
      WHERE namespace = $1
        AND chain_id = $2
        AND identity_registry = $3
        AND agent_id = $4
      LIMIT 1
    `, [identity.namespace, identity.chainId, identity.identityRegistry.toLowerCase(), identity.agentId]);
    const row = identityResult.rows[0];
    const observedBlock = typeof row?.observed_block === "string" ? Number(row.observed_block) : row?.observed_block;
    const fieldBlocks = [row?.owner_observed_block, row?.agent_wallet_observed_block, row?.agent_uri_observed_block]
      .map((value) => typeof value === "string" ? Number(value) : value);
    const completeFieldProvenance = observedBlock !== null && observedBlock !== undefined && Number.isSafeInteger(observedBlock) && observedBlock >= 0 &&
      fieldBlocks.every((value) => value !== null && value !== undefined && Number.isSafeInteger(value) && value >= 0 && value <= observedBlock);
    if (
      row === undefined ||
      row.read_consistency !== "finalized" ||
      observedBlock === null ||
      observedBlock === undefined ||
      !Number.isSafeInteger(observedBlock) ||
      observedBlock < 0 ||
      row.observed_block_hash === null ||
      !/^0x[0-9a-f]{64}$/iu.test(row.observed_block_hash) ||
      !completeFieldProvenance ||
      typeof row.agent_uri !== "string" || row.agent_uri.trim() === ""
    ) return null;
    const ownerAddress = row.owner_address === null
      ? null
      : normalizeAddress(row.owner_address, "reference identity owner");
    if (ownerAddress === null || ownerAddress !== this.expectedOwnerAddress) {
      throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The finalized ERC-8004 identity owner does not match the configured expected owner.", nextAction: "reload_identity" });
    }
    if (row.agent_wallet === null || normalizeAddress(row.agent_wallet, "reference identity agent wallet") !== providerAddress) {
      throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The finalized ERC-8004 agent wallet does not match the configured provider actor.", nextAction: "reload_identity" });
    }
    return {
      job,
      identityOwnerAddress: ownerAddress,
      identityAgentWallet: row.agent_wallet,
      account: taskInput.account,
      protocol: taskInput.protocol,
      requestedAtUnix: taskInput.requestedAtUnix,
      lendingSnapshot: taskInput.lendingSnapshot
    };
  }
}

export interface ReferenceProviderWorkerComposition {
  readonly adapter: Erc8183AltanaAdapter;
  readonly operations: PostgresErc8183OperationRepository;
  readonly jobs: PostgresErc8183JobRepository;
  readonly selector: PostgresReferenceProviderJobSelector;
  readonly service: Erc8183CommerceService;
  readonly runner: Erc8183ReferenceProviderRunner;
}

/**
 * Compose the disabled-by-default worker against the existing commerce
 * service/Altana seam. Construction is only called after the CLI has opted in;
 * the factory itself never runs a database query or chain write.
 */
export function createReferenceProviderWorkerComposition(input: {
  readonly config: ReferenceProviderRunnerConfig;
  readonly standardsLock: unknown;
  readonly pool: Erc8183OperationQueryPool;
  readonly taskInput: ReferenceProviderTaskInput;
  readonly resolveAuthority: ReferenceProviderAuthorityResolver;
  readonly provider?: ReferenceHealthFactorProviderClient;
  readonly sdk?: ConstructorParameters<typeof Erc8183AltanaAdapter>[0]["sdk"];
}): ReferenceProviderWorkerComposition {
  if (!input.config.enabled) {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The reference provider worker is disabled by default.", nextAction: "enable_local_testnet_worker" });
  }
  const config = input.config;
  const enabledConfig = enabledReferenceProviderConfig(config);
  const pin = referenceProviderPinFromStandardsLock(input.standardsLock);
  const identityRegistry = referenceProviderIdentityRegistryFromStandardsLock(input.standardsLock);
  if (enabledConfig.jobKey.commerceContract.toLowerCase() !== pin.commerceContract.toLowerCase()) {
    throw new CommerceError({ code: "INVALID_CONTRACT", message: "The configured reference job does not use the standards-locked commerce contract.", nextAction: "verify_standards_lock" });
  }
  if (enabledConfig.identity.identityRegistry.toLowerCase() !== identityRegistry.toLowerCase()) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The configured reference identity does not use the standards-locked identity registry.", nextAction: "verify_standards_lock" });
  }
  const adapter = new Erc8183AltanaAdapter({
    pin,
    standardsLock: input.standardsLock,
    network: BNB_TESTNET,
    developmentCanaryEnabled: enabledConfig.developmentCanaryEnabled,
    runtimeEnvironment: enabledConfig.runtimeEnvironment
    ,...(input.sdk===undefined?{}:{sdk:input.sdk})
  });
  if (enabledConfig.routerContract.toLowerCase() !== adapter.routerContract.toLowerCase() || enabledConfig.policyContract.toLowerCase() !== adapter.policyContract.toLowerCase()) {
    throw new CommerceError({ code: "INVALID_CONTRACT", message: "The configured reference worker router/policy does not match the pinned Altana deployment.", nextAction: "verify_standards_lock" });
  }
  const operations = new PostgresErc8183OperationRepository(input.pool);
  const jobs = new PostgresErc8183JobRepository(input.pool);
  const serviceOptions: Erc8183CommerceServiceOptions = { adapter, operations, approvals: jobs, jobs };
  const service = new Erc8183CommerceService(serviceOptions);
  const selector = new PostgresReferenceProviderJobSelector(input.pool, jobs, input.taskInput, enabledConfig.expectedOwnerAddress);
  const runner = new Erc8183ReferenceProviderRunner({
    config: enabledConfig,
    selector,
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    service,
    operations,
    resolveAuthority: input.resolveAuthority
  });
  return { adapter, operations, jobs, selector, service, runner };
}
