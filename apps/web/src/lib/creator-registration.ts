import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  BNB_TESTNET,
  encodeErc8004AgentUri,
  withErc8004Registration,
  type Erc8004RegistrationFile,
} from "@altananetwork/sdk";
import { assertSafePublicNetworkTarget } from "@bnbera/agent-ingestion";
import { canonicalRuntimeConfiguration, canonicalRuntimeConfigurationDigest, creatorTemplate, type CreatorRuntimeConfiguration } from "./creator-contract";
import { isNativeStudioAgentCardUrl } from "./creator-studio";
import type { Chain } from "viem";

/** The T7 registration target is pinned by the active standards lock. */
export const CREATOR_ERC8004_CHAIN_ID = 97 as const;
export const CREATOR_ERC8004_REGISTRY = "0x8004a818bfb912233c491871b3d84c89a494bd9e" as const;
export const CREATOR_ERC8004_REGISTRY_ADDRESS = CREATOR_ERC8004_REGISTRY;
export const CREATOR_ERC8004_IDENTITY_REGISTRY = CREATOR_ERC8004_REGISTRY;
export const CREATOR_ERC8004_BROWSER_OPERATION = "CREATOR_ERC8004_BROWSER_OPERATION" as const;
export const CREATOR_ERC8004_BROWSER_INTENT = "CREATOR_ERC8004_BROWSER_INTENT" as const;
export const CREATOR_ERC8004_BROWSER_MINT_INTENT = "CREATOR_ERC8004_BROWSER_MINT_INTENT" as const;
export const CREATOR_ERC8004_BROWSER_MINT_RESULT = "CREATOR_ERC8004_BROWSER_MINT_RESULT" as const;
export const CREATOR_ERC8004_BROWSER_URI_INTENT = "CREATOR_ERC8004_BROWSER_URI_INTENT" as const;
export const CREATOR_ERC8004_BROWSER_URI_RESULT = "CREATOR_ERC8004_BROWSER_URI_RESULT" as const;
export const CREATOR_ERC8004_BROWSER_RECONCILE = "CREATOR_ERC8004_BROWSER_RECONCILE" as const;

const registrationFileType = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" as const;
const maxRegistrationAgentId = BigInt(Number.MAX_SAFE_INTEGER);
/** Each registry scan is bounded; the cursor is advanced in deployment_events. */
const reconcileBlockWindow = 2_000n;

export type CreatorRegistrationPhase = "mint" | "uri";
export type CreatorRegistrationResultStatus = "CONFIRMED" | "PENDING" | "FAILED" | "UNKNOWN";
export type CreatorRegistrationState =
  | "not_started"
  | "mint_intent"
  | "mint_pending"
  | "mint_confirmed"
  | "uri_intent"
  | "uri_pending"
  | "registered"
  | "failed";

export type CreatorRegistrationExtension = {
  readonly template: string;
  readonly templateDigest: string;
  readonly configurationDigest: string;
  readonly tradingPair: CreatorRuntimeConfiguration["tradingPair"];
};

/** ERC-8004 service metadata with the A2A protocol field used by ingestion. */
export type CreatorRegistrationA2AService = Erc8004RegistrationFile["services"][number] & {
  readonly protocolVersion: "0.3.0";
};

/**
 * The SDK type intentionally models the standard fields only. The extension
 * is public metadata (not an instruction), and is retained by the SDK's
 * `withErc8004Registration` object spread. It makes the selected pair and
 * exact runtime digest independently recoverable from the URI.
 */
export type CreatorRegistrationFile = Omit<Erc8004RegistrationFile, "services"> & {
  readonly services: CreatorRegistrationA2AService[];
  readonly "x-bnbera": CreatorRegistrationExtension;
};

export type CreatorRegistrationIntent = {
  readonly deploymentId: string;
  readonly operationId: string;
  readonly chainId: 97;
  readonly identityRegistry: typeof CREATOR_ERC8004_REGISTRY;
  readonly ownerAddress: string;
  readonly agentWallet: string;
  readonly endpoint: string;
  readonly name: string;
  readonly description: string;
  readonly configuration: CreatorRuntimeConfiguration;
  readonly configurationDigest: string;
  readonly registrationFile: CreatorRegistrationFile;
  readonly registrationUri: string;
  readonly uriDigest: string;
};

export type CreatorRegistrationStatus = {
  readonly deploymentId: string;
  readonly state: CreatorRegistrationState;
  readonly phase: CreatorRegistrationPhase | null;
  readonly canMint: boolean;
  readonly canSetUri: boolean;
  readonly mintOutcomeRecorded: boolean;
  readonly uriOutcomeRecorded: boolean;
  readonly pendingReason: string | null;
  readonly operationId: string;
  readonly mintCallsId: string | null;
  readonly mintTransactionHash: string | null;
  readonly mintScanStartBlock: string | null;
  readonly mintScanCursor: string | null;
  readonly uriCallsId: string | null;
  readonly uriTransactionHash: string | null;
  readonly agentId: string | null;
  readonly ownerAddress: string;
  readonly agentWallet: string;
  readonly endpoint: string;
  readonly name: string;
  readonly initialUriDigest: string;
  readonly finalUriDigest: string | null;
  readonly identity: {
    readonly namespace: "eip155";
    readonly chainId: 97;
    readonly identityRegistry: string;
    readonly agentId: string;
    readonly agentVersionId: string;
    readonly endpoint: string;
    readonly ownerAddress: string;
    readonly agentWallet: string;
  } | null;
  readonly tradingPair: CreatorRuntimeConfiguration["tradingPair"];
  readonly configurationDigest: string;
};

export type CreatorRegistrationPrepareResponse = CreatorRegistrationStatus & {
  readonly phase: CreatorRegistrationPhase;
  readonly registrationFile: CreatorRegistrationFile;
  readonly registrationUri: string;
  readonly uriDigest: string;
  readonly agentId: string | null;
};

export type CreatorRegistrationResultInput = {
  readonly phase: CreatorRegistrationPhase;
  readonly callsId: string | null;
  readonly transactionHash: string | null;
  readonly status: CreatorRegistrationResultStatus;
  readonly agentId: string | null;
  readonly uriDigest: string | null;
};

export type CreatorRegistrationChainAgent = {
  readonly owner: string;
  readonly agentUri: string;
};

export type CreatorRegistrationChainReceipt = {
  readonly status: "success" | "reverted";
  readonly blockNumber: bigint;
};

export type CreatorRegistrationChainLog = {
  readonly agentId: string;
  readonly agentUri: string;
  readonly owner: string;
  readonly transactionHash: string | null;
  readonly blockNumber: bigint;
};

