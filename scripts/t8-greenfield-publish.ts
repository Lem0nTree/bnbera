import { readFile } from "node:fs/promises";
import { setTimeout as sleepTimer } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  EvidencePublisher,
  PersistentEvidencePublicationStore,
  buildAgentProfileArtifact,
  agentProfileArtifactBinding,
  buildRunBundleArtifact,
  runBundleArtifactBinding,
  createGreenfieldEnvironmentSecretLoader,
  GreenfieldSdkPublisher,
  GREENFIELD_TESTNET_CHAIN_ID,
  GREENFIELD_TESTNET_NETWORK,
  greenfieldConfigurationDigest,
  defaultEvidenceObjectForAttempt,
  deterministicEvidenceObjectIdForBinding,
  type FrozenAgentProfileRows,
  type FrozenRunBundleRows,
  type GreenfieldBucketEnsureReceipt,
  type GreenfieldBucketReconcileReceipt,
  type GreenfieldArtifactBinding,
  type GreenfieldStandardsPins,
  type PublicationConfiguration
} from "../packages/greenfield/src/index.js";
import { digestArtifact, deterministicObjectName } from "../packages/evidence/src/index.js";
import { createGreenfieldPostgresAdapter } from "../packages/db/src/greenfield-postgres.js";

export const T8_GREENFIELD_CANARY_BUCKET =
  "bnbera-t8-230072625f8090d5271c5f882748ce11134ac2ba" as const;
export const T8_GREENFIELD_MAX_SEAL_POLLS = 6 as const;
export const T8_GREENFIELD_SEAL_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;
export const T8_GREENFIELD_LEASE_DURATION_MS = 60_000 as const;

/** Sum the delays the publisher can actually await for this bounded poll set. */
export function t8GreenfieldSealBackoffBudgetMs(
  maxSealPolls: number,
  sealBackoffMs: readonly number[]
): number {
  if (maxSealPolls <= 1 || sealBackoffMs.length === 0) return 0;
  let budget = 0;
  for (let attempt = 1; attempt < maxSealPolls; attempt += 1) {
    budget += sealBackoffMs[Math.min(attempt - 1, sealBackoffMs.length - 1)] ?? 0;
  }
  return budget;
}

/** Production scheduler injected into EvidencePublisher; tests replace it at the publisher seam. */
export async function t8GreenfieldSleep(milliseconds: number): Promise<void> {
  await sleepTimer(milliseconds);
}

type Command = "plan" | "publish" | "reconcile" | "create-bucket" | "reconcile-bucket";

export interface T8GreenfieldCliConfig {
  readonly network: string;
  readonly chainId: string;
  readonly environment: PublicationConfiguration["environment"];
  readonly bucket: string;
  readonly creator: string;
  readonly rpcUrl: string | null;
  readonly spEndpoint: string | null;
  readonly publicReadBaseUrl: string | null;
  readonly databaseUrl: string | null;
  readonly keyReference: string | null;
  readonly enabled: boolean;
  readonly liveWriteEnabled: boolean;
  readonly canaryApproved: boolean;
}

interface T8ArtifactInput {
  readonly artifact: unknown;
  readonly binding: GreenfieldArtifactBinding | null;
}

function booleanFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function environment(value: string | undefined): PublicationConfiguration["environment"] {
  const candidate = value?.trim() ?? "hackathon";
  if (!["development", "preview", "hackathon", "production"].includes(candidate)) {
    throw new Error("T8 Greenfield evidence environment is invalid");
  }
  return candidate as PublicationConfiguration["environment"];
}

