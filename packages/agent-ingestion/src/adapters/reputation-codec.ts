import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  decodeEventLog,
  encodeEventTopics,
  type Abi,
  type Hex
} from "viem";
import { normalizeErc8004Identity, normalizeEvmAddress } from "@bnbera/domain";
import { ingestionError } from "../errors.js";
import type { ReputationFeedbackEvent } from "../types.js";

export const officialErc8004ReputationAbiSha256 = "867b7975a5f2f9fee38c4a148a84471b141f4de91409ccc0c6bebe3df4f04001";

const reputationAbiUrl = new URL("../../abi/erc8004/ReputationRegistry.json", import.meta.url);
const addressPattern = /^0x[0-9a-f]{40}$/iu;
const bytes32Pattern = /^0x[0-9a-f]{64}$/iu;

type LoadedReputationAbi = { readonly abi: Abi; readonly sha256: string };
let loadedReputationAbi: LoadedReputationAbi | undefined;

function loadOfficialReputationAbi(): LoadedReputationAbi {
  if (loadedReputationAbi !== undefined) return loadedReputationAbi;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(reputationAbiUrl, "utf8")) as unknown;
  } catch (cause) {
    throw ingestionError("CHAIN_PROVIDER_INVALID", "The pinned ERC-8004 Reputation Registry ABI could not be loaded.", "repair_reputation_abi", cause);
  }
  if (!Array.isArray(parsed)) throw ingestionError("CHAIN_PROVIDER_INVALID", "The pinned ERC-8004 Reputation Registry ABI is invalid.", "repair_reputation_abi");
  const sha256 = createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
  if (sha256 !== officialErc8004ReputationAbiSha256) throw ingestionError("CHAIN_PROVIDER_INVALID", "The ERC-8004 Reputation Registry ABI does not match the standards lock.", "repair_reputation_abi");
  const abi = parsed as Abi;
  assertEvent(abi, "NewFeedback", [
    ["agentId", "uint256", true], ["clientAddress", "address", true], ["feedbackIndex", "uint64", false],
    ["value", "int128", false], ["valueDecimals", "uint8", false], ["indexedTag1", "string", true],
    ["tag1", "string", false], ["tag2", "string", false], ["endpoint", "string", false],
    ["feedbackURI", "string", false], ["feedbackHash", "bytes32", false]
  ]);
  assertEvent(abi, "FeedbackRevoked", [
    ["agentId", "uint256", true], ["clientAddress", "address", true], ["feedbackIndex", "uint64", true]
  ]);
  loadedReputationAbi = { abi, sha256 };
  return loadedReputationAbi;
}

function assertEvent(abi: Abi, name: string, expected: readonly (readonly [string, string, boolean])[]): void {
  const item = abi.find((candidate) => candidate.type === "event" && candidate.name === name);
  if (item === undefined || item.type !== "event" || item.inputs.length !== expected.length || item.inputs.some((input, index) => {
    const candidate = expected[index];
    return candidate === undefined || input.name !== candidate[0] || input.type !== candidate[1] || input.indexed !== candidate[2];
  })) throw ingestionError("CHAIN_PROVIDER_INVALID", `The pinned Reputation Registry ABI is missing the reviewed ${name} event shape.`, "repair_reputation_abi");
}

function topicFor(abi: Abi, eventName: "NewFeedback" | "FeedbackRevoked"): Hex {
  try {
    const encoded = encodeEventTopics({ abi, eventName } as never) as readonly unknown[];
    const topic = encoded[0];
    if (typeof topic !== "string" || !bytes32Pattern.test(topic)) throw new Error("invalid event topic");
    return topic.toLowerCase() as Hex;
  } catch (cause) {
    throw ingestionError("CHAIN_PROVIDER_INVALID", `The pinned Reputation Registry ABI is missing the ${eventName} event topic.`, "repair_reputation_abi", cause);
  }
}

function eventHex(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) throw ingestionError("CHAIN_PROVIDER_INVALID", `The reputation event ${field} is not ABI hex data.`, "fix_reputation_abi");
  return value.toLowerCase() as Hex;
}

function eventTopics(value: unknown): readonly Hex[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((topic) => typeof topic !== "string")) throw ingestionError("CHAIN_PROVIDER_INVALID", "The reputation event topics are invalid.", "fix_reputation_abi");
  return value.map((topic, index) => {
    const normalized = eventHex(topic, `topic ${index}`);
    if (index === 0 && !bytes32Pattern.test(normalized)) throw ingestionError("CHAIN_PROVIDER_INVALID", "The reputation event signature topic is invalid.", "fix_reputation_abi");
    return normalized;
  });
}

function safeEventValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString(10);
  if (Array.isArray(value)) return value.map(safeEventValue);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, safeEventValue(child)]));
  return value;
}

function eventArguments(value: unknown): Readonly<Record<string, unknown>> {
  const safe = safeEventValue(value);
  if (typeof safe !== "object" || safe === null || Array.isArray(safe)) throw ingestionError("CHAIN_PROVIDER_INVALID", "The reputation event arguments are invalid.", "fix_reputation_abi");
  return safe as Readonly<Record<string, unknown>>;
}

function decimalArgument(args: Readonly<Record<string, unknown>>, name: string, signed = false): string {
  const value = args[name];
  const pattern = signed ? /^-?(0|[1-9][0-9]*)$/u : /^(0|[1-9][0-9]*)$/u;
  const candidate = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof candidate !== "string" || !pattern.test(candidate)) throw ingestionError("CHAIN_PROVIDER_INVALID", `The reputation event ${name} is not a decimal.`, "fix_reputation_abi");
  return candidate;
}