/** Narrow read-only seam; production uses the pinned BNB testnet RPC. */
export type CreatorRegistrationChainReader = {
  readonly finalizedBlock: () => Promise<bigint>;
  readonly receipt: (transactionHash: string) => Promise<CreatorRegistrationChainReceipt | null>;
  readonly findRegistered: (input: { readonly owner: string; readonly agentUri: string; readonly fromBlock: bigint; readonly toBlock: bigint }) => Promise<readonly CreatorRegistrationChainLog[]>;
  readonly readAgent: (input: { readonly agentId: string; readonly blockNumber: bigint }) => Promise<CreatorRegistrationChainAgent | null>;
};

type Queryable = Pick<Pool, "query">;
type CreatorRegistrationPool = Pick<Pool, "query" | "connect">;

type DeploymentRow = {
  readonly deployment_id: string;
  readonly draft_id: string;
  readonly creator_user_id: string;
  readonly state: string;
  readonly current_step: string | null;
  readonly attempt: number;
  readonly public_url: string | null;
  readonly name: string;
  readonly description: string;
  readonly configuration: unknown;
  readonly configuration_digest: string;
  readonly admin_wallet: string | null;
  readonly execution_wallet: string | null;
};

type EventRow = {
  readonly status_message: string;
  readonly external_resource_references: unknown;
  readonly transaction_hash: string | null;
  readonly retryable: boolean;
  readonly created_at: Date | string;
};

type EventReference = Record<string, unknown>;

type FinalizedIdentityRow = {
  readonly identity_registry: string;
  readonly agent_id: string;
  readonly owner_address: string | null;
  readonly agent_wallet: string | null;
  readonly agent_uri: string | null;
  readonly content_digest: string | null;
  readonly agent_version_id: string;
  readonly version_public_metadata: unknown;
  readonly service_url: string;
};

function asObject(value: unknown): EventReference | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as EventReference : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function lowerAddress(value: string): string {
  return value.toLowerCase();
}

function assertTransactionHash(value: string | null): string | null {
  if (value === null) return null;
  if (!/^0x[0-9a-f]{64}$/iu.test(value)) throw new CreatorRegistrationError("CREATOR_REGISTRATION_RESULT_INVALID", "The browser returned an invalid transaction hash.");
  return value;
}

function assertCallsId(value: string | null): string | null {
  if (value === null) return null;
  // Altana calls IDs are opaque to the server. Keep a bounded public token;
  // accepting only hex here also prevents a browser from storing arbitrary
  // script-like data in deployment_events.
  if (!/^0x[0-9a-f]{1,128}$/iu.test(value)) throw new CreatorRegistrationError("CREATOR_REGISTRATION_RESULT_INVALID", "The browser returned an invalid operation ID.");
  return value;
}

function assertAgentId(value: string | null): string | null {
  if (value === null) return null;
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) throw new CreatorRegistrationError("CREATOR_REGISTRATION_RESULT_INVALID", "The browser returned an invalid ERC-8004 agent ID.");
  try {
    const parsed = BigInt(value);
    if (parsed > maxRegistrationAgentId) throw new Error("unsafe");
  } catch {
    throw new CreatorRegistrationError("CREATOR_REGISTRATION_RESULT_INVALID", "The ERC-8004 agent ID is outside the browser SDK's safe range.");
  }
  return value;
}

function assertUriDigest(value: string | null): string | null {
  if (value === null) return null;
  if (!/^[0-9a-f]{64}$/iu.test(value)) throw new CreatorRegistrationError("CREATOR_REGISTRATION_RESULT_INVALID", "The browser returned an invalid URI digest.");
  return value.toLowerCase();
}

function blockNumberString(value: unknown): string | null {
  const candidate = typeof value === "bigint" ? value.toString(10) : typeof value === "string" ? value : null;
  if (candidate === null || !/^(0|[1-9][0-9]*)$/u.test(candidate)) return null;
  return candidate;
}

function blockNumber(value: string | null): bigint | null {
  if (value === null) return null;
  try { return BigInt(value); } catch { return null; }
}

/** Digest the exact registration-file bytes, matching G1 content_digest. */
export function creatorRegistrationUriDigest(uri: string): string {
  const match = /^data:application\/json;base64,([A-Za-z0-9+/=_-]+)$/u.exec(uri);
  if (match === null) return createHash("sha256").update(uri, "utf8").digest("hex");
  return createHash("sha256").update(Buffer.from(match[1]!.replaceAll("-", "+").replaceAll("_", "/"), "base64")).digest("hex");
}

function operationIdFor(deploymentId: string): string {
  return `creator:erc8004:${createHash("sha256").update(deploymentId, "utf8").digest("hex").slice(0, 32)}`;
}