/** Read only non-secret CLI configuration. Private-key values are never read here. */
export function readT8GreenfieldCliConfig(env: NodeJS.ProcessEnv = process.env): T8GreenfieldCliConfig {
  const bucket = env.GREENFIELD_BUCKET?.trim() || T8_GREENFIELD_CANARY_BUCKET;
  if (bucket !== T8_GREENFIELD_CANARY_BUCKET) {
    throw new Error("T8 Greenfield is pinned to its one deterministic canary bucket");
  }
  const creator = env.GREENFIELD_CREATOR?.trim() ?? "";
  if (creator.length > 0 && !/^0x[0-9a-fA-F]{40}$/.test(creator)) {
    throw new Error("T8 Greenfield creator address is invalid");
  }
  const network = env.GREENFIELD_NETWORK?.trim() || GREENFIELD_TESTNET_NETWORK;
  const chainId = env.GREENFIELD_CHAIN_ID?.trim() || GREENFIELD_TESTNET_CHAIN_ID;
  if (network !== GREENFIELD_TESTNET_NETWORK || chainId !== GREENFIELD_TESTNET_CHAIN_ID) {
    throw new Error("T8 Greenfield network is not standards-locked");
  }
  return {
    network,
    chainId,
    environment: environment(env.GREENFIELD_EVIDENCE_ENVIRONMENT),
    bucket,
    creator,
    rpcUrl: env.GREENFIELD_RPC_URL?.trim() || null,
    spEndpoint: env.GREENFIELD_SP_ENDPOINT?.trim() || null,
    publicReadBaseUrl: null,
    databaseUrl: env.DATABASE_URL?.trim() || null,
    keyReference: env.GREENFIELD_PUBLISHER_PRIVATE_KEY_REF?.trim() || null,
    enabled: booleanFlag(env.T8_GREENFIELD_ENABLED),
    liveWriteEnabled: booleanFlag(env.T8_GREENFIELD_LIVE_WRITE_ENABLED),
    canaryApproved: booleanFlag(env.T8_GREENFIELD_CANARY_APPROVED)
  };
}

interface LockedGreenfieldRuntime {
  readonly pins: GreenfieldStandardsPins;
  readonly rpcUrl: string;
  readonly spEndpoint: string;
  readonly publicReadBaseUrl: string;
}

async function readLockedGreenfieldRuntime(): Promise<LockedGreenfieldRuntime> {
  const raw = JSON.parse(await readFile(new URL("../config/standards.lock.json", import.meta.url), "utf8")) as {
    readonly greenfield?: {
      readonly networkId?: unknown;
      readonly sdkChainId?: unknown;
      readonly sdkPackage?: unknown;
      readonly sdkVersion?: unknown;
      readonly sdkIntegrity?: unknown;
      readonly reedSolomonPackage?: unknown;
      readonly reedSolomonVersion?: unknown;
      readonly reedSolomonIntegrity?: unknown;
      readonly rpcUrl?: unknown;
      readonly storageProviders?: readonly {
        readonly providerLabel?: unknown;
        readonly operatorAddress?: unknown;
        readonly endpoint?: unknown;
        readonly publicReadBaseUrls?: readonly unknown[];
      }[];
    };
  };
  const lock = raw.greenfield;
  const provider = lock?.storageProviders?.[0];
  const publicReadBaseUrl = provider?.publicReadBaseUrls?.[0];
  if (
    lock?.networkId !== GREENFIELD_TESTNET_NETWORK ||
    lock.sdkChainId !== GREENFIELD_TESTNET_CHAIN_ID ||
    lock.sdkPackage !== "@bnb-chain/greenfield-js-sdk" ||
    lock.sdkVersion !== "2.2.0" ||
    lock.sdkIntegrity !== "sha512-TDLmmy8aj1UDlRYkfzfrZnej4/vLQqmTcYM/3kh0drdiEpvIiYvCcmn0zXem39hijnnjcLcoJ2qiqaR8cC/9gA==" ||
    lock.reedSolomonPackage !== "@bnb-chain/reed-solomon" ||
    lock.reedSolomonVersion !== "1.1.4" ||
    lock.reedSolomonIntegrity !== "sha512-mebL6p1iHt9B6lpxX1pxW/K3KA35sVdMsIyW/B31URjktSJ0osGEvVUoYGb53nuSIUIUtm2wPtE0+0dZV1CMLw==" ||
    typeof lock.rpcUrl !== "string" ||
    typeof provider?.providerLabel !== "string" ||
    typeof provider.operatorAddress !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(provider.operatorAddress) ||
    typeof provider.endpoint !== "string" ||
    typeof publicReadBaseUrl !== "string"
  ) {
    throw new Error("T8 Greenfield standards lock is incomplete or does not match installed package pins");
  }
  for (const value of [lock.rpcUrl, provider.endpoint, publicReadBaseUrl]) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
      throw new Error("T8 Greenfield standards lock contains a non-HTTPS endpoint");
    }
  }
  return {
    rpcUrl: lock.rpcUrl,
    spEndpoint: provider.endpoint,
    publicReadBaseUrl,
    pins: {
      networkId: lock.networkId,
      sdkChainId: lock.sdkChainId,
      sdkPackage: lock.sdkPackage,
      sdkVersion: lock.sdkVersion,
      storageProviders: [{
        providerLabel: provider.providerLabel,
        operatorAddress: provider.operatorAddress,
        endpoint: provider.endpoint,
        publicReadBaseUrls: [publicReadBaseUrl]
      }],
      publicReadBaseUrls: [publicReadBaseUrl]
    }
  };
}