function addressArgument(args: Readonly<Record<string, unknown>>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || !addressPattern.test(value)) throw ingestionError("CHAIN_PROVIDER_INVALID", `The reputation event ${name} is not an address.`, "fix_reputation_abi");
  return normalizeEvmAddress(value);
}

function stringArgument(args: Readonly<Record<string, unknown>>, name: string): string {
  const value = args[name];
  if (typeof value !== "string") throw ingestionError("CHAIN_PROVIDER_INVALID", `The reputation event ${name} is not a string.`, "fix_reputation_abi");
  return value;
}

function hashArgument(args: Readonly<Record<string, unknown>>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || !bytes32Pattern.test(value)) throw ingestionError("CHAIN_PROVIDER_INVALID", `The reputation event ${name} is not bytes32.`, "fix_reputation_abi");
  return value.toLowerCase();
}

export type DecodedReputationEvent = Omit<ReputationFeedbackEvent, "transactionHash" | "logIndex" | "blockNumber" | "blockHash" | "observedAt" | "canonicalizedAt" | "orphanedAt" | "payloadDigest">;

export type ReputationLogDecoder = (input: {
  readonly log: Readonly<Record<string, unknown>>;
  readonly chainId: number;
  readonly identityRegistry: string;
  readonly reputationRegistry: string;
}) => DecodedReputationEvent | null;

export type OfficialErc8004ReputationEventDecoder = {
  readonly abiSha256: string;
  readonly logTopics: readonly Hex[];
  readonly decodeLog: ReputationLogDecoder;
};

export function createOfficialErc8004ReputationEventDecoder(): OfficialErc8004ReputationEventDecoder {
  const loaded = loadOfficialReputationAbi();
  const eventNames = ["NewFeedback", "FeedbackRevoked"] as const;
  const topics = eventNames.map((name) => topicFor(loaded.abi, name));
  const topicToName = new Map(topics.map((topic, index) => [topic, eventNames[index]]));
  return {
    abiSha256: loaded.sha256,
    logTopics: topics,
    decodeLog: ({ log, chainId, identityRegistry, reputationRegistry }) => {
      const topicsForDecode = eventTopics(log.topics);
      const signature = topicsForDecode[0];
      if (signature === undefined) throw ingestionError("CHAIN_PROVIDER_INVALID", "The reputation provider returned an event without a signature topic.", "fix_reputation_abi");
      const eventName = topicToName.get(signature);
      if (eventName === undefined) return null;
      let decoded: { readonly args?: unknown };
      try {
        decoded = decodeEventLog({ abi: loaded.abi, topics: topicsForDecode, data: eventHex(log.data, "data"), strict: true } as never) as { readonly args?: unknown };
      } catch (cause) {
        throw ingestionError("CHAIN_PROVIDER_INVALID", `The ${eventName} reputation event could not be decoded.`, "fix_reputation_abi", cause);
      }
      const args = eventArguments(decoded.args);
      const identity = normalizeErc8004Identity({ namespace: "eip155", chainId, identityRegistry, agentId: decimalArgument(args, "agentId") });
      const base = { identity, reputationRegistry: normalizeEvmAddress(reputationRegistry), clientAddress: addressArgument(args, "clientAddress"), confirmationState: "provisional" as const };
      if (eventName === "FeedbackRevoked") {
        return { ...base, eventType: "FeedbackRevoked" as const, feedbackIndex: decimalArgument(args, "feedbackIndex"), value: null, valueDecimals: null, indexedTag1: null, tag1: null, tag2: null, endpoint: null, feedbackUri: null, feedbackHash: null };
      }
      const valueDecimals = decimalArgument(args, "valueDecimals");
      const parsedDecimals = Number(valueDecimals);
      if (!Number.isSafeInteger(parsedDecimals) || parsedDecimals < 0 || parsedDecimals > 255) throw ingestionError("CHAIN_PROVIDER_INVALID", "The reputation event valueDecimals is invalid.", "fix_reputation_abi");
      return { ...base, eventType: "NewFeedback" as const, feedbackIndex: decimalArgument(args, "feedbackIndex"), value: decimalArgument(args, "value", true), valueDecimals: parsedDecimals, indexedTag1: stringArgument(args, "indexedTag1"), tag1: stringArgument(args, "tag1"), tag2: stringArgument(args, "tag2"), endpoint: stringArgument(args, "endpoint"), feedbackUri: stringArgument(args, "feedbackURI"), feedbackHash: hashArgument(args, "feedbackHash") };
    }
  };
}

export function assertOfficialErc8004ReputationAbi(expectedAbiSha256: string): OfficialErc8004ReputationEventDecoder {
  if (!/^[0-9a-f]{64}$/iu.test(expectedAbiSha256) || expectedAbiSha256.toLowerCase() !== officialErc8004ReputationAbiSha256) throw ingestionError("CHAIN_PROVIDER_INVALID", "The configured Reputation Registry ABI hash is not standards-locked.", "repair_reputation_lock");
  const decoder = createOfficialErc8004ReputationEventDecoder();
  if (decoder.abiSha256 !== expectedAbiSha256.toLowerCase()) throw ingestionError("CHAIN_PROVIDER_INVALID", "The Reputation Registry ABI hash does not match the standards lock.", "repair_reputation_lock");
  return decoder;
}