function statusFromEvents(deploymentId: string, events: readonly EventRow[], intent: CreatorRegistrationIntent): CreatorRegistrationStatus {
  let mintIntent: EventReference | null = null;
  let mintResult: EventReference | null = null;
  let reconciledMintResult: EventReference | null = null;
  let uriIntent: EventReference | null = null;
  let uriResult: EventReference | null = null;
  let reconciledUriResult: EventReference | null = null;
  let mintScanStartBlock: string | null = null;
  let mintScanCursor: string | null = null;
  let identity: CreatorRegistrationStatus["identity"] = null;
  let pendingReason: string | null = null;
  for (const event of events) {
    const refs = asObject(event.external_resource_references);
    if (event.status_message === CREATOR_ERC8004_BROWSER_MINT_INTENT) mintIntent = refs;
    if (event.status_message === CREATOR_ERC8004_BROWSER_MINT_RESULT) mintResult = refs;
    if (event.status_message === CREATOR_ERC8004_BROWSER_URI_INTENT) uriIntent = refs;
    if (event.status_message === CREATOR_ERC8004_BROWSER_URI_RESULT) uriResult = refs;
    if (event.status_message === CREATOR_ERC8004_BROWSER_RECONCILE) {
      pendingReason = asString(refs?.reason);
      if (refs?.phase === "mint") {
        if (eventStatus(refs.status) !== null) reconciledMintResult = refs;
        const progressStart = blockNumberString(refs.scanStartBlock);
        const progressCursor = blockNumberString(refs.scanCursor);
        if (progressStart !== null) mintScanStartBlock = progressStart;
        if (progressCursor !== null) mintScanCursor = progressCursor;
      }
      if (refs?.phase === "uri" && eventStatus(refs.status) !== null) reconciledUriResult = refs;
    }
    if (event.status_message === CREATOR_ERC8004_BROWSER_OPERATION) {
      const candidate = asObject(refs?.erc8004Identity);
      if (candidate !== null && candidate.namespace === "eip155" && candidate.chainId === 97 &&
        typeof candidate.identityRegistry === "string" && typeof candidate.agentId === "string" &&
        typeof candidate.agentVersionId === "string" && typeof candidate.endpoint === "string" &&
        typeof candidate.ownerAddress === "string" && typeof candidate.agentWallet === "string") {
        identity = candidate as CreatorRegistrationStatus["identity"];
      }
    }
  }
  mintScanStartBlock ??= blockNumberString(mintIntent?.scanStartBlock);
  mintScanCursor ??= blockNumberString(mintIntent?.scanCursor);
  const effectiveMintResult = reconciledMintResult ?? mintResult;
  const effectiveUriResult = reconciledUriResult ?? uriResult;
  const mintStatus = asString(effectiveMintResult?.status);
  const uriStatus = asString(effectiveUriResult?.status);
  const agentId = assertAgentId(asString(effectiveUriResult?.agentId) ?? asString(effectiveMintResult?.agentId));
  const initialDigest = asString(mintIntent?.uriDigest) ?? intent.uriDigest;
  const finalDigest = asString(uriIntent?.uriDigest) ?? asString(effectiveUriResult?.uriDigest);
  const callsId = asString(effectiveMintResult?.callsId) ?? asString(mintIntent?.callsId);
  const mintTransactionHash = asString(effectiveMintResult?.transactionHash) ?? asString(mintResult?.transactionHash);
  const uriCallsId = asString(effectiveUriResult?.callsId) ?? asString(uriIntent?.callsId);
  const uriTransactionHash = asString(effectiveUriResult?.transactionHash) ?? asString(uriResult?.transactionHash);
  const hasIntent = mintIntent !== null || mintResult !== null || uriIntent !== null || uriResult !== null;
  let state: CreatorRegistrationState = hasIntent ? "mint_intent" : "not_started";
  let phase: CreatorRegistrationPhase | null = hasIntent ? "mint" : null;
  if (mintStatus === "FAILED") state = "failed";
  else if (hasIntent && (mintStatus === "PENDING" || mintStatus === "UNKNOWN" || effectiveMintResult === null)) state = "mint_pending";
  else if (mintStatus === "CONFIRMED" && uriIntent === null) state = "mint_confirmed";
  else if (mintStatus === "CONFIRMED" && (uriStatus === null || uriStatus === "PENDING" || uriStatus === "UNKNOWN")) {
    state = "uri_pending";
    phase = "uri";
  } else if (mintStatus === "CONFIRMED" && uriStatus === "FAILED") {
    state = "failed";
    phase = "uri";
  } else if (mintStatus === "CONFIRMED" && uriStatus === "CONFIRMED" && identity !== null) {
    state = "registered";
    phase = "uri";
  } else if (mintStatus === "CONFIRMED") {
    state = "uri_pending";
    phase = "uri";
  }
  if (pendingReason === null && state.endsWith("pending")) pendingReason = "FINALIZED_REGISTRY_OR_G1_READ_PENDING";
  if (!state.endsWith("pending") && state !== "failed") pendingReason = null;
  return {
    deploymentId,
    state,
    phase,
    canMint: mintIntent === null && mintResult === null && reconciledMintResult === null,
    canSetUri: mintStatus === "CONFIRMED" && uriIntent === null && uriResult === null && reconciledUriResult === null,
    mintOutcomeRecorded: effectiveMintResult !== null,
    uriOutcomeRecorded: effectiveUriResult !== null,
    pendingReason,
    operationId: intent.operationId,
    mintCallsId: callsId,
    mintTransactionHash,
    mintScanStartBlock,
    mintScanCursor,
    uriCallsId,
    uriTransactionHash,
    agentId,
    ownerAddress: intent.ownerAddress,
    agentWallet: intent.agentWallet,
    endpoint: intent.endpoint,
    name: intent.name,
    initialUriDigest: initialDigest,
    finalUriDigest: finalDigest,
    identity,
    tradingPair: intent.configuration.tradingPair,
    configurationDigest: intent.configurationDigest,
  };
}

/**
 * Build the public registration file from server-owned draft values. The
 * browser receives this file, but cannot choose the endpoint, owner, pair or
 * configuration digest used to build it.
 */
export function creatorRegistrationFile(input: {
  readonly name: string;
  readonly description: string;
  readonly endpoint: string;
  readonly configuration: CreatorRuntimeConfiguration;
  readonly configurationDigest: string;
}): CreatorRegistrationFile {
  const pair = input.configuration.tradingPair;
  return {
    type: registrationFileType,
    name: input.name,
    description: `${input.description} BNBEra bounded runtime: ${pair}; configuration digest: ${input.configurationDigest}.`,
    services: [{
      name: "A2A",
      endpoint: input.endpoint,
      protocolVersion: "0.3.0",
    }],
    registrations: [],
    "x-bnbera": {
      template: `${creatorTemplate.slug}@${creatorTemplate.semanticVersion}`,
      templateDigest: creatorTemplate.artifactDigest,
      configurationDigest: input.configurationDigest,
      tradingPair: pair,
    },
  };
}

export function finalizedCreatorRegistrationFile(file: CreatorRegistrationFile, agentId: string): CreatorRegistrationFile {
  const numericId = assertAgentId(agentId);
  if (numericId === null) throw new CreatorRegistrationError("CREATOR_REGISTRATION_RESULT_INVALID", "An ERC-8004 agent ID is required to complete the URI.");
  return withErc8004Registration(file, BigInt(numericId), CREATOR_ERC8004_CHAIN_ID) as CreatorRegistrationFile;
}

export function encodedCreatorRegistrationUri(file: Erc8004RegistrationFile): string {
  const uri = encodeErc8004AgentUri(file);
  if (!uri.startsWith("data:application/json;base64,")) throw new CreatorRegistrationError("CREATOR_REGISTRATION_URI_INVALID", "The ERC-8004 registration URI was not encoded as a data URI.");
  if (uri.length > 2_000) throw new CreatorRegistrationError("CREATOR_REGISTRATION_URI_INVALID", "The ERC-8004 registration URI exceeds the reviewed public URI limit.");
  return uri;
}

async function managedAgentCardEndpoint(value: string): Promise<string> {
  let target: URL;
  try {
    target = await assertSafePublicNetworkTarget(value);
  } catch {
    throw new CreatorRegistrationError("CREATOR_REGISTRATION_ENDPOINT_UNSAFE", "Creator registration requires a managed public HTTPS A2A card.");
  }
  if (target.protocol !== "https:") throw new CreatorRegistrationError("CREATOR_REGISTRATION_ENDPOINT_UNSAFE", "Creator registration requires a managed public HTTPS A2A card.");
  if (!isNativeStudioAgentCardUrl(target)) {
    target.pathname = `${target.pathname.replace(/\/+$/u, "")}/.well-known/agent-card.json`;
    target.search = "";
    target.hash = "";
  }
  return target.toString();
}

function assertConfiguration(configuration: unknown, expectedDigest: string): CreatorRuntimeConfiguration {
  let parsed: CreatorRuntimeConfiguration;
  try {
    parsed = canonicalRuntimeConfiguration(configuration as Record<string, unknown>);
  } catch {
    throw new CreatorRegistrationError("CREATOR_REGISTRATION_CONFIG_INVALID", "The persisted Creator configuration is not an audited bounded configuration.");
  }
  if (canonicalRuntimeConfigurationDigest(parsed) !== expectedDigest) throw new CreatorRegistrationError("CREATOR_REGISTRATION_CONFIG_DIGEST_MISMATCH", "The persisted Creator configuration digest does not match its selected trading pair and limits.");
  return parsed;
}