function applyLockedRuntime(config: T8GreenfieldCliConfig, locked: LockedGreenfieldRuntime): T8GreenfieldCliConfig {
  if (config.rpcUrl !== null && config.rpcUrl !== locked.rpcUrl) throw new Error("GREENFIELD_RPC_URL differs from the standards lock");
  if (config.spEndpoint !== null && config.spEndpoint !== locked.spEndpoint) throw new Error("GREENFIELD_SP_ENDPOINT differs from the standards lock");
  return { ...config, rpcUrl: locked.rpcUrl, spEndpoint: locked.spEndpoint, publicReadBaseUrl: locked.publicReadBaseUrl };
}

function argument(argv: readonly string[], name: string): string | null {
  const prefix = `${name}=`;
  const inline = argv.find((value) => value.startsWith(prefix));
  if (inline !== undefined) return inline.slice(prefix.length);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function commandFrom(argv: readonly string[]): Command {
  const value = argv[0] ?? "plan";
  if (value === "plan" || value === "publish" || value === "reconcile" || value === "create-bucket" || value === "reconcile-bucket") return value;
  throw new Error("Usage: t8-greenfield-publish.ts <plan|publish|reconcile|create-bucket|reconcile-bucket> [--artifact-file path] [--idempotency-key key]");
}

async function jsonInput(path: string): Promise<unknown> {
  const text = await readFile(path, "utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Artifact input is not valid JSON");
  }
}

async function artifactFromArgs(argv: readonly string[]): Promise<T8ArtifactInput> {
  const artifactFile = argument(argv, "--artifact-file");
  const profileRowsFile = argument(argv, "--profile-rows");
  const runRowsFile = argument(argv, "--run-rows");
  const artifactJson = argument(argv, "--artifact-json");
  const supplied = [artifactFile, profileRowsFile, runRowsFile, artifactJson].filter((value): value is string => value !== null);
  if (supplied.length !== 1) {
    throw new Error("Provide exactly one of --artifact-file, --profile-rows, --run-rows, or --artifact-json");
  }
  if (artifactFile !== null) return { artifact: await jsonInput(artifactFile), binding: null };
  if (profileRowsFile !== null) {
    const rows = (await jsonInput(profileRowsFile)) as FrozenAgentProfileRows;
    return { artifact: buildAgentProfileArtifact(rows), binding: agentProfileArtifactBinding(rows) };
  }
  if (runRowsFile !== null) {
    const rows = (await jsonInput(runRowsFile)) as FrozenRunBundleRows;
    return { artifact: buildRunBundleArtifact(rows), binding: runBundleArtifactBinding(rows) };
  }
  try {
    return { artifact: JSON.parse(artifactJson ?? "") as unknown, binding: null };
  } catch {
    throw new Error("--artifact-json is not valid JSON");
  }
}

