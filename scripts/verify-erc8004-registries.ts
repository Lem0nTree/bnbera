import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { keccak_256 } from "../packages/evidence/node_modules/@noble/hashes/sha3.js";

type AbiParameter = {
  readonly name?: string;
  readonly type: string;
  readonly components?: readonly AbiParameter[];
};

type AbiItem = {
  readonly type: "function" | "event" | "error" | "constructor" | "fallback" | "receive";
  readonly name?: string;
  readonly inputs?: readonly AbiParameter[];
};

type LockRegistry = {
  readonly specRevision?: string;
  readonly identityRegistry: string;
  readonly reputationRegistry: string;
  readonly abiHashes?: {
    readonly identityRegistry?: string | null;
    readonly reputationRegistry?: string | null;
  };
  readonly implementationSlot?: string;
  readonly proxyRuntimeSha256?: string;
  readonly implementationAddresses?: {
    readonly identityRegistry?: string;
    readonly reputationRegistry?: string;
  };
  readonly implementationRuntimeSha256?: {
    readonly identityRegistry?: string;
    readonly reputationRegistry?: string;
  };
};

type LockNetwork = {
  readonly name?: string;
  readonly environment?: string;
  readonly erc8004?: LockRegistry;
};

type StandardsLock = {
  readonly sources?: {
    readonly erc8004Spec?: {
      readonly url?: string;
      readonly commit?: string;
      readonly path?: string;
      readonly blob?: string;
      readonly sha256?: string;
      readonly retrievedAt?: string;
    };
    readonly erc8004Contracts?: {
      readonly url?: string;
      readonly commit?: string;
      readonly retrievedAt?: string;
      readonly abiHashAlgorithm?: string;
      readonly abiArtifacts?: {
        readonly identityRegistry?: { readonly path?: string; readonly blob?: string; readonly rawSha256?: string; readonly sha256?: string };
        readonly reputationRegistry?: { readonly path?: string; readonly blob?: string; readonly rawSha256?: string; readonly sha256?: string };
      };
    };
  };
  readonly networks?: Record<string, LockNetwork>;
};

const addressPattern = /^0x[0-9a-f]{40}$/iu;
const hashPattern = /^0x[0-9a-f]{64}$/iu;
const hexPattern = /^0x(?:[0-9a-f]{2})*$/iu;
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const expectedSelectors = {
  identityRegistry: {
    "ownerOf(uint256)": "0x6352211e",
    "getAgentWallet(uint256)": "0x00339509",
    "tokenURI(uint256)": "0xc87b56dd",
    "getMetadata(uint256,string)": "0xcb4799f2",
    "getVersion()": "0x0d8e6e2c"
  },
  reputationRegistry: {
    "getIdentityRegistry()": "0xbc4d861b",
    "getSummary(uint256,address[],string,string)": "0x81bbba58",
    "readFeedback(uint256,address,uint64)": "0x232b0810",
    "readAllFeedback(uint256,address[],string,string,bool)": "0xd9d84224"
  }
} as const;

const expectedTopics = {
  identityRegistry: {
    "Registered(uint256,string,address)": "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a",
    "URIUpdated(uint256,string,address)": "0x3a2c7fffc2cba7582c690e3b82c453ea02a308326a98a3ad7576c606336409fb",
    "MetadataSet(uint256,string,string,bytes)": "0x2c149ed548c6d2993cd73efe187df6eccabe4538091b33adbd25fafdb8a1468b"
  },
  reputationRegistry: {
    "NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)": "0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc",
    "FeedbackRevoked(uint256,address,uint64)": "0x25156fd3288212246d8b008d5921fde376c71ed14ac2e072a506eb06fde6d09d",
    "ResponseAppended(uint256,address,uint64,address,string,bytes32)": "0xb1c6be0b5b8aef6539e2fac0fd131a2faa7b49edf8e505b5eb0ad487d56051d4"
  }
} as const;

const defaultRpc: Record<"56" | "97", string> = {
  "56": "https://bsc-dataseed1.bnbchain.org",
  "97": "https://data-seed-prebsc-2-s1.bnbchain.org:8545"
};

