import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeEventTopics,
  encodeFunctionData,
  type Abi,
  type Hex
} from "viem";
import { normalizeErc8004Identity, type Erc8004Identity } from "@bnbera/domain";
import { ingestionError } from "../errors.js";
import {
  JsonRpcRegistryChainReader,
  type RegistryLogDecoder,
  type RegistryReadDefinition,
  type RegistryRpcReaderOptions
} from "./registry-rpc.js";

/** Canonical SHA-256 pinned by the official IdentityRegistry.json snapshot. */
export const officialErc8004IdentityAbiSha256 = "6d5974b564d266507a53f65951adcd0ab288904d5a716a354ea237176ece8f83";

const identityAbiUrl = new URL("../../abi/erc8004/IdentityRegistry.json", import.meta.url);
const addressPattern = /^0x[0-9a-f]{40}$/iu;
const hexPattern = /^0x(?:[0-9a-f]{2})*$/iu;

type LoadedIdentityAbi = {
  readonly abi: Abi;
  readonly sha256: string;
};

let loadedIdentityAbi: LoadedIdentityAbi | undefined;

function loadOfficialIdentityAbi(): LoadedIdentityAbi {
  if (loadedIdentityAbi !== undefined) return loadedIdentityAbi;

  let parsed: unknown;
  try {
    const bytes = readFileSync(identityAbiUrl, "utf8");
    parsed = JSON.parse(bytes) as unknown;
  } catch (cause) {
    throw ingestionError(
      "CHAIN_PROVIDER_INVALID",
      "The pinned ERC-8004 Identity Registry ABI could not be loaded.",
      "repair_registry_abi",
      cause
    );
  }
  if (!Array.isArray(parsed)) {
    throw ingestionError(
      "CHAIN_PROVIDER_INVALID",
      "The pinned ERC-8004 Identity Registry ABI is invalid.",
      "repair_registry_abi"
    );
  }

  const sha256 = createHash("sha256")
    .update(JSON.stringify(parsed))
    .digest("hex");
  if (sha256 !== officialErc8004IdentityAbiSha256) {
    throw ingestionError(
      "CHAIN_PROVIDER_INVALID",
      "The ERC-8004 Identity Registry ABI does not match the standards lock.",
      "repair_registry_abi"
    );
  }

  const abi = parsed as Abi;
  assertReadFunction(abi, "ownerOf", "address");
  assertReadFunction(abi, "getAgentWallet", "address");
  assertReadFunction(abi, "tokenURI", "string");
  loadedIdentityAbi = { abi, sha256 };
  return loadedIdentityAbi;
}

function assertReadFunction(abi: Abi, name: string, outputType: string): void {
  const item = abi.find((candidate) => candidate.type === "function" && candidate.name === name);
  if (
    item === undefined ||
    item.type !== "function" ||
    item.stateMutability !== "view" ||
    item.inputs?.length !== 1 ||
    item.inputs[0]?.type !== "uint256" ||
    item.outputs?.length !== 1 ||
    item.outputs[0]?.type !== outputType
  ) {
    throw ingestionError(
      "CHAIN_PROVIDER_INVALID",
      `The pinned ERC-8004 ABI is missing the reviewed ${name}(uint256) read.`,
      "repair_registry_abi"
    );
  }
}

function expectedHash(value: string): string {
  if (!/^([0-9a-f]{64})$/iu.test(value)) {
    throw ingestionError(
      "CHAIN_PROVIDER_INVALID",
      "The standards-locked ERC-8004 ABI hash is invalid.",
      "repair_registry_lock"
    );
  }
  return value.toLowerCase();
}

function agentId(identity: Erc8004Identity): bigint {
  const normalized = normalizeErc8004Identity(identity);
  try {
    return BigInt(normalized.agentId);
  } catch (cause) {
    throw ingestionError(
      "CHAIN_PROVIDER_INVALID",
      "The ERC-8004 agent ID could not be encoded as uint256.",
      "review_identity",
      cause
    );
  }
}