export function publicationConfiguration(config: T8GreenfieldCliConfig): PublicationConfiguration {
  const sealBackoffMs = [...T8_GREENFIELD_SEAL_BACKOFF_MS];
  const backoffBudgetMs = t8GreenfieldSealBackoffBudgetMs(T8_GREENFIELD_MAX_SEAL_POLLS, sealBackoffMs);
  if (T8_GREENFIELD_LEASE_DURATION_MS <= backoffBudgetMs) {
    throw new Error("T8 Greenfield lease must exceed its seal polling backoff budget");
  }
  return {
    environment: config.environment,
    enabledProviders: ["greenfield"],
    ipfs: { network: "disabled", providerLabel: "disabled-ipfs" },
    greenfield: {
      network: config.network,
      providerLabel: "official-greenfield-js-sdk-2-2-0",
      bucket: config.bucket
    },
    maxArtifactBytes: 10_000_000,
    maxObjectBytes: 10_000_000,
    maxSealPolls: T8_GREENFIELD_MAX_SEAL_POLLS,
    sealBackoffMs,
    leaseDurationMs: T8_GREENFIELD_LEASE_DURATION_MS
  };
}

function safePlan(config: T8GreenfieldCliConfig, artifact: unknown, idempotencyKey: string): Record<string, unknown> {
  const digest = digestArtifact(artifact);
  const publication = publicationConfiguration(config);
  return {
    command: "plan",
    enabled: config.enabled,
    liveWriteEnabled: config.liveWriteEnabled && config.canaryApproved,
    network: config.network,
    chainId: config.chainId,
    bucket: config.bucket,
    storageProvider: config.spEndpoint === null ? "official-sdk-primary-sp-resolution" : "configured-sp-endpoint",
    spEndpointConfigured: config.spEndpoint !== null,
    artifactType: digest.artifact.artifactType,
    artifactId: digest.artifact.artifactId,
    version: digest.artifact.version,
    idempotencyKey,
    objectName: deterministicObjectName(digest.artifact),
    sizeBytes: digest.sizeBytes,
    sha256Digest: digest.sha256Digest,
    keccak256Digest: digest.keccak256Digest,
    configurationDigest: greenfieldConfigurationDigest({
      network: config.network,
      chainId: config.chainId,
      bucket: config.bucket,
      creator: config.creator,
      ...(config.spEndpoint === null ? {} : { spEndpoint: config.spEndpoint })
    }),
    publicationConfiguration: publication
  };
}

function requireLiveWrite(
  config: T8GreenfieldCliConfig,
  binding: GreenfieldArtifactBinding | null,
  artifactType: string
): void {
  if (!config.enabled || !config.liveWriteEnabled || !config.canaryApproved) {
    throw new Error("T8 Greenfield live operations are disabled; require T8_GREENFIELD_ENABLED, T8_GREENFIELD_LIVE_WRITE_ENABLED, and T8_GREENFIELD_CANARY_APPROVED");
  }
  if (config.rpcUrl === null || config.databaseUrl === null || config.creator === "" || config.keyReference === null) {
    throw new Error("T8 Greenfield live configuration is incomplete");
  }
  if (config.spEndpoint === null) {
    throw new Error("T8 Greenfield live configuration requires a pinned storage-provider endpoint");
  }
  if ((artifactType === "agent_profile" || artifactType === "run_bundle") && binding === null) {
    throw new Error("T8 Greenfield profile/run publication requires persisted --profile-rows or --run-rows bindings");
  }
}

function requireBucketLiveWrite(config: T8GreenfieldCliConfig): void {
  if (!config.enabled || !config.liveWriteEnabled || !config.canaryApproved) {
    throw new Error("T8 Greenfield bucket creation is disabled; require T8_GREENFIELD_ENABLED, T8_GREENFIELD_LIVE_WRITE_ENABLED, and T8_GREENFIELD_CANARY_APPROVED");
  }
  if (config.rpcUrl === null || config.creator === "" || config.keyReference === null || config.spEndpoint === null) {
    throw new Error("T8 Greenfield bucket creation configuration is incomplete");
  }
}

function safeBucketResult(result: GreenfieldBucketEnsureReceipt | GreenfieldBucketReconcileReceipt): Record<string, unknown> {
  return {
    status: result.status,
    bucketName: result.bucketName,
    owner: result.owner,
    primarySpAddress: result.primarySpAddress,
    visibility: result.visibility,
    creationTransactionHash: result.creationTransactionHash
  };
}