const defaultAgentId: Record<"56" | "97", string> = {
  "56": "333061",
  "97": "1"
};

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalAbiSha256(abi: readonly AbiItem[]): string {
  return sha256(new TextEncoder().encode(JSON.stringify(abi)));
}

function abiParameterType(parameter: AbiParameter): string {
  if (!parameter.type.startsWith("tuple")) return parameter.type;
  const suffix = parameter.type.slice("tuple".length);
  const components = parameter.components ?? [];
  return `(${components.map(abiParameterType).join(",")})${suffix}`;
}

function abiSignature(item: AbiItem): string {
  if (typeof item.name !== "string" || (item.type !== "function" && item.type !== "event")) {
    throw new Error("ABI item cannot be used as a function/event signature.");
  }
  return `${item.name}(${(item.inputs ?? []).map(abiParameterType).join(",")})`;
}

function selector(signature: string): string {
  return bytesToHex(keccak_256(new TextEncoder().encode(signature)).slice(0, 4));
}

function eventTopic(signature: string): string {
  return bytesToHex(keccak_256(new TextEncoder().encode(signature)));
}

function endpointLabel(endpoint: string): string {
  const parsed = new URL(endpoint);
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username !== "" || parsed.password !== "") {
    throw new Error("RPC endpoint must be an HTTP(S) URL without credentials.");
  }
  return `${parsed.protocol}//${parsed.host}`;
}

function hexQuantity(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Block number is out of range.");
  return `0x${value.toString(16)}`;
}

function asAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || !addressPattern.test(value)) throw new Error(`${field} is not an address.`);
  return value.toLowerCase();
}

function asHash(value: unknown, field: string): string {
  if (typeof value !== "string" || !hashPattern.test(value)) throw new Error(`${field} is not a 32-byte hash.`);
  return value.toLowerCase();
}

function asHex(value: unknown, field: string): string {
  if (typeof value !== "string" || !hexPattern.test(value)) throw new Error(`${field} is not hexadecimal data.`);
  return value.toLowerCase();
}

function decodeAddress(result: string, field: string): string {
  const data = asHex(result, field);
  if (data.length < 64 + 2) throw new Error(`${field} response is too short.`);
  return asAddress(`0x${data.slice(-40)}`, field);
}

function decodeDynamicString(result: string, field: string): string {
  const data = asHex(result, field).slice(2);
  if (data.length < 64) throw new Error(`${field} response is too short.`);
  const offset = Number(BigInt(`0x${data.slice(0, 64)}`));
  if (!Number.isSafeInteger(offset) || offset < 0 || offset * 2 + 64 > data.length) throw new Error(`${field} response offset is invalid.`);
  const length = Number(BigInt(`0x${data.slice(offset * 2, offset * 2 + 64)}`));
  const start = offset * 2 + 64;
  if (!Number.isSafeInteger(length) || length < 0 || start + length * 2 > data.length) throw new Error(`${field} response length is invalid.`);
  return Buffer.from(data.slice(start, start + length * 2), "hex").toString("utf8");
}

function decodeVersion(result: string): string {
  return decodeDynamicString(result, "getVersion");
}

function encodeUint256(value: string): string {
  if (!/^(0|[1-9][0-9]*)$/u.test(value) || BigInt(value) > (1n << 256n) - 1n) throw new Error("Agent ID is not a uint256 decimal string.");
  return BigInt(value).toString(16).padStart(64, "0");
}