function deploymentEventRefs(intent: CreatorRegistrationIntent): EventReference {
  return {
    operationId: intent.operationId,
    phase: "intent",
    chainId: intent.chainId,
    identityRegistry: intent.identityRegistry,
    ownerAddress: intent.ownerAddress,
    agentWallet: intent.agentWallet,
    endpoint: intent.endpoint,
    name: intent.name,
    configuration: intent.configuration,
    configurationDigest: intent.configurationDigest,
    registrationFile: intent.registrationFile,
    uriDigest: intent.uriDigest,
    tradingPair: intent.configuration.tradingPair,
  };
}

function eventRefs(value: unknown): EventReference {
  return asObject(value) ?? {};
}

function eventStatus(value: unknown): CreatorRegistrationResultStatus | null {
  return value === "CONFIRMED" || value === "PENDING" || value === "FAILED" || value === "UNKNOWN" ? value : null;
}

function asIntent(events: readonly EventRow[], deploymentId: string): CreatorRegistrationIntent | null {
  const event = [...events].reverse().find((item) => item.status_message === CREATOR_ERC8004_BROWSER_INTENT);
  if (event === undefined) return null;
  const refs = eventRefs(event.external_resource_references);
  const configuration = refs.configuration;
  const configurationDigest = asString(refs.configurationDigest);
  const file = refs.registrationFile;
  if (configurationDigest === null || typeof file !== "object" || file === null || Array.isArray(file)) return null;
  const parsedConfiguration = assertConfiguration(configuration, configurationDigest);
  const extension = asObject((file as Record<string, unknown>)["x-bnbera"]);
  if (extension?.tradingPair !== parsedConfiguration.tradingPair || extension.configurationDigest !== configurationDigest) return null;
  const operationId = asString(refs.operationId) ?? operationIdFor(deploymentId);
  const endpoint = asString(refs.endpoint);
  const ownerAddress = asString(refs.ownerAddress);
  const agentWallet = asString(refs.agentWallet);
  const name = asString(refs.name);
  const registrationUri = asString(refs.registrationUri);
  const uriDigest = asString(refs.uriDigest);
  if (endpoint === null || ownerAddress === null || agentWallet === null || name === null || registrationUri === null || uriDigest === null) return null;
  try {
    if (encodedCreatorRegistrationUri(file as CreatorRegistrationFile) !== registrationUri || creatorRegistrationUriDigest(registrationUri) !== uriDigest.toLowerCase()) return null;
  } catch {
    return null;
  }
  return {
    deploymentId,
    operationId,
    chainId: CREATOR_ERC8004_CHAIN_ID,
    identityRegistry: CREATOR_ERC8004_REGISTRY,
    ownerAddress,
    agentWallet,
    endpoint,
    name,
    description: asString(refs.description) ?? "",
    configuration: parsedConfiguration,
    configurationDigest,
    registrationFile: file as CreatorRegistrationFile,
    registrationUri,
    uriDigest,
  };
}

function resultRefs(input: CreatorRegistrationResultInput, expectedUriDigest: string | null): EventReference {
  return {
    phase: input.phase,
    callsId: input.callsId,
    transactionHash: input.transactionHash,
    status: input.status,
    agentId: input.agentId,
    uriDigest: input.uriDigest ?? expectedUriDigest,
  };
}

function nextStateFromDeployment(state: string): string {
  // Keep the worker's state axes separate: registration events describe the
  // browser operation while the deployment remains in its existing stage.
  return state;
}

function configurationMetadataMatches(metadata: unknown, intent: CreatorRegistrationIntent): boolean {
  const record = asObject(metadata);
  if (record === null) return false;
  const extension = asObject(record["x-bnbera"]);
  const digest = asString(extension?.configurationDigest) ?? asString(record.configurationDigest);
  const tradingPair = asString(extension?.tradingPair) ?? asString(record.tradingPair);
  return digest?.toLowerCase() === intent.configurationDigest.toLowerCase() && tradingPair === intent.configuration.tradingPair;
}

function identityFromRow(row: FinalizedIdentityRow, intent: CreatorRegistrationIntent, expectedUri: string, expectedDigest: string): CreatorRegistrationStatus["identity"] {
  if (row.identity_registry.toLowerCase() !== intent.identityRegistry.toLowerCase() || row.owner_address === null || row.agent_wallet === null || row.agent_uri === null) return null;
  if (lowerAddress(row.owner_address) !== lowerAddress(intent.ownerAddress) || lowerAddress(row.agent_wallet) !== lowerAddress(intent.agentWallet) || row.service_url !== intent.endpoint) return null;
  // The G1 row must be the exact finalized URI/digest produced for this
  // operation. An endpoint and a valid digest alone can belong to an older
  // version of the same agent, so require the selected version's public
  // configuration binding as well.
  if (row.agent_uri !== expectedUri) return null;
  const expectedUriDigest = creatorRegistrationUriDigest(row.agent_uri).toLowerCase();
  const expectedContentDigest = expectedDigest.toLowerCase();
  if (expectedUriDigest !== expectedContentDigest || (row.content_digest !== null && row.content_digest.toLowerCase() !== expectedContentDigest)) return null;
  if (!configurationMetadataMatches(row.version_public_metadata, intent)) return null;
  return {
    namespace: "eip155",
    chainId: CREATOR_ERC8004_CHAIN_ID,
    identityRegistry: row.identity_registry,
    agentId: row.agent_id,
    agentVersionId: row.agent_version_id,
    endpoint: row.service_url,
    ownerAddress: row.owner_address,
    agentWallet: row.agent_wallet,
  };
}

export class CreatorRegistrationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/**
 * Production registry reader. It intentionally has no write capability and
 * asks the pinned public RPC for finalized reads only.
 */
export function createCreatorRegistrationChainReader(): CreatorRegistrationChainReader {
  // Keep the viem client import out of module initialization so route tests
  // can inject a reader without opening a network connection.
  let reader: CreatorRegistrationChainReader | undefined;
  return {
    async finalizedBlock() {
      if (reader === undefined) reader = await defaultCreatorRegistrationChainReader();
      return reader.finalizedBlock();
    },
    async receipt(transactionHash) {
      if (reader === undefined) reader = await defaultCreatorRegistrationChainReader();
      return reader.receipt(transactionHash);
    },
    async findRegistered(input) {
      if (reader === undefined) reader = await defaultCreatorRegistrationChainReader();
      return reader.findRegistered(input);
    },
    async readAgent(input) {
      if (reader === undefined) reader = await defaultCreatorRegistrationChainReader();
      return reader.readAgent(input);
    },
  };
}

