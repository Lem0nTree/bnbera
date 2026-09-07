/**
 * Disabled-by-default T5 reference-provider worker.
 *
 * This command composes one configured chain-97 identity/job with the
 * existing PostgreSQL ERC-8183 repositories and Altana commerce service. It
 * never migrates a database, creates a job, or chooses a second transaction
 * writer. Enablement is process-level and requires the local canary guards in
 * `referenceProviderRunnerConfigFromEnvironment`; all output is sanitized.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  BNB_TESTNET,
  createClient,
  signerFromPrivateKey
} from "@altananetwork/sdk";
import type { Hex } from "viem";
import {
  CommerceError,
  createReferenceProviderWorkerComposition,
  referenceProviderRunnerConfigFromEnvironment,
  referenceProviderSecretReferenceSchema,
  referenceProviderTaskInputSchema,
  type Erc8183AltanaAuthority,
  type ReferenceProviderAuthorityResolver,
  type ReferenceProviderRunResult,
  type ReferenceProviderTaskInput
} from "../packages/agent-commerce/src/index.ts";
import { normalizeAddress } from "../packages/agent-commerce/src/validation.ts";
import { createDb } from "../packages/db/src/client.ts";

type WorkerEnvironment = Readonly<Record<string, string | undefined>>;
type WorkerDb = {
  readonly pool: Parameters<typeof createReferenceProviderWorkerComposition>[0]["pool"];
  readonly close: () => Promise<void>;
};

export type ReferenceProviderWorkerDependencies = {
  readonly readStandardsLock?: () => Promise<unknown>;
  readonly createDatabase?: (connectionString: string, options: { readonly ssl: boolean }) => WorkerDb;
  readonly compose?: typeof createReferenceProviderWorkerComposition;
  readonly resolveAuthority?: (env: WorkerEnvironment) => ReferenceProviderAuthorityResolver;
};

export type ReferenceProviderWorkerOutput = {
  readonly status: ReferenceProviderRunResult["status"];
  readonly idempotencyKey: string;
  readonly writesBroadcast: boolean;
  readonly operation: {
    readonly operationId: string;
    readonly status: string;
    readonly transactionHash: `0x${string}` | null;
    readonly blockNumber: string | null;
  } | null;
  readonly submission?: {
    readonly resultDigest: string;
    readonly chainDeliverable: `0x${string}`;
  };
};

function nonEmpty(env: WorkerEnvironment, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function safeErrorCode(error: unknown, fallback = "REFERENCE_PROVIDER_WORKER_FAILED"): string {
  const candidate = error instanceof CommerceError
    ? error.code
    : typeof error === "object" && error !== null && "code" in error
      ? String((error as { readonly code?: unknown }).code ?? "")
      : "";
  return /^[A-Z0-9_]{1,64}$/u.test(candidate) ? candidate : fallback;
}

function databaseFromEnvironment(connectionString: string, options: { readonly ssl: boolean }): WorkerDb {
  const database = createDb(connectionString, options);
  return { pool: database.pool, close: () => database.pool.end() };
}

async function standardsLockFromRepository(): Promise<unknown> {
  const path = fileURLToPath(new URL("../config/standards.lock.json", import.meta.url));
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

/** Parse the one public task/snapshot selected for the configured job. */
export function referenceProviderTaskInputFromEnvironment(env: WorkerEnvironment): ReferenceProviderTaskInput {
  const raw = nonEmpty(env, "T5_REFERENCE_PROVIDER_TASK_INPUT_JSON");
  if (raw === undefined) {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The enabled reference provider is missing its public task input fixture.", nextAction: "configure_reference_provider" });
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (cause) {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The reference provider task input fixture is not valid JSON.", nextAction: "configure_reference_provider", cause });
  }
  try {
    return referenceProviderTaskInputSchema.parse(value);
  } catch (cause) {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The reference provider task input fixture is invalid.", nextAction: "configure_reference_provider", cause });
  }
}

/**
 * Resolve only an `env://NAME` secret reference. The raw key exists only in
 * this process while constructing the pinned Altana wallet; it is never part
 * of the runner config, database rows, result, error, or CLI output. Other
 * secret-manager schemes fail closed until an explicitly reviewed resolver
 * is supplied by the host process.
 */
export function createReferenceProviderAuthorityResolver(env: WorkerEnvironment): ReferenceProviderAuthorityResolver {
  return async (reference): Promise<Erc8183AltanaAuthority> => {
    const parsed = referenceProviderSecretReferenceSchema.parse(reference);
    const match = /^env:\/\/([A-Za-z_][A-Za-z0-9_]*)$/u.exec(parsed);
    if (match === null) {
      throw new CommerceError({ code: "COMMERCE_DISABLED", message: "This reference worker has no resolver for the configured secret-manager scheme.", nextAction: "configure_secret_reference" });
    }
    const secretName = match[1];
    const rawKey = secretName === undefined ? undefined : nonEmpty(env, secretName);
    if (rawKey === undefined || !/^0x[0-9a-f]{64}$/iu.test(rawKey)) {
      throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The configured provider authority secret reference could not be resolved.", nextAction: "configure_secret_reference" });
    }
    const configuredProvider = nonEmpty(env, "T5_REFERENCE_PROVIDER_ADDRESS");
    if (configuredProvider === undefined) {
      throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The enabled reference provider is missing its configured provider address.", nextAction: "configure_reference_provider" });
    }
    let providerAddress: `0x${string}`;
    try {
      providerAddress = normalizeAddress(configuredProvider, "configured provider address");
    } catch {
      throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The configured provider address is invalid.", nextAction: "configure_reference_provider" });
    }
    let signer: ReturnType<typeof signerFromPrivateKey>;
    try {
      signer = signerFromPrivateKey(rawKey as Hex);
    } catch {
      throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The configured provider authority secret reference is invalid.", nextAction: "configure_secret_reference" });
    }
    let signerAddress: `0x${string}`;
    try {
      signerAddress = normalizeAddress(signer.address, "derived provider signer address");
    } catch {
      throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The configured provider authority signer address is invalid.", nextAction: "configure_secret_reference" });
    }
    if (signerAddress !== providerAddress) {
      throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The derived provider signer does not match the configured provider address.", nextAction: "configure_secret_reference" });
    }
    try {
      const client = createClient({ chains: [BNB_TESTNET], defaultChainId: 97 });
      const wallet = await client.createWallet({ signer });
      if (normalizeAddress(wallet.address, "derived provider wallet address") !== providerAddress) {
        throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The derived provider wallet does not match the configured provider address.", nextAction: "configure_secret_reference" });
      }
      return { wallet, signer };
    } catch (cause) {
      // Do not expose SDK errors or any value derived from the private key.
      // The only durable authority evidence is the public signer/wallet
      // address already recorded by the commerce operation boundary.
      if (cause instanceof CommerceError) throw cause;
      throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The configured provider authority wallet could not be created.", nextAction: "configure_secret_reference" });
    }
  };
}

export function sanitizeReferenceProviderRun(result: ReferenceProviderRunResult): ReferenceProviderWorkerOutput {
  return {
    status: result.status,
    idempotencyKey: result.idempotencyKey,
    // A fresh confirmed operation is the only runner status that means this
    // invocation submitted a new write. Replays/reconciliations are false.
    writesBroadcast: result.status === "submitted",
    operation: result.operation === null ? null : {
      operationId: result.operation.operationId,
      status: result.operation.status,
      transactionHash: result.operation.transactionHash,
      blockNumber: result.operation.blockNumber
    },
    ...(result.submission === undefined ? {} : {
      submission: {
        resultDigest: result.submission.result.resultDigest,
        chainDeliverable: result.submission.chainDeliverable
      }
    })
  };
}

/**
 * Run once and close the PostgreSQL pool. The disabled branch returns before
 * reading the lock, opening a database, resolving a secret, or constructing a
 * chain adapter.
 */
export async function runReferenceProviderWorker(input: {
  readonly env?: WorkerEnvironment;
  readonly dependencies?: ReferenceProviderWorkerDependencies;
} = {}): Promise<ReferenceProviderRunResult> {
  const env = input.env ?? process.env;
  const dependencies = input.dependencies ?? {};
  const config = referenceProviderRunnerConfigFromEnvironment(env);
  if (!config.enabled) {
    return { status: "disabled", idempotencyKey: "disabled", operation: null };
  }
  const databaseUrl = nonEmpty(env, "DATABASE_URL");
  if (databaseUrl === undefined) {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The enabled reference provider is missing DATABASE_URL.", nextAction: "configure_database" });
  }
  const taskInput = referenceProviderTaskInputFromEnvironment(env);
  const readLock = dependencies.readStandardsLock ?? standardsLockFromRepository;
  const createDatabase = dependencies.createDatabase ?? databaseFromEnvironment;
  const compose = dependencies.compose ?? createReferenceProviderWorkerComposition;
  const resolveAuthority = dependencies.resolveAuthority?.(env) ?? createReferenceProviderAuthorityResolver(env);
  const standardsLock = await readLock();
  const database = createDatabase(databaseUrl, { ssl: env.DATABASE_SSL === "true" });
  try {
    const composition = compose({
      config,
      standardsLock,
      pool: database.pool,
      taskInput,
      resolveAuthority
    });
    return await composition.runner.run();
  } finally {
    await database.close();
  }
}

async function main(): Promise<void> {
  try {
    const result = await runReferenceProviderWorker();
    process.stdout.write(`${JSON.stringify(sanitizeReferenceProviderRun(result))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "blocked", writesBroadcast: false, errorCode: safeErrorCode(error) })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
