import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  decodeFunctionResult,
  encodeFunctionData,
  type Abi,
  type Hex
} from "viem";
import { normalizeErc8004Identity, type Erc8004Identity } from "@bnbera/domain";
import { ingestionError } from "../errors.js";
import {
  JsonRpcRegistryChainReader,
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
  return new JsonRpcRegistryChainReader({
    ...readerOptions,
    ...definitions
  });
}