function calldataError(name: string, cause: unknown): never {
  throw ingestionError(
    "CHAIN_PROVIDER_INVALID",
    `The pinned ERC-8004 ${name} calldata could not be encoded.`,
    "fix_registry_abi",
    cause
  );
}

function decodeInput(result: string, name: string): Hex {
  if (typeof result !== "string" || !hexPattern.test(result)) {
    throw ingestionError(
      "CHAIN_PROVIDER_INVALID",
      `The ERC-8004 ${name} response is not ABI data.`,
      "fix_registry_abi"
    );
  }
  return result.toLowerCase() as Hex;
}

function decodeAddress(abi: Abi, name: "ownerOf" | "getAgentWallet", result: string): string {
  try {
    const decoded = decodeFunctionResult({
      abi,
      functionName: name,
      data: decodeInput(result, name)
    }) as unknown;
    if (typeof decoded !== "string" || !addressPattern.test(decoded)) {
      throw new Error("address result shape is invalid");
    }
    return decoded;
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && (cause as { readonly code?: unknown }).code === "CHAIN_PROVIDER_INVALID") {
      throw cause;
    }
    throw ingestionError(
      "CHAIN_PROVIDER_INVALID",
      `The ERC-8004 ${name} response could not be decoded.`,
      "fix_registry_abi",
      cause
    );
  }
}

function decodeUri(abi: Abi, result: string): string {
  try {
    const decoded = decodeFunctionResult({
      abi,
      functionName: "tokenURI",
      data: decodeInput(result, "tokenURI")
    }) as unknown;
    if (typeof decoded !== "string") {
      throw new Error("tokenURI result shape is invalid");
    }
    return decoded;
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && (cause as { readonly code?: unknown }).code === "CHAIN_PROVIDER_INVALID") {
      throw cause;
    }
    throw ingestionError(
      "CHAIN_PROVIDER_INVALID",
      "The ERC-8004 tokenURI response could not be decoded.",
      "fix_registry_abi",
      cause
    );
  }
}

const officialRegistryEventNames = [
  "Registered",
  "Transfer",
  "URIUpdated",
  "MetadataSet",
  "MetadataUpdate"
] as const;
type OfficialRegistryEventName = (typeof officialRegistryEventNames)[number];

function eventTopic(abi: Abi, eventName: OfficialRegistryEventName): Hex {
  try {
    const encoded = encodeEventTopics({ abi, eventName } as never) as readonly unknown[];
    const topic = encoded[0];
    if (typeof topic !== "string" || !/^0x[0-9a-f]{64}$/iu.test(topic)) {
      throw new Error("event signature topic is invalid");
    }
    return topic.toLowerCase() as Hex;
  } catch (cause) {
    throw ingestionError(
      "CHAIN_PROVIDER_INVALID",
      `The pinned ERC-8004 ABI is missing the reviewed ${eventName} event.`,
      "repair_registry_abi",
      cause
    );
  }
}

function eventHex(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw ingestionError("CHAIN_PROVIDER_INVALID", `The registry event ${field} is not ABI hex data.`, "fix_registry_abi");
  }
  return value.toLowerCase() as Hex;
}

function eventTopics(value: unknown): readonly Hex[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((topic) => typeof topic !== "string")) {
    throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry event topics are invalid.", "fix_registry_abi");
  }
  return value.map((topic, index) => {
    const normalized = eventHex(topic, `topic ${index}`);
    if (index === 0 && normalized.length !== 66) {
      throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry event signature topic is invalid.", "fix_registry_abi");
    }
    return normalized;
  });
}

function safeEventValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString(10);
  if (Array.isArray(value)) return value.map((item) => safeEventValue(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, safeEventValue(child)]));
  }
  return value;
}

function eventArguments(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry event arguments are invalid.", "fix_registry_abi");
  }
  const safe = safeEventValue(value);
  if (typeof safe !== "object" || safe === null || Array.isArray(safe)) {
    throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry event arguments are invalid.", "fix_registry_abi");
  }
  return safe as Readonly<Record<string, unknown>>;
}

