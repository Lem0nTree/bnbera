/**
 * T5 reference-provider setup and publication plan.
 *
 * The default mode is read-only. It never registers an ERC-8004 identity,
 * writes a listing, or resolves the provider authority secret. `--publish`
 * remains separately guarded by T5_REFERENCE_PROVIDER_PUBLISH=true and only
 * calls the existing marketplace publication boundary after ownership and
 * finalized identity evidence have been observed.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { referenceProviderSecretReferenceSchema } from "../packages/agent-commerce/src/reference-provider.ts";
import { createDb } from "../packages/db/src/client.ts";
import { PostgresMarketplacePublicationService, type MarketplacePublicationPool } from "../packages/marketplace/src/publication.ts";
import { capabilityManifestSchema, evmAddressSchema, erc8004IdentitySchema, type Erc8004Identity } from "../packages/domain/src/index.ts";

const CHAIN_ID = 97 as const;
const DEFAULT_PRICE_ATOMIC = "1000000000000000"; // 0.001 U; bounded below the 0.01 U policy cap.
const MAX_PRICE_ATOMIC = "10000000000000000";
const controlPattern = /[\u0000-\u001f\u007f]/u;

type QueryPool = MarketplacePublicationPool;

export type ReferenceProviderSetupConfig = {
  readonly identity: Erc8004Identity;
  readonly providerAddress: string;
  readonly cardUrl: string;
  readonly serviceUrl: string;
  readonly priceAtomic: string;
  readonly secretReferenceConfigured: boolean;
};

export type ReferenceProviderSetupReport = {
  readonly status: "ready_to_publish" | "blocked" | "published" | "withheld";
  readonly code: string;
  readonly identity: Erc8004Identity;
  readonly providerAddress: string;
  readonly cardUrl: string;
  readonly serviceUrl: string;
  readonly priceAtomic: string;
  readonly secretReferenceConfigured: boolean;
  readonly broadcast: false;
  readonly registrationPlan: {
    readonly chainId: 97;
    readonly identityRegistry: string;
    readonly agentId: string;
    readonly agentUri: string;
    readonly agentWallet: string;
    readonly ownerActions: readonly ["register_agent_uri", "set_agent_wallet"];
    readonly broadcast: false;
    readonly requiresExplicitOwnerAction: true;
  };
  readonly diagnostics?: readonly string[];
};

type IdentityRow = {
  readonly id: string;
  readonly namespace: string;
  readonly chain_id: number;
  readonly identity_registry: string;
  readonly agent_id: string;
  readonly owner_address: string | null;
  readonly agent_wallet: string | null;
  readonly agent_uri: string | null;
  readonly observed_block: number | string | null;
  readonly observed_block_hash: string | null;
  readonly read_consistency: string | null;
};

type ExistingVersionRow = {
  readonly public_metadata: Record<string, unknown> | null;
  readonly capability_manifest: Record<string, unknown> | null;
};

type ExistingServiceRow = {
  readonly url: string;
  readonly validation_status: string;
};

type LockedCommerceTerms = {
  readonly paymentToken: string;
  readonly paymentTokenSymbol: string;
  readonly paymentDecimals: number;
  readonly maxBudgetAtomic: string;
};

function nonEmpty(name: string): string | null {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? null : value;
}

function requiredAddress(value: string | null, label: string): string {
  const parsed = evmAddressSchema.safeParse(value);
  if (!parsed.success) throw new Error(`${label} is not a valid public EVM address.`);
  return parsed.data.toLowerCase();
}

function requiredUrl(value: string | null, label: string): string {
  if (value === null || controlPattern.test(value)) throw new Error(`${label} is not configured.`);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${label} is not a valid URL.`); }
  if (parsed.username !== "" || parsed.password !== "" || parsed.hash !== "" || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) throw new Error(`${label} must be a credential-free HTTP(S) URL.`);
  return parsed.toString();
}

function boundedPrice(value: string | null): string {
  const atomic = value ?? DEFAULT_PRICE_ATOMIC;
  if (!/^[1-9][0-9]*$/u.test(atomic) || BigInt(atomic) > BigInt(MAX_PRICE_ATOMIC)) throw new Error("The reference provider price must be a positive amount no greater than 0.01 U.");
  return BigInt(atomic).toString(10);
}

async function lockedCommerceTerms(): Promise<LockedCommerceTerms> {
  const path = fileURLToPath(new URL("../config/standards.lock.json", import.meta.url));
  const lock = JSON.parse(await readFile(path, "utf8")) as {
    readonly networks?: Record<string, {
      readonly erc8004?: { readonly identityRegistry?: unknown };
      readonly erc8183?: {
        readonly paymentToken?: unknown;
        readonly paymentTokenSymbol?: unknown;
        readonly paymentDecimals?: unknown;
        readonly riskLimits?: { readonly maxBudgetAtomic?: unknown };
      };
    }>;
  };
  const network = lock.networks?.[String(CHAIN_ID)];
  const paymentToken = requiredAddress(typeof network?.erc8183?.paymentToken === "string" ? network.erc8183.paymentToken : null, "The standards-locked ERC-8183 payment token");
  const paymentTokenSymbol = network?.erc8183?.paymentTokenSymbol;
  const paymentDecimals = network?.erc8183?.paymentDecimals;
  const maxBudgetAtomic = network?.erc8183?.riskLimits?.maxBudgetAtomic;
  if (typeof paymentTokenSymbol !== "string" || paymentTokenSymbol.trim() === "" || typeof paymentDecimals !== "number" || !Number.isSafeInteger(paymentDecimals) || paymentDecimals < 0 || paymentDecimals > 255 || typeof maxBudgetAtomic !== "string" || !/^[1-9][0-9]*$/u.test(maxBudgetAtomic)) {
    throw new Error("The standards-locked ERC-8183 payment terms are incomplete.");
  }
  return {
    paymentToken,
    paymentTokenSymbol,
    paymentDecimals,
    maxBudgetAtomic
  };
}

export async function referenceProviderConfigFromEnvironment(): Promise<ReferenceProviderSetupConfig> {
  const commerceTerms = await lockedCommerceTerms();
  if (BigInt(commerceTerms.maxBudgetAtomic) !== BigInt(MAX_PRICE_ATOMIC)) {
    throw new Error("The reference provider price cap does not match the standards-locked ERC-8183 risk limit.");
  }
  const path = fileURLToPath(new URL("../config/standards.lock.json", import.meta.url));
  const lock = JSON.parse(await readFile(path, "utf8")) as { readonly networks?: Record<string, { readonly erc8004?: { readonly identityRegistry?: unknown } }> };
  const registry = lock.networks?.[String(CHAIN_ID)]?.erc8004?.identityRegistry;
  const agentId = nonEmpty("T5_REFERENCE_PROVIDER_AGENT_ID");
  const identity = erc8004IdentitySchema.parse({
    namespace: "eip155",
    chainId: CHAIN_ID,
    identityRegistry: requiredAddress(typeof registry === "string" ? registry : null, "The standards-locked ERC-8004 identity registry"),
    agentId: agentId ?? "0"
  });
  const providerAddress = requiredAddress(nonEmpty("T5_REFERENCE_PROVIDER_ADDRESS") ?? nonEmpty("WALLET_ADDRESS"), "The reference provider address");
  const secretReference = nonEmpty("T5_REFERENCE_PROVIDER_SECRET_REFERENCE");
  if (secretReference !== null && !referenceProviderSecretReferenceSchema.safeParse(secretReference).success) {
    throw new Error("T5_REFERENCE_PROVIDER_SECRET_REFERENCE must be a supported secret-manager reference; raw credentials are not accepted.");
  }
  const base = nonEmpty("T5_REFERENCE_PROVIDER_PUBLIC_BASE_URL") ?? nonEmpty("APP_URL");
  const baseUrl = requiredUrl(base, "The reference provider public base URL").replace(/\/$/u, "");
  const cardUrl = requiredUrl(nonEmpty("T5_REFERENCE_PROVIDER_CARD_URL") ?? `${baseUrl}/api/reference-provider/agent-card`, "The reference provider card URL");
  const serviceUrl = requiredUrl(nonEmpty("T5_REFERENCE_PROVIDER_SERVICE_URL") ?? cardUrl, "The reference provider service URL");
  return {
    identity,
    providerAddress,
    cardUrl,
    serviceUrl,
    priceAtomic: boundedPrice(nonEmpty("T5_REFERENCE_PROVIDER_PRICE_ATOMIC")),
    secretReferenceConfigured: secretReference !== null
  };
}

function registrationPlan(config: ReferenceProviderSetupConfig): ReferenceProviderSetupReport["registrationPlan"] {
  return {
    chainId: CHAIN_ID,
    identityRegistry: config.identity.identityRegistry,
    agentId: config.identity.agentId,
    agentUri: config.cardUrl,
    agentWallet: config.providerAddress,
    ownerActions: ["register_agent_uri", "set_agent_wallet"],
    broadcast: false,
    requiresExplicitOwnerAction: true
  };
}

export async function inspectReferenceProviderSetup(pool: QueryPool, config: ReferenceProviderSetupConfig, options: { readonly publish?: boolean } = {}): Promise<ReferenceProviderSetupReport> {
  const result = await pool.query<IdentityRow>(
    `SELECT i.id, i.namespace, i.chain_id, i.identity_registry, i.agent_id,
            i.owner_address, i.agent_wallet, i.agent_uri,
            i.observed_block, i.observed_block_hash, i.read_consistency
       FROM erc8004_identities i
      WHERE i.namespace = $1 AND i.chain_id = $2 AND i.identity_registry = $3 AND i.agent_id = $4
      LIMIT 1`,
    [config.identity.namespace, config.identity.chainId, config.identity.identityRegistry, config.identity.agentId]
  );
  const row = result.rows[0];
  const base = {
    identity: config.identity,
    providerAddress: config.providerAddress,
    cardUrl: config.cardUrl,
    serviceUrl: config.serviceUrl,
    priceAtomic: config.priceAtomic,
    secretReferenceConfigured: config.secretReferenceConfigured,
    broadcast: false as const,
    registrationPlan: registrationPlan(config)
  };
  if (row === undefined) {
    return { ...base, status: "blocked", code: "OWNED_IDENTITY_REQUIRED", diagnostics: ["No retained ERC-8004 identity matches the requested full identity tuple.", "Complete the explicit owner-authorized testnet registration/setAgentWallet flow, then rerun ingestion before publication."] };
  }
  const ownerMatches = row.owner_address?.toLowerCase() === config.providerAddress || row.agent_wallet?.toLowerCase() === config.providerAddress;
  if (!ownerMatches) {
    return { ...base, status: "blocked", code: "IDENTITY_NOT_OWNED", diagnostics: ["The retained identity owner and agentWallet do not match the configured BNBEra provider address.", "The setup refuses to assign price or provider authority to this external identity."] };
  }
  if (row.agent_uri === null || row.agent_uri.trim() === "") {
    return { ...base, status: "blocked", code: "AGENT_URI_REQUIRED", diagnostics: ["The owned identity has no observed agent card URI for the reference provider.", "Register the card URI and rerun ERC-8004 ingestion before publication."] };
  }
  if (row.agent_uri !== config.cardUrl) {
    return { ...base, status: "blocked", code: "AGENT_URI_MISMATCH", diagnostics: ["The owned identity points at a different public card URI.", "The setup refuses to relabel an existing identity as the BNBEra reference provider."] };
  }
  const observedBlock = typeof row.observed_block === "string" ? Number(row.observed_block) : row.observed_block;
  if (row.read_consistency !== "finalized" || observedBlock === null || !Number.isSafeInteger(observedBlock) || observedBlock < 0 || row.observed_block_hash === null || !/^0x[0-9a-f]{64}$/iu.test(row.observed_block_hash)) {
    return { ...base, status: "blocked", code: "IDENTITY_READ_NOT_FINALIZED", diagnostics: ["Ownership and card URI are present, but the retained ERC-8004 read is not finalized with block provenance.", "Rerun the finalized registry ingestion before publication."] };
  }
  if (options.publish !== true) {
    return { ...base, status: "ready_to_publish", code: "OWNED_IDENTITY_READY", diagnostics: ["Ownership is proven by the retained owner/agentWallet row. Publication remains opt-in and uses the existing publication boundary."] };
  }
  if (!config.secretReferenceConfigured) {
    return { ...base, status: "withheld", code: "PROVIDER_SECRET_REFERENCE_REQUIRED", diagnostics: ["The owned reference provider has no configured secret-manager authority reference.", "Publication is withheld until the worker can resolve the provider authority without receiving a raw credential."] };
  }
  const versions = await pool.query<ExistingVersionRow>(
    `SELECT av.public_metadata, av.capability_manifest
       FROM agent_versions av
       JOIN agents a ON a.id = av.agent_id
      WHERE a.identity_id = $1
      ORDER BY av.version DESC, av."createdAt" DESC
      LIMIT 1`,
    [row.id]
  );
  const existing = versions.rows[0];
  if (existing?.capability_manifest === null || existing?.capability_manifest === undefined) {
    return { ...base, status: "withheld", code: "CAPABILITY_INGESTION_REQUIRED", diagnostics: ["Run the bounded ERC-8004 ingestion/probe path first; publication will not invent a capability observation."] };
  }
  const capability = capabilityManifestSchema.safeParse(existing.capability_manifest);
  if (!capability.success || !capability.data.capabilities.some((entry) => entry.id === "health_factor_monitor")) {
    return { ...base, status: "withheld", code: "REFERENCE_CAPABILITY_REQUIRED", diagnostics: ["The retained capability observation does not prove the reference health-factor skill.", "The setup refuses to assign the reference price to an unrelated capability."] };
  }
  const serviceObservations = await pool.query<ExistingServiceRow>(
    `SELECT url, validation_status
       FROM agent_service_observations
      WHERE identity_id = $1 AND url = $2
      ORDER BY observed_at DESC, id DESC
      LIMIT 1`,
    [row.id, config.serviceUrl]
  );
  const serviceObservation = serviceObservations.rows[0];
  if (serviceObservation?.validation_status !== "healthy") {
    return { ...base, status: "withheld", code: "REFERENCE_SERVICE_REQUIRED", diagnostics: ["The configured reference service has no healthy retained observation.", "Run the bounded card/service health probe before publication."] };
  }
  const commerceTerms = await lockedCommerceTerms();
  if (BigInt(commerceTerms.maxBudgetAtomic) !== BigInt(MAX_PRICE_ATOMIC)) {
    return { ...base, status: "withheld", code: "PRICE_CAP_LOCK_MISMATCH", diagnostics: ["The configured reference price cap does not match the standards-locked ERC-8183 risk limit."] };
  }
  const publication = new PostgresMarketplacePublicationService(pool);
  const published = await publication.publish({
    identity: config.identity,
    publicMetadata: existing.public_metadata ?? { name: "BNBEra Reference Health-Factor Provider", description: "BNBEra-operated health-factor reference provider." },
    capabilityManifest: existing.capability_manifest,
    pricingManifest: {
      model: "fixed",
      network: CHAIN_ID,
      tokenSymbol: commerceTerms.paymentTokenSymbol,
      tokenAddress: commerceTerms.paymentToken,
      decimals: commerceTerms.paymentDecimals,
      amountAtomic: config.priceAtomic,
      minAtomic: config.priceAtomic,
      maxAtomic: config.priceAtomic,
      source: "t5_reference_provider_setup"
    }
  });
  return {
    ...base,
    status: published.status === "published" ? "published" : "withheld",
    code: published.status === "published" ? "PUBLISHED" : "PUBLICATION_WITHHELD",
    diagnostics: published.diagnostics.map((entry) => entry.code)
  };
}

function parsePublishFlag(args: readonly string[]): boolean {
  if (args.includes("--plan")) return false;
  if (!args.includes("--publish")) return false;
  return process.env.T5_REFERENCE_PROVIDER_PUBLISH === "true";
}

async function main(): Promise<void> {
  const config = await referenceProviderConfigFromEnvironment();
  const databaseUrl = nonEmpty("DATABASE_URL");
  if (databaseUrl === null) {
    console.log(JSON.stringify({ status: "blocked", code: "DATABASE_REQUIRED", broadcast: false }, null, 2));
    return;
  }
  const db = createDb(databaseUrl, { ssl: process.env.DATABASE_SSL === "true" });
  try {
    const publishRequested = process.argv.includes("--publish");
    const publishEnabled = parsePublishFlag(process.argv.slice(2));
    const report = await inspectReferenceProviderSetup(db.pool, config, { publish: publishEnabled });
    console.log(JSON.stringify({ ...report, publishRequested, publishEnabled }, null, 2));
  } finally {
    await db.pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