async function rpc(endpoint: string, method: string, params: readonly unknown[], timeoutMs = 20_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error("RPC returned an unsuccessful HTTP response.");
    const body = await response.json() as { readonly jsonrpc?: unknown; readonly id?: unknown; readonly result?: unknown; readonly error?: unknown };
    if (body.jsonrpc !== "2.0" || body.id !== 1 || body.error !== undefined) throw new Error(`RPC ${method} failed.`);
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

async function readCode(endpoint: string, address: string, blockTag: string): Promise<{ readonly code: string; readonly sha256: string }> {
  const code = asHex(await rpc(endpoint, "eth_getCode", [address, blockTag]), "contract bytecode");
  return { code, sha256: sha256(Buffer.from(code.slice(2), "hex")) };
}

async function readBlock(endpoint: string, number: number): Promise<{ readonly hash: string }> {
  const block = await rpc(endpoint, "eth_getBlockByNumber", [hexQuantity(number), false]) as { readonly hash?: unknown } | null;
  if (block === null || block.hash === undefined) throw new Error("RPC did not return the requested block.");
  return { hash: asHash(block.hash, "block hash") };
}

async function readAtBlock(endpoint: string, to: string, data: string, blockTag: string): Promise<string> {
  return asHex(await rpc(endpoint, "eth_call", [{ to, data }, blockTag]), "eth_call result");
}

function verifyAbi(
  identityAbi: readonly AbiItem[],
  reputationAbi: readonly AbiItem[],
  lock: StandardsLock
): Readonly<Record<string, unknown>> {
  const artifacts = lock.sources?.erc8004Contracts?.abiArtifacts;
  const expectedHashes = {
    identityRegistry: artifacts?.identityRegistry?.sha256,
    reputationRegistry: artifacts?.reputationRegistry?.sha256
  };
  const actualHashes = {
    identityRegistry: canonicalAbiSha256(identityAbi),
    reputationRegistry: canonicalAbiSha256(reputationAbi)
  };
  for (const key of ["identityRegistry", "reputationRegistry"] as const) {
    if (actualHashes[key] !== expectedHashes[key]) throw new Error(`Canonical ABI hash mismatch for ${key}.`);
  }

  const check = (abi: readonly AbiItem[], signatures: Readonly<Record<string, string>>, kind: "function" | "event") => {
    const found = new Map<string, string>();
    for (const item of abi) {
      if (item.type !== kind) continue;
      const signature = abiSignature(item);
      if (signatures[signature] !== undefined) found.set(signature, kind === "event" ? eventTopic(signature) : selector(signature));
    }
    const result: Record<string, string> = {};
    for (const [signature, expected] of Object.entries(signatures)) {
      const actual = found.get(signature);
      if (actual !== expected) throw new Error(`ABI ${kind} signature mismatch: ${signature}.`);
      result[signature] = actual;
    }
    return result;
  };

  return {
    hashAlgorithm: lock.sources?.erc8004Contracts?.abiHashAlgorithm ?? "unspecified",
    canonicalSha256: actualHashes,
    functionSelectors: {
      identityRegistry: check(identityAbi, expectedSelectors.identityRegistry, "function"),
      reputationRegistry: check(reputationAbi, expectedSelectors.reputationRegistry, "function")
    },
    eventTopics: {
      identityRegistry: check(identityAbi, expectedTopics.identityRegistry, "event"),
      reputationRegistry: check(reputationAbi, expectedTopics.reputationRegistry, "event")
    }
  };
}

async function verifyNetwork(
  networkId: "56" | "97",
  endpoint: string,
  network: LockNetwork,
  identityAbi: readonly AbiItem[],
  reputationAbi: readonly AbiItem[],
  agentId: string
): Promise<Readonly<Record<string, unknown>>> {
  const lock = network.erc8004;
  if (lock === undefined) throw new Error(`Network ${networkId} has no ERC-8004 lock.`);
  const identity = asAddress(lock.identityRegistry, `${networkId} identity registry`);
  const reputation = asAddress(lock.reputationRegistry, `${networkId} reputation registry`);
  const expectedSlot = (lock.implementationSlot ?? implementationSlot).toLowerCase();
  if (expectedSlot !== implementationSlot) throw new Error(`Network ${networkId} has an unexpected implementation slot.`);
  const expectedImplementations = lock.implementationAddresses;
  const expectedRuntimeHashes = lock.implementationRuntimeSha256;
  if (expectedImplementations?.identityRegistry === undefined || expectedImplementations.reputationRegistry === undefined || expectedRuntimeHashes?.identityRegistry === undefined || expectedRuntimeHashes.reputationRegistry === undefined || lock.proxyRuntimeSha256 === undefined) {
    throw new Error(`Network ${networkId} is missing implementation bytecode locks.`);
  }

  const observedChain = Number(BigInt(String(await rpc(endpoint, "eth_chainId", []))));
  if (observedChain !== Number(networkId)) throw new Error(`RPC chain mismatch for network ${networkId}.`);
  const latestBlock = Number(BigInt(String(await rpc(endpoint, "eth_blockNumber", []))));
  const block = await readBlock(endpoint, latestBlock);
  const blockTag = hexQuantity(latestBlock);
  const contracts: Record<string, unknown>[] = [];

  for (const [name, address, expectedImplementation, expectedRuntimeHash] of [
    ["identityRegistry", identity, expectedImplementations.identityRegistry, expectedRuntimeHashes.identityRegistry],
    ["reputationRegistry", reputation, expectedImplementations.reputationRegistry, expectedRuntimeHashes.reputationRegistry]
  ] as const) {
    const proxy = await readCode(endpoint, address, blockTag);
    if (proxy.code === "0x" || proxy.sha256 !== lock.proxyRuntimeSha256) throw new Error(`${networkId} ${name} proxy bytecode mismatch.`);
    const storage = asHex(await rpc(endpoint, "eth_getStorageAt", [address, expectedSlot, blockTag]), `${name} implementation slot`);
    if (storage.length !== 66) throw new Error(`${networkId} ${name} implementation slot length mismatch.`);
    const implementation = asAddress(`0x${storage.slice(-40)}`, `${name} implementation`);
    if (implementation !== expectedImplementation.toLowerCase()) throw new Error(`${networkId} ${name} implementation address mismatch.`);
    const runtime = await readCode(endpoint, implementation, blockTag);
    if (runtime.code === "0x" || runtime.sha256 !== expectedRuntimeHash) throw new Error(`${networkId} ${name} implementation bytecode mismatch.`);
    contracts.push({
      name,
      address,
      proxyBytecodeLength: (proxy.code.length - 2) / 2,
      proxySha256: proxy.sha256,
      implementation,
      implementationBytecodeLength: (runtime.code.length - 2) / 2,
      implementationSha256: runtime.sha256,
      implementationSlot: expectedSlot
    });
  }

  const identityVersion = decodeVersion(await readAtBlock(endpoint, identity, "0x0d8e6e2c", blockTag));
  const reputationVersion = decodeVersion(await readAtBlock(endpoint, reputation, "0x0d8e6e2c", blockTag));
  if (identityVersion !== "2.0.0" || reputationVersion !== "2.0.0") throw new Error(`${networkId} registry version mismatch.`);
  const reputationIdentityData = await readAtBlock(endpoint, reputation, "0xbc4d861b", blockTag);
  const reputationIdentity = decodeAddress(reputationIdentityData, "reputation identity registry");
  if (reputationIdentity !== identity) throw new Error(`${networkId} reputation registry identity linkage mismatch.`);

  const agentWord = encodeUint256(agentId);
  const owner = decodeAddress(await readAtBlock(endpoint, identity, `0x6352211e${agentWord}`, blockTag), "ownerOf");
  const agentWallet = decodeAddress(await readAtBlock(endpoint, identity, `0x00339509${agentWord}`, blockTag), "getAgentWallet");
  const tokenUri = decodeDynamicString(await readAtBlock(endpoint, identity, `0xc87b56dd${agentWord}`, blockTag), "tokenURI");
  if (tokenUri.length === 0) throw new Error(`${networkId} tokenURI is empty for verification agent.`);

  return {
    networkId: Number(networkId),
    name: network.name ?? null,
    environment: network.environment ?? null,
    endpoint: endpointLabel(endpoint),
    observedChainId: observedChain,
    latestBlock,
    latestBlockHash: block.hash,
    verificationAgentId: agentId,
    identityRead: {
      owner,
      agentWallet,
      tokenUriScheme: tokenUri.slice(0, tokenUri.indexOf(":")),
      tokenUriSha256: sha256(new TextEncoder().encode(tokenUri))
    },
    contracts
  };
}

const lockUrl = new URL("../config/standards.lock.json", import.meta.url);
const identityAbiUrl = new URL("../packages/agent-ingestion/abi/erc8004/IdentityRegistry.json", import.meta.url);
const reputationAbiUrl = new URL("../packages/agent-ingestion/abi/erc8004/ReputationRegistry.json", import.meta.url);
const [lockText, identityText, reputationText] = await Promise.all([
  readFile(lockUrl, "utf8"),
  readFile(identityAbiUrl, "utf8"),
  readFile(reputationAbiUrl, "utf8")
]);
const lock = JSON.parse(lockText) as StandardsLock;
const identityAbi = JSON.parse(identityText) as readonly AbiItem[];
const reputationAbi = JSON.parse(reputationText) as readonly AbiItem[];
// Secrets and endpoint values must be injected by the caller/secret manager;
// this verifier deliberately never reads a dotenv file or emits credentials.
const env = process.env;
const abi = verifyAbi(identityAbi, reputationAbi, lock);
const mainEndpoint = env.BSC_MAINNET_RPC_URL;
const testEndpoint = env.BSC_TESTNET_RPC_URL;
if (mainEndpoint === undefined || testEndpoint === undefined) throw new Error("BSC_MAINNET_RPC_URL and BSC_TESTNET_RPC_URL are required.");
const mainSecondaryEndpoint = env.BSC_MAINNET_RPC_URL_2 ?? defaultRpc["56"];
const testSecondaryEndpoint = env.BSC_TESTNET_RPC_URL_2 ?? defaultRpc["97"];
if (endpointLabel(mainEndpoint) === endpointLabel(mainSecondaryEndpoint) || endpointLabel(testEndpoint) === endpointLabel(testSecondaryEndpoint)) {
  throw new Error("Primary and secondary BSC RPC endpoints must be distinct providers.");
}
const mainAgentId = env.ERC8004_VERIFY_AGENT_ID_MAINNET ?? defaultAgentId["56"];
const testAgentId = env.ERC8004_VERIFY_AGENT_ID_TESTNET ?? defaultAgentId["97"];
const networks = lock.networks;
if (networks?.["56"] === undefined || networks["97"] === undefined) throw new Error("BSC mainnet and testnet locks are required.");

const [main, mainSecondary, test, testSecondary] = await Promise.all([
  verifyNetwork("56", mainEndpoint, networks["56"], identityAbi, reputationAbi, mainAgentId),
  verifyNetwork("56", mainSecondaryEndpoint, networks["56"], identityAbi, reputationAbi, mainAgentId),
  verifyNetwork("97", testEndpoint, networks["97"], identityAbi, reputationAbi, testAgentId),
  verifyNetwork("97", testSecondaryEndpoint, networks["97"], identityAbi, reputationAbi, testAgentId)
]);

function combineProviders(primary: Readonly<Record<string, unknown>>, secondary: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const primaryContracts = primary.contracts as readonly Readonly<Record<string, unknown>>[];
  const secondaryContracts = secondary.contracts as readonly Readonly<Record<string, unknown>>[];
  for (const contract of primaryContracts) {
    const counterpart = secondaryContracts.find((entry) => entry.name === contract.name);
    if (counterpart === undefined || counterpart.proxySha256 !== contract.proxySha256 || counterpart.implementation !== contract.implementation || counterpart.implementationSha256 !== contract.implementationSha256) {
      throw new Error(`RPC providers disagree on ${String(contract.name)} bytecode/linkage.`);
    }
  }
  return {
    ...primary,
    providerComparison: {
      providers: [primary.endpoint, secondary.endpoint],
      sameChainAndBytecode: true,
      secondaryLatestBlock: secondary.latestBlock,
      secondaryLatestBlockHash: secondary.latestBlockHash
    }
  };
}

console.log(JSON.stringify({
  evidenceType: "live-read-only",
  checkedAt: new Date().toISOString(),
  source: {
    erc8004Spec: lock.sources?.erc8004Spec ?? null,
    erc8004Contracts: lock.sources?.erc8004Contracts ?? null
  },
  abi,
  networks: [combineProviders(main, mainSecondary), combineProviders(test, testSecondary)]
}, null, 2));