function eventAgentId(args: Readonly<Record<string, unknown>>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || !/^[0-9]+$/u.test(value)) {
    throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry event agent ID is invalid.", "fix_registry_abi");
  }
  return value;
}

function eventAddress(args: Readonly<Record<string, unknown>>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || !addressPattern.test(value)) {
    throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry event address is invalid.", "fix_registry_abi");
  }
  return value;
}

function eventUri(args: Readonly<Record<string, unknown>>, name: string): string | null {
  const value = args[name];
  if (typeof value !== "string") {
    throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry event URI is invalid.", "fix_registry_abi");
  }
  return value.length === 0 ? null : value;
}

function eventAgentIdArgument(eventName: OfficialRegistryEventName): string {
  switch (eventName) {
    case "Registered":
    case "URIUpdated":
    case "MetadataSet":
      return "agentId";
    case "Transfer":
      return "tokenId";
    case "MetadataUpdate":
      return "_tokenId";
  }
}

export type OfficialErc8004RegistryEventDecoder = {
  readonly logTopics: readonly Hex[];
  readonly decodeLog: RegistryLogDecoder;
};

/**
 * Build the event filter and decoder from the same checked-in ABI used by
 * owner/wallet/URI reads. Unknown ABI events are ignored, while malformed
 * reviewed events fail closed at the RPC boundary.
 */
export function createOfficialErc8004RegistryEventDecoder(): OfficialErc8004RegistryEventDecoder {
  const loaded = loadOfficialIdentityAbi();
  const topics = officialRegistryEventNames.map((name) => eventTopic(loaded.abi, name));
  const topicToName = new Map(topics.map((topic, index) => [topic, officialRegistryEventNames[index]]));
  return {
    logTopics: topics,
    decodeLog: ({ log, chainId, identityRegistry }) => {
      const rawTopics = log.topics;
      if (!Array.isArray(rawTopics) || rawTopics.length === 0) {
        throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry provider returned an event without topics.", "fix_chain_provider");
      }
      const topicsForDecode = eventTopics(rawTopics);
      const signature = topicsForDecode[0];
      if (signature === undefined) {
        throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry provider returned an event without a signature topic.", "fix_chain_provider");
      }
      const eventName = topicToName.get(signature);
      if (eventName === undefined) return null;
      const data = eventHex(log.data, "data");
      let decoded: { readonly args?: unknown };
      try {
        decoded = decodeEventLog({ abi: loaded.abi, topics: topicsForDecode, data, strict: true } as never) as { readonly args?: unknown };
      } catch (cause) {
        throw ingestionError("CHAIN_PROVIDER_INVALID", `The ${eventName} registry event could not be decoded.`, "fix_registry_abi", cause);
      }
      const args = eventArguments(decoded.args);
      const identityBase = {
        namespace: "eip155",
        chainId,
        identityRegistry,
        agentId: eventAgentId(args, eventAgentIdArgument(eventName))
      } as const;
      const payload = { event: eventName, args } as const;
      switch (eventName) {
        case "Registered":
          return {
            identity: identityBase,
            eventType: eventName,
            transactionHash: "0x" + "00".repeat(32),
            logIndex: 0,
            blockNumber: 0,
            blockHash: "0x" + "00".repeat(32),
            ownerAddress: eventAddress(args, "owner"),
            agentUri: eventUri(args, "agentURI"),
            changedFields: ["ownerAddress", "agentUri"],
            payload
          };
        case "Transfer":
          return {
            identity: identityBase,
            eventType: eventName,
            transactionHash: "0x" + "00".repeat(32),
            logIndex: 0,
            blockNumber: 0,
            blockHash: "0x" + "00".repeat(32),
            ownerAddress: eventAddress(args, "to"),
            changedFields: ["ownerAddress"],
            payload
          };
        case "URIUpdated":
          return {
            identity: identityBase,
            eventType: eventName,
            transactionHash: "0x" + "00".repeat(32),
            logIndex: 0,
            blockNumber: 0,
            blockHash: "0x" + "00".repeat(32),
            agentUri: eventUri(args, "newURI"),
            changedFields: ["agentUri"],
            payload
          };
        case "MetadataSet":
        case "MetadataUpdate":
          return {
            identity: identityBase,
            eventType: eventName,
            transactionHash: "0x" + "00".repeat(32),
            logIndex: 0,
            blockNumber: 0,
            blockHash: "0x" + "00".repeat(32),
            changedFields: [],
            payload
          };
      }
    }
  };
}