async function defaultCreatorRegistrationChainReader(): Promise<CreatorRegistrationChainReader> {
  const { createPublicClient, decodeEventLog, http } = await import("viem");
  const client = createPublicClient({ chain: BNB_TESTNET.chain as unknown as Chain, transport: http(BNB_TESTNET.publicRpcUrl) });
  const registeredEvent = {
    type: "event",
    name: "Registered",
    inputs: [
      { indexed: true, name: "agentId", type: "uint256" },
      { indexed: false, name: "agentURI", type: "string" },
      { indexed: true, name: "owner", type: "address" },
    ],
  } as const;
  const registryReadAbi = [
    { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
    { type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "string" }] },
  ] as const;
  return {
    async finalizedBlock() {
      const block = await client.getBlock({ blockTag: "finalized" });
      if (block.number === undefined) throw new CreatorRegistrationError("CREATOR_REGISTRATION_FINALITY_UNAVAILABLE", "The registry did not return a finalized block.");
      return block.number;
    },
    async receipt(transactionHash) {
      try {
        const receipt = await client.getTransactionReceipt({ hash: transactionHash as `0x${string}` });
        return { status: receipt.status === "success" ? "success" : "reverted", blockNumber: receipt.blockNumber };
      } catch {
        return null;
      }
    },
    async findRegistered(input) {
      if (input.fromBlock > input.toBlock) return [];
      const logs = await client.getLogs({
        address: CREATOR_ERC8004_REGISTRY,
        event: registeredEvent,
        args: { owner: input.owner as `0x${string}` },
        fromBlock: input.fromBlock,
        toBlock: input.toBlock,
      });
      const found: CreatorRegistrationChainLog[] = [];
      for (const log of logs) {
        try {
          const decoded = decodeEventLog({ abi: [registeredEvent], data: log.data, topics: log.topics });
          if (decoded.eventName !== "Registered") continue;
          const args = decoded.args as { readonly agentId: bigint; readonly agentURI: string; readonly owner: string };
          if (args.owner.toLowerCase() !== input.owner.toLowerCase() || args.agentURI !== input.agentUri) continue;
          found.push({ agentId: args.agentId.toString(10), agentUri: args.agentURI, owner: args.owner, transactionHash: log.transactionHash ?? null, blockNumber: log.blockNumber ?? 0n });
        } catch {
          // A malformed unrelated log is not evidence of this identity.
        }
      }
      return found;
    },
    async readAgent(input) {
      try {
        const owner = await client.readContract({ address: CREATOR_ERC8004_REGISTRY, abi: registryReadAbi, functionName: "ownerOf", args: [BigInt(input.agentId)], blockNumber: input.blockNumber });
        const agentUri = await client.readContract({ address: CREATOR_ERC8004_REGISTRY, abi: registryReadAbi, functionName: "tokenURI", args: [BigInt(input.agentId)], blockNumber: input.blockNumber });
        return { owner, agentUri };
      } catch {
        return null;
      }
    },
  };
}

/** Construct a service backed by PostgreSQL deployment_events. */
export function createCreatorRegistrationService(options: {
  readonly pool: CreatorRegistrationPool;
  readonly chainReader?: CreatorRegistrationChainReader;
}): CreatorRegistrationService {
  return new CreatorRegistrationService(options.pool, options.chainReader ?? createCreatorRegistrationChainReader());
}

export class CreatorRegistrationService {
  constructor(private readonly pool: CreatorRegistrationPool, private readonly chain: CreatorRegistrationChainReader) {}

  private async deployment(userId: string, deploymentId: string, client: Queryable = this.pool, requesterAddress?: string): Promise<DeploymentRow> {
    const result = await client.query<DeploymentRow>(
      `SELECT d.id AS deployment_id, d.draft_id, r.creator_user_id, d.state, d.current_step, d.attempt,
              d.public_url, r.name, r.description, r.configuration, d.configuration_digest,
              au.admin_wallet, au.execution_wallet
         FROM agent_deployments d
         JOIN agent_drafts r ON r.id=d.draft_id AND r.creator_user_id=$2
         LEFT JOIN LATERAL (
           SELECT admin_wallet, execution_wallet FROM agent_authorities
            WHERE draft_id=d.draft_id AND status='active' AND expires_at > NOW()
            ORDER BY "updatedAt" DESC LIMIT 1
         ) au ON true
        WHERE d.id=$1 AND d.provider='bnb-agent-studio'
        LIMIT 1`, [deploymentId, userId]);
    const row = result.rows[0];
    if (row === undefined) throw new CreatorRegistrationError("DEPLOYMENT_NOT_FOUND", "Creator deployment not found.");
    if (row.public_url === null) throw new CreatorRegistrationError("CREATOR_REGISTRATION_ENDPOINT_UNAVAILABLE", "The managed Studio HTTPS A2A card is not available yet.");
    if (row.admin_wallet === null || row.execution_wallet === null) throw new CreatorRegistrationError("CREATOR_REGISTRATION_OWNER_UNAVAILABLE", "The active Creator authority wallet is not available.");
    if (requesterAddress !== undefined && lowerAddress(row.admin_wallet) !== lowerAddress(requesterAddress)) throw new CreatorRegistrationError("CREATOR_REGISTRATION_OWNER_MISMATCH", "The authenticated Creator wallet does not control this deployment's server-resolved owner.");
    return row;
  }

  private async buildIntent(userId: string, deploymentId: string, client: Queryable = this.pool, requesterAddress?: string): Promise<CreatorRegistrationIntent> {
    const row = await this.deployment(userId, deploymentId, client, requesterAddress);
    if (row.creator_user_id !== userId) throw new CreatorRegistrationError("DEPLOYMENT_NOT_FOUND", "Creator deployment not found.");
    const endpoint = await managedAgentCardEndpoint(row.public_url!);
    const configuration = assertConfiguration(row.configuration, row.configuration_digest);
    const file = creatorRegistrationFile({ name: row.name, description: row.description, endpoint, configuration, configurationDigest: row.configuration_digest });
    const registrationUri = encodedCreatorRegistrationUri(file);
    return {
      deploymentId,
      operationId: operationIdFor(deploymentId),
      chainId: CREATOR_ERC8004_CHAIN_ID,
      identityRegistry: CREATOR_ERC8004_REGISTRY,
      ownerAddress: row.admin_wallet!,
      agentWallet: row.execution_wallet!,
      endpoint,
      name: row.name,
      description: row.description,
      configuration,
      configurationDigest: row.configuration_digest,
      registrationFile: file,
      registrationUri,
      uriDigest: creatorRegistrationUriDigest(registrationUri),
    };
  }

  private async events(deploymentId: string, client: Queryable = this.pool): Promise<readonly EventRow[]> {
    const result = await client.query<EventRow>(
      `SELECT status_message, external_resource_references, transaction_hash, retryable, "createdAt" AS created_at
         FROM deployment_events WHERE deployment_id=$1
        ORDER BY "createdAt" ASC, id ASC`, [deploymentId]);
    return result.rows;
  }