function safeResult(result: { readonly state: string; readonly attemptId: string; readonly providerReference: string | null; readonly sealTransactionHash: string | null; readonly locator: { readonly uri: string } | null; readonly verification: { readonly status: string } | null }): Record<string, unknown> {
  return {
    state: result.state,
    attemptId: result.attemptId,
    providerReference: result.providerReference,
    sealTransactionHash: result.sealTransactionHash,
    internalUri: result.locator?.uri ?? null,
    verificationStatus: result.verification?.status ?? null
  };
}

export async function runT8GreenfieldCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<Record<string, unknown>> {
  const command = commandFrom(argv);
  const locked = await readLockedGreenfieldRuntime();
  const config = applyLockedRuntime(readT8GreenfieldCliConfig(env), locked);
  if (command === "reconcile-bucket") {
    if (config.rpcUrl === null || config.creator === "" || config.spEndpoint === null) {
      throw new Error("T8 Greenfield bucket reconciliation configuration is incomplete");
    }
    const greenfield = new GreenfieldSdkPublisher({
      network: config.network,
      chainId: config.chainId,
      rpcUrl: config.rpcUrl,
      bucket: config.bucket,
      creator: config.creator,
      keyReference: "T8_READ_ONLY_RECONCILIATION",
      loadSecret: () => {
        throw new Error("T8 Greenfield read-only reconciliation cannot load secrets");
      },
      spEndpoint: config.spEndpoint,
      publicBaseUrl: config.publicReadBaseUrl as string,
      standardsPins: locked.pins
    });
    return safeBucketResult(await greenfield.reconcileCanaryBucket());
  }
  if (command === "create-bucket") {
    requireBucketLiveWrite(config);
    const greenfield = new GreenfieldSdkPublisher({
      network: config.network,
      chainId: config.chainId,
      rpcUrl: config.rpcUrl as string,
      bucket: config.bucket,
      creator: config.creator,
      keyReference: config.keyReference as string,
      loadSecret: createGreenfieldEnvironmentSecretLoader(env),
      spEndpoint: config.spEndpoint as string,
      publicBaseUrl: config.publicReadBaseUrl as string,
      standardsPins: locked.pins
    });
    return safeBucketResult(await greenfield.ensureCanaryBucket());
  }
  const input = await artifactFromArgs(argv);
  const artifact = input.artifact;
  const binding = input.binding;
  const digest = digestArtifact(artifact);
  const idempotencyKey = argument(argv, "--idempotency-key") ?? `${digest.artifact.artifactId}:${digest.artifact.version}`;
  if (command === "plan") return safePlan(config, artifact, idempotencyKey);
  requireLiveWrite(config, binding, digest.artifact.artifactType);

  const publication = publicationConfiguration(config);
  const { adapter, pool } = createGreenfieldPostgresAdapter(config.databaseUrl as string);
  try {
    const store = new PersistentEvidencePublicationStore(
      adapter,
      binding === null
        ? undefined
        : {
            evidenceObjectIdForAttempt: (record) => deterministicEvidenceObjectIdForBinding(record, binding),
            evidenceObjectFactory: { create: (record) => defaultEvidenceObjectForAttempt(record, binding) }
          }
    );
    const greenfield = new GreenfieldSdkPublisher({
      network: config.network,
      chainId: config.chainId,
      rpcUrl: config.rpcUrl as string,
      bucket: config.bucket,
      creator: config.creator,
      keyReference: config.keyReference as string,
      loadSecret: createGreenfieldEnvironmentSecretLoader(env),
      spEndpoint: config.spEndpoint as string,
      publicBaseUrl: config.publicReadBaseUrl as string,
      standardsPins: locked.pins
    });
    const publisher = new EvidencePublisher({ store, configuration: publication, greenfield, sleep: t8GreenfieldSleep });
    const result = command === "publish"
      ? (await publisher.publish({ artifact, idempotencyKey })).attempts.find((attempt) => attempt.provider === "greenfield")
      : await publisher.reconcile({ artifact, idempotencyKey, provider: "greenfield" });
    if (result === undefined) throw new Error("Greenfield publication attempt was not returned");
    return safeResult(result);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const result = await runT8GreenfieldCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "T8 Greenfield command failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