export type OfficialErc8004RegistryReadDefinitions = {
  readonly abiSha256: string;
  readonly owner: RegistryReadDefinition<string>;
  readonly agentWallet: RegistryReadDefinition<string>;
  /** ERC-8004 v2 exposes the agentURI value through ERC-721 tokenURI(uint256). */
  readonly agentUri: RegistryReadDefinition<string>;
};

/**
 * Build exact ERC-8004 v2 reads from the standards-locked official ABI.
 *
 * The expected hash is mandatory so a caller cannot accidentally use a local
 * or upgraded ABI without first changing the reviewed standards lock. The
 * returned definitions are read-only; no write ABI is exposed.
 */
export function createOfficialErc8004RegistryReadDefinitions(options: {
  readonly expectedAbiSha256: string;
}): OfficialErc8004RegistryReadDefinitions {
  const expected = expectedHash(options.expectedAbiSha256);
  const loaded = loadOfficialIdentityAbi();
  if (loaded.sha256 !== expected) {
    throw ingestionError(
      "CHAIN_PROVIDER_INVALID",
      "The ERC-8004 Identity Registry ABI does not match the standards lock.",
      "repair_registry_lock"
    );
  }

  return {
    abiSha256: loaded.sha256,
    owner: {
      calldata: (identity) => {
        try {
          return encodeFunctionData({ abi: loaded.abi, functionName: "ownerOf", args: [agentId(identity)] });
        } catch (cause) {
          return calldataError("ownerOf", cause);
        }
      },
      decode: (result) => decodeAddress(loaded.abi, "ownerOf", result)
    },
    agentWallet: {
      calldata: (identity) => {
        try {
          return encodeFunctionData({ abi: loaded.abi, functionName: "getAgentWallet", args: [agentId(identity)] });
        } catch (cause) {
          return calldataError("getAgentWallet", cause);
        }
      },
      decode: (result) => decodeAddress(loaded.abi, "getAgentWallet", result)
    },
    agentUri: {
      calldata: (identity) => {
        try {
          return encodeFunctionData({ abi: loaded.abi, functionName: "tokenURI", args: [agentId(identity)] });
        } catch (cause) {
          return calldataError("tokenURI", cause);
        }
      },
      decode: (result) => decodeUri(loaded.abi, result)
    }
  };
}

export type OfficialErc8004RegistryReaderOptions = Omit<RegistryRpcReaderOptions, "owner" | "agentWallet" | "agentUri"> & {
  readonly expectedAbiSha256: string;
};

/** Construct the configured read-only registry adapter from the pinned ABI. */
export function createOfficialErc8004RegistryReader(options: OfficialErc8004RegistryReaderOptions) {
  const { expectedAbiSha256, ...readerOptions } = options;
  const definitions = createOfficialErc8004RegistryReadDefinitions({ expectedAbiSha256 });
  const events = createOfficialErc8004RegistryEventDecoder();
  return new JsonRpcRegistryChainReader({
    ...readerOptions,
    ...definitions,
    // JSON-RPC topic positions are ANDed. Put all reviewed event signatures
    // in topic0's nested OR list instead of treating them as five positions
    // (and exceeding the four-position eth_getLogs limit).
    logTopics: [events.logTopics],
    decodeLog: events.decodeLog
  });
}