  private async recordEvent(client: Queryable, row: DeploymentRow, statusMessage: string, refs: EventReference, transactionHash: string | null, retryable: boolean): Promise<void> {
    await client.query(
      `INSERT INTO deployment_events
        (deployment_id, attempt, previous_state, next_state, status_message,
         external_resource_references, transaction_hash, retryable)
       VALUES ($1,$2,$3::deployment_state,$4::deployment_state,$5,$6::jsonb,$7,$8)`,
      [row.deployment_id, row.attempt, row.state, nextStateFromDeployment(row.state), statusMessage, JSON.stringify(refs), transactionHash, retryable],
    );
  }

  private async ensureIntent(userId: string, deploymentId: string, phase: CreatorRegistrationPhase | null, requesterAddress?: string, reservePhase = true): Promise<{ readonly intent: CreatorRegistrationIntent; readonly events: readonly EventRow[]; readonly reservedPhase: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`creator-erc8004-registration:${deploymentId}`]);
      const row = await this.deployment(userId, deploymentId, client, requesterAddress);
      let events = await this.events(deploymentId, client);
      let intent = asIntent(events, deploymentId);
      if (intent === null) {
        intent = await this.buildIntent(userId, deploymentId, client, requesterAddress);
        await this.recordEvent(client, row, CREATOR_ERC8004_BROWSER_INTENT, { ...deploymentEventRefs(intent), description: intent.description, registrationUri: intent.registrationUri }, null, true);
        events = await this.events(deploymentId, client);
      }
      const status = statusFromEvents(deploymentId, events, intent);
      let reservedPhase = false;
      // The generic intent binds the server-owned profile. Each browser write
      // also gets its own append-only reservation in the same transaction and
      // advisory lock. The first prepare therefore receives a signing grant;
      // every reload/tab after it sees the durable reservation and must
      // reconcile instead of signing again.
      if (phase === "mint" && reservePhase && status.canMint) {
        const scanStartBlock = await this.chain.finalizedBlock();
        if (scanStartBlock < 0n) throw new CreatorRegistrationError("CREATOR_REGISTRATION_FINALITY_UNAVAILABLE", "The registry did not return a valid finalized block for mint reconciliation.");
        await this.recordEvent(client, row, CREATOR_ERC8004_BROWSER_MINT_INTENT, {
          ...deploymentEventRefs(intent),
          phase: "mint-intent",
          registrationUri: intent.registrationUri,
          uriDigest: intent.uriDigest,
          scanStartBlock: scanStartBlock.toString(10),
          scanCursor: scanStartBlock.toString(10),
        }, null, true);
        events = await this.events(deploymentId, client);
        reservedPhase = true;
      }
      if (phase === "uri" && reservePhase && status.canSetUri && status.agentId !== null) {
        const finalFile = finalizedCreatorRegistrationFile(intent.registrationFile, status.agentId);
        const finalUri = encodedCreatorRegistrationUri(finalFile);
        const finalDigest = creatorRegistrationUriDigest(finalUri);
        await this.recordEvent(client, row, CREATOR_ERC8004_BROWSER_URI_INTENT, {
          operationId: intent.operationId,
          phase: "uri-intent",
          agentId: status.agentId,
          registrationFile: finalFile,
          registrationUri: finalUri,
          uriDigest: finalDigest,
          configurationDigest: intent.configurationDigest,
          tradingPair: intent.configuration.tradingPair,
        }, null, true);
        events = await this.events(deploymentId, client);
        reservedPhase = true;
      }
      await client.query("COMMIT");
      return { intent, events, reservedPhase };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async prepare(userId: string, deploymentId: string, phase: CreatorRegistrationPhase = "mint", requesterAddress?: string): Promise<CreatorRegistrationPrepareResponse> {
    const prepared = await this.ensureIntent(userId, deploymentId, phase, requesterAddress);
    const status = statusFromEvents(deploymentId, prepared.events, prepared.intent);
    if (phase === "mint") {
      return { ...status, canMint: prepared.reservedPhase, phase, registrationFile: prepared.intent.registrationFile, registrationUri: prepared.intent.registrationUri, uriDigest: prepared.intent.uriDigest, agentId: null };
    }
    if (status.agentId === null) throw new CreatorRegistrationError("CREATOR_REGISTRATION_MINT_PENDING", "The mint must be finalized before the URI update can be signed.");
    const file = finalizedCreatorRegistrationFile(prepared.intent.registrationFile, status.agentId);
    const registrationUri = encodedCreatorRegistrationUri(file);
    return { ...status, canSetUri: prepared.reservedPhase, phase, registrationFile: file, registrationUri, uriDigest: creatorRegistrationUriDigest(registrationUri), agentId: status.agentId };
  }

  async recordResult(userId: string, deploymentId: string, input: CreatorRegistrationResultInput, requesterAddress?: string): Promise<CreatorRegistrationStatus> {
    const prepared = await this.ensureIntent(userId, deploymentId, input.phase, requesterAddress, false);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`creator-erc8004-registration:${deploymentId}`]);
      const row = await this.deployment(userId, deploymentId, client, requesterAddress);
      const events = await this.events(deploymentId, client);
      const intent = asIntent(events, deploymentId) ?? prepared.intent;
      const current = statusFromEvents(deploymentId, events, intent);
      const phaseIntentStatus = input.phase === "mint" ? CREATOR_ERC8004_BROWSER_MINT_INTENT : CREATOR_ERC8004_BROWSER_URI_INTENT;
      if (!events.some((event) => event.status_message === phaseIntentStatus)) {
        throw new CreatorRegistrationError("CREATOR_REGISTRATION_INTENT_REQUIRED", "A browser signing reservation is required before recording its public result.");
      }
      const callsId = assertCallsId(input.callsId);
      const transactionHash = assertTransactionHash(input.transactionHash);
      const agentId = assertAgentId(input.agentId);
      const uriDigest = assertUriDigest(input.uriDigest);
      const expectedDigest = input.phase === "mint" ? intent.uriDigest : current.agentId === null ? null : creatorRegistrationUriDigest(encodedCreatorRegistrationUri(finalizedCreatorRegistrationFile(intent.registrationFile, current.agentId)));
      if (uriDigest !== null && expectedDigest !== null && uriDigest.toLowerCase() !== expectedDigest.toLowerCase()) throw new CreatorRegistrationError("CREATOR_REGISTRATION_URI_MISMATCH", "The browser URI digest does not match the server-resolved registration file.");
      const hasMintOutcome = events.some((event) => event.status_message === CREATOR_ERC8004_BROWSER_MINT_RESULT || (event.status_message === CREATOR_ERC8004_BROWSER_RECONCILE && eventRefs(event.external_resource_references).phase === "mint"));
      const hasUriOutcome = events.some((event) => event.status_message === CREATOR_ERC8004_BROWSER_URI_RESULT || (event.status_message === CREATOR_ERC8004_BROWSER_RECONCILE && eventRefs(event.external_resource_references).phase === "uri"));
      if (input.phase === "mint" && hasMintOutcome) {
        // A retry after a confirmed/unknown call is never a second mint. The
        // original public result remains authoritative for reconciliation.
        await client.query("COMMIT");
        return current;
      }
      if (input.phase === "uri" && hasUriOutcome) {
        await client.query("COMMIT");
        return current;
      }
      if (input.phase === "uri" && current.agentId !== null && agentId !== null && input.agentId !== current.agentId) throw new CreatorRegistrationError("CREATOR_REGISTRATION_AGENT_MISMATCH", "The browser URI update agent ID does not match the persisted mint.");
      if (input.status === "CONFIRMED" && input.phase === "mint" && (agentId === null || callsId === null)) throw new CreatorRegistrationError("CREATOR_REGISTRATION_RESULT_INVALID", "A confirmed mint must include its calls ID and agent ID.");
      if (input.status === "CONFIRMED" && input.phase === "uri" && (current.agentId === null || callsId === null || uriDigest === null)) throw new CreatorRegistrationError("CREATOR_REGISTRATION_RESULT_INVALID", "A confirmed URI update must include its calls ID, agent ID and URI digest.");
      if (input.phase === "uri" && current.agentId === null) throw new CreatorRegistrationError("CREATOR_REGISTRATION_MINT_PENDING", "The mint must be finalized before recording a URI update.");
      const refs = resultRefs({ ...input, callsId, transactionHash, agentId: input.phase === "uri" ? current.agentId : agentId, uriDigest }, expectedDigest);
      await this.recordEvent(client, row, input.phase === "mint" ? CREATOR_ERC8004_BROWSER_MINT_RESULT : CREATOR_ERC8004_BROWSER_URI_RESULT, refs, transactionHash, input.status !== "CONFIRMED");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const refreshed = await this.events(deploymentId);
    const intent = asIntent(refreshed, deploymentId) ?? prepared.intent;
    return statusFromEvents(deploymentId, refreshed, intent);
  }

  private async finalizedIdentity(userId: string, deploymentId: string, intent: CreatorRegistrationIntent, agentId: string, expectedUri: string, expectedDigest: string, client: Queryable = this.pool): Promise<CreatorRegistrationStatus["identity"]> {
    const result = await client.query<FinalizedIdentityRow>(
      `SELECT i.identity_registry, i.agent_id, i.owner_address, i.agent_wallet, i.agent_uri, i.content_digest,
              av.id AS agent_version_id, av.public_metadata AS version_public_metadata, s.url AS service_url
         FROM agent_deployments d
         JOIN agent_drafts r ON r.id=d.draft_id AND r.creator_user_id=$2
         JOIN agent_authorities au ON au.draft_id=d.draft_id AND au.status='active' AND au.expires_at > NOW()
         JOIN erc8004_identities i ON i.namespace='eip155' AND i.chain_id=$3
         AND lower(i.identity_registry)=lower($4) AND i.agent_id=$5 AND i.read_consistency='finalized'
         AND i.agent_uri=$6
         JOIN agents a ON a.identity_id=i.id AND lower(i.agent_wallet)=lower(au.execution_wallet)
         JOIN agent_versions av ON av.id=a.current_version_id
          AND (av.public_metadata->>'configurationDigest'=$7
            OR av.public_metadata->'x-bnbera'->>'configurationDigest'=$7)
          AND (av.public_metadata->>'tradingPair'=$8
            OR av.public_metadata->'x-bnbera'->>'tradingPair'=$8)
         JOIN agent_services s ON s.agent_version_id=av.id AND s.url=$9
        WHERE d.id=$1
        LIMIT 1`, [deploymentId, userId, CREATOR_ERC8004_CHAIN_ID, CREATOR_ERC8004_REGISTRY, agentId, expectedUri, intent.configurationDigest, intent.configuration.tradingPair, intent.endpoint]);
    const row = result.rows[0];
    return row === undefined ? null : identityFromRow(row, intent, expectedUri, expectedDigest);
  }

  async reconcile(userId: string, deploymentId: string, requesterAddress?: string): Promise<CreatorRegistrationStatus> {
    const prepared = await this.ensureIntent(userId, deploymentId, null, requesterAddress);
    const intent = prepared.intent;
    let events = await this.events(deploymentId);
    let status = statusFromEvents(deploymentId, events, intent);
    const finalizedBlock = await this.chain.finalizedBlock();
    let agentId = status.agentId;
    let mintTransactionHash = status.mintTransactionHash;
    if (agentId !== null && mintTransactionHash !== null) {
      const receipt = await this.chain.receipt(mintTransactionHash);
      if (receipt !== null && receipt.status === "reverted") {
        await this.appendReconcile(userId, deploymentId, "REGISTRY_MINT_REVERTED", mintTransactionHash, { phase: "mint", status: "FAILED", agentId, transactionHash: mintTransactionHash }, requesterAddress);
        return statusFromEvents(deploymentId, await this.events(deploymentId), intent);
      }
      if (receipt !== null && receipt.blockNumber > finalizedBlock) agentId = null;
    }
    if (agentId === null) {
      const scanStartBlock = blockNumber(status.mintScanStartBlock);
      const scanCursor = blockNumber(status.mintScanCursor) ?? scanStartBlock;
      if (scanStartBlock === null || scanCursor === null) {
        await this.appendReconcile(userId, deploymentId, "MINT_SCAN_ANCHOR_MISSING", null, { phase: "mint", status: "UNKNOWN", transactionHash: mintTransactionHash, uriDigest: intent.uriDigest }, requesterAddress);
        return statusFromEvents(deploymentId, await this.events(deploymentId), intent);
      }
      if (scanCursor <= finalizedBlock) {
        const scanToBlock = scanCursor + reconcileBlockWindow - 1n > finalizedBlock
          ? finalizedBlock
          : scanCursor + reconcileBlockWindow - 1n;
        const logs = await this.chain.findRegistered({ owner: intent.ownerAddress, agentUri: intent.registrationUri, fromBlock: scanCursor, toBlock: scanToBlock });
        if (logs.length > 1) {
          await this.appendReconcile(userId, deploymentId, "AMBIGUOUS_REGISTERED_EVENT", null, {
            phase: "mint",
            status: "UNKNOWN",
            matches: logs.length,
            scanStartBlock: scanStartBlock.toString(10),
            scanCursor: scanCursor.toString(10),
            transactionHash: mintTransactionHash,
            uriDigest: intent.uriDigest,
          }, requesterAddress);
          return statusFromEvents(deploymentId, await this.events(deploymentId), intent);
        }
        const match = logs[0];
        if (match !== undefined) {
          agentId = assertAgentId(match.agentId);
          mintTransactionHash = match.transactionHash ?? mintTransactionHash;
          if (agentId !== null) await this.appendReconcile(userId, deploymentId, "REGISTERED_EVENT_RECONCILED", mintTransactionHash, {
            phase: "mint",
            status: "CONFIRMED",
            agentId,
            transactionHash: mintTransactionHash,
            uriDigest: intent.uriDigest,
            scanStartBlock: scanStartBlock.toString(10),
            scanCursor: (match.blockNumber + 1n).toString(10),
          }, requesterAddress);
        }
        if (agentId === null) {
          // A delayed registration remains recoverable: advance only this
          // bounded chunk and persist the next cursor before returning.
          await this.appendReconcile(userId, deploymentId, "FINALIZED_MINT_NOT_FOUND", null, {
            phase: "mint",
            status: "PENDING",
            transactionHash: mintTransactionHash,
            uriDigest: intent.uriDigest,
            scanStartBlock: scanStartBlock.toString(10),
            scanCursor: (scanToBlock + 1n).toString(10),
          }, requesterAddress);
          return statusFromEvents(deploymentId, await this.events(deploymentId), intent);
        }
      }
    }
    if (agentId === null) {
      return statusFromEvents(deploymentId, await this.events(deploymentId), intent);
    }
    const chainAgent = await this.chain.readAgent({ agentId, blockNumber: finalizedBlock });
    if (chainAgent === null || lowerAddress(chainAgent.owner) !== lowerAddress(intent.ownerAddress)) {
      await this.appendReconcile(userId, deploymentId, "REGISTRY_OWNER_OR_AGENT_UNREADABLE", mintTransactionHash, { phase: "mint", status: "UNKNOWN", agentId, transactionHash: mintTransactionHash }, requesterAddress);
      return statusFromEvents(deploymentId, await this.events(deploymentId), intent);
    }
    events = await this.events(deploymentId);
    status = statusFromEvents(deploymentId, events, intent);
    if (status.mintCallsId === null || status.agentId !== agentId) {
      await this.appendReconcile(userId, deploymentId, "MINT_CONFIRMED_FROM_FINALIZED_REGISTRY", mintTransactionHash, { phase: "mint", status: "CONFIRMED", agentId, callsId: status.mintCallsId, transactionHash: mintTransactionHash, uriDigest: intent.uriDigest }, requesterAddress);
      events = await this.events(deploymentId);
      status = statusFromEvents(deploymentId, events, intent);
    }
    const finalFile = finalizedCreatorRegistrationFile(intent.registrationFile, agentId);
    const finalUri = encodedCreatorRegistrationUri(finalFile);
    const finalDigest = creatorRegistrationUriDigest(finalUri);
    const uriIntent = events.some((event) => event.status_message === CREATOR_ERC8004_BROWSER_URI_INTENT);
    if (status.state === "failed" || status.state === "mint_pending") return status;
    // Before a URI intent exists, only the original mint URI is expected. Once
    // a URI intent is durable, the exact server-produced final URI is the
    // authoritative reconciliation target—even if the browser lost the URI
    // transaction hash after broadcast.
    const expectedChainUri = uriIntent ? finalUri : intent.registrationUri;
    if (chainAgent.agentUri !== expectedChainUri) {
      const reason = uriIntent ? "FINAL_URI_NOT_CONFIRMED" : "REGISTRY_INITIAL_URI_UNREADABLE";
      await this.appendReconcile(userId, deploymentId, reason, status.uriTransactionHash, { phase: "uri", status: "UNKNOWN", agentId, transactionHash: status.uriTransactionHash, uriDigest: finalDigest }, requesterAddress);
      return statusFromEvents(deploymentId, await this.events(deploymentId), intent);
    }
    if (!uriIntent) return status;
    if (status.state !== "registered") {
      await this.appendReconcile(userId, deploymentId, "URI_CONFIRMED_FROM_FINALIZED_REGISTRY", status.uriTransactionHash, { phase: "uri", status: "CONFIRMED", agentId, callsId: status.uriCallsId, transactionHash: status.uriTransactionHash, uriDigest: finalDigest }, requesterAddress);
      events = await this.events(deploymentId);
      status = statusFromEvents(deploymentId, events, intent);
    }
    const identity = await this.finalizedIdentity(userId, deploymentId, intent, agentId, finalUri, finalDigest);
    if (identity === null) {
      await this.appendReconcile(userId, deploymentId, "G1_FINALIZED_IDENTITY_VERSION_OR_SERVICE_PENDING", status.uriTransactionHash, { agentId, uriDigest: finalDigest }, requesterAddress);
      return statusFromEvents(deploymentId, await this.events(deploymentId), intent);
    }
    await this.appendOperation(userId, deploymentId, intent, identity, status.uriTransactionHash, finalDigest, requesterAddress);
    return statusFromEvents(deploymentId, await this.events(deploymentId), intent);
  }

  private async appendReconcile(userId: string, deploymentId: string, reason: string, transactionHash: string | null, refs: EventReference, requesterAddress?: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`creator-erc8004-registration:${deploymentId}`]);
      const row = await this.deployment(userId, deploymentId, client, requesterAddress);
      await this.recordEvent(client, row, CREATOR_ERC8004_BROWSER_RECONCILE, { reason, ...refs }, transactionHash, true);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  private async appendOperation(userId: string, deploymentId: string, intent: CreatorRegistrationIntent, identity: NonNullable<CreatorRegistrationStatus["identity"]>, transactionHash: string | null, uriDigest: string, requesterAddress?: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`creator-erc8004-registration:${deploymentId}`]);
      const row = await this.deployment(userId, deploymentId, client, requesterAddress);
      const existing = await client.query("SELECT 1 FROM deployment_events WHERE deployment_id=$1 AND status_message=$2 LIMIT 1", [deploymentId, CREATOR_ERC8004_BROWSER_OPERATION]);
      if ((existing.rowCount ?? existing.rows.length) === 0) {
        await this.recordEvent(client, row, CREATOR_ERC8004_BROWSER_OPERATION, {
          operationId: intent.operationId,
          phase: "registered",
          chainId: CREATOR_ERC8004_CHAIN_ID,
          identityRegistry: CREATOR_ERC8004_REGISTRY,
          tradingPair: intent.configuration.tradingPair,
          configurationDigest: intent.configurationDigest,
          uriDigest,
          erc8004Identity: identity,
        }, transactionHash, false);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async status(userId: string, deploymentId: string, requesterAddress?: string): Promise<CreatorRegistrationStatus> {
    // Always scope a status read through the authenticated draft/authority
    // binding, even when a prior public intent already exists.
    await this.deployment(userId, deploymentId, this.pool, requesterAddress);
    const events = await this.events(deploymentId);
    const intent = asIntent(events, deploymentId) ?? await this.buildIntent(userId, deploymentId, this.pool, requesterAddress);
    return statusFromEvents(deploymentId, events, intent);
  }
}
