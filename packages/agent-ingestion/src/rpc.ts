import { AppError } from "@bnbera/config";
import { ingestionError } from "./errors.js";

const httpUrlPattern = /^https?:\/\/[^\s]+$/iu;
const quantityPattern = /^0x[0-9a-f]+$/iu;
const hashPattern = /^0x[0-9a-f]{64}$/iu;
const addressPattern = /^0x[0-9a-f]{40}$/iu;
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

/** JSON-RPC methods permitted by the ingestion read boundary. */
export const readOnlyRpcMethods = Object.freeze([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_call",
  "eth_getLogs",
  "eth_getTransactionReceipt",
  "net_version"
] as const);
const readOnlyRpcMethodSet = new Set<string>(readOnlyRpcMethods);

export type JsonRpcRequest = {
  readonly method: string;
  readonly params?: readonly unknown[];
};

export type JsonRpcClientOptions = {
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly maxResponseBytes?: number;
};

export type RpcBlockReference = {
  readonly number: number;
  readonly hash: string;
  readonly parentHash: string;
};

type JsonRpcResponse = {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: unknown; readonly message?: unknown; readonly data?: unknown };
};

function assertEndpoint(endpoint: string): string {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch (cause) {
    throw ingestionError("CHAIN_PROVIDER_INVALID", "The configured RPC endpoint is invalid.", "fix_chain_provider", cause);
  }
  if (!httpUrlPattern.test(endpoint) || (parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
    throw ingestionError("CHAIN_PROVIDER_INVALID", "The configured RPC endpoint must be an HTTP(S) URL without credentials.", "fix_chain_provider");
  }
  return parsed.toString();
}

function quantityToNumber(value: unknown, field: string): number {
  if (typeof value !== "string" || !quantityPattern.test(value)) {
    throw ingestionError("CHAIN_PROVIDER_INVALID", `The RPC response ${field} is invalid.`, "retry_chain_read");
  }
  try {
    const parsed = BigInt(value);
    const number = Number(parsed);
    if (!Number.isSafeInteger(number) || number < 0) throw new Error("out of range");
    return number;
  } catch (cause) {
    throw ingestionError("CHAIN_PROVIDER_INVALID", `The RPC response ${field} is out of range.`, "retry_chain_read", cause);
  }
}

function hash(value: unknown, field: string): string {
  if (typeof value !== "string" || !hashPattern.test(value)) {
    throw ingestionError("CHAIN_PROVIDER_INVALID", `The RPC response ${field} is not a block hash.`, "retry_chain_read");
  }
  return value.toLowerCase();
}

function code(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw ingestionError("CHAIN_PROVIDER_INVALID", `The RPC response ${field} is not EVM bytecode.`, "retry_chain_read");
  }
  return value.toLowerCase();
}

function storageWord(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/iu.test(value)) {
    throw ingestionError("CHAIN_PROVIDER_INVALID", `The RPC response ${field} is not a storage word.`, "retry_chain_read");
  }
  return value.toLowerCase();
}

function responseObject(value: unknown): JsonRpcResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw ingestionError("CHAIN_PROVIDER_INVALID", "The RPC response is not a JSON-RPC object.", "retry_chain_read");
  }
  return value as JsonRpcResponse;
}

/**
 * Minimal JSON-RPC transport for read-only chain operations. There is no
 * transaction or signing method in this class by design.
 */
export class JsonRpcClient {
  private readonly endpoint: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly headers: Readonly<Record<string, string>>;
  private readonly maxResponseBytes: number;
  private nextId = 1;

  constructor(endpoint: string, options: JsonRpcClientOptions = {}) {
    this.endpoint = assertEndpoint(endpoint);
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 250 || this.timeoutMs > 120_000) {
      throw ingestionError("CHAIN_PROVIDER_INVALID", "The RPC timeout is invalid.", "fix_chain_provider");
    }
    this.headers = { "content-type": "application/json", ...(options.headers ?? {}) };
    this.maxResponseBytes = options.maxResponseBytes ?? 4 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxResponseBytes) || this.maxResponseBytes < 1_024 || this.maxResponseBytes > 32 * 1024 * 1024) {
      throw ingestionError("CHAIN_PROVIDER_INVALID", "The RPC response size limit is invalid.", "fix_chain_provider");
    }
  }

  async request<T>(request: JsonRpcRequest): Promise<T> {
    const method = typeof request.method === "string" && /^[A-Za-z0-9_.-]{1,128}$/u.test(request.method)
      ? request.method
      : null;
    if (method === null) throw ingestionError("CHAIN_PROVIDER_INVALID", "The RPC method is invalid.", "fix_chain_provider");
    if (!readOnlyRpcMethodSet.has(method)) {
      throw ingestionError("CHAIN_PROVIDER_INVALID", "The configured RPC boundary permits read-only methods only.", "remove_write_method");
    }
    const id = this.nextId++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params: request.params ?? [] }),
        signal: controller.signal
      });
    } catch (cause) {
      clearTimeout(timer);
      throw ingestionError("CHAIN_PROVIDER_UNAVAILABLE", "The chain provider could not be reached.", "retry_chain_read", cause, true);
    }
    try {
      if (!response.ok) {
        throw ingestionError("CHAIN_PROVIDER_UNAVAILABLE", "The chain provider returned an unsuccessful HTTP response.", "retry_chain_read", undefined, true);
      }
      const contentLength = response.headers.get("content-length");
      if (contentLength !== null && /^[0-9]+$/u.test(contentLength) && Number(contentLength) > this.maxResponseBytes) {
        throw ingestionError("CHAIN_PROVIDER_INVALID", "The chain provider response exceeds the configured size limit.", "reduce_chain_range");
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > this.maxResponseBytes) throw ingestionError("CHAIN_PROVIDER_INVALID", "The chain provider response exceeds the configured size limit.", "reduce_chain_range");
      let body: unknown;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch (cause) { throw ingestionError("CHAIN_PROVIDER_INVALID", "The chain provider returned invalid JSON.", "retry_chain_read", cause); }
      const parsed = responseObject(body);
      if (parsed.id !== id || parsed.jsonrpc !== "2.0") {
        throw ingestionError("CHAIN_PROVIDER_INVALID", "The chain provider returned a mismatched JSON-RPC response.", "retry_chain_read");
      }
      if (parsed.error !== undefined) {
        const message = typeof parsed.error.message === "string" ? parsed.error.message.slice(0, 160) : "RPC request failed";
        throw ingestionError("CHAIN_PROVIDER_ERROR", `The chain provider rejected the read: ${message}.`, "retry_chain_read", undefined, true);
      }
      return parsed.result as T;
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      throw ingestionError("CHAIN_PROVIDER_UNAVAILABLE", "The chain provider response could not be read.", "retry_chain_read", cause, true);
    } finally {
      clearTimeout(timer);
    }
  }

  async chainId(): Promise<number> {
    return quantityToNumber(await this.request({ method: "eth_chainId" }), "chain ID");
  }

  async latestBlock(): Promise<number> {
    return quantityToNumber(await this.request({ method: "eth_blockNumber" }), "block number");
  }

  async blockHash(blockNumber: number): Promise<string | null> {
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) {
      throw ingestionError("CHAIN_PROVIDER_INVALID", "The requested block number is invalid.", "fix_chain_read");
    }
    const block = await this.request<{ readonly hash?: unknown } | null>({
      method: "eth_getBlockByNumber",
      params: [`0x${blockNumber.toString(16)}`, false]
    });
    if (block === null || block.hash === null || block.hash === undefined) return null;
    return hash(block.hash, "block hash");
  }

  /**
   * Read a block selected by an explicit JSON-RPC block tag.  BSC's
   * `finalized` tag is consensus-backed; callers still receive the numeric
   * block/hash pair and can bind every subsequent read to that exact block.
   */
  async blockByNumberTag(blockTag: string, includeTransactions = false): Promise<RpcBlockReference | null> {
    assertBlockTag(blockTag);
    const block = await this.request<{
      readonly number?: unknown;
      readonly hash?: unknown;
      readonly parentHash?: unknown;
    } | null>({
      method: "eth_getBlockByNumber",
      params: [blockTag, includeTransactions]
    });
    if (block === null) return null;
    if (block.number === undefined || block.hash === undefined || block.parentHash === undefined) {
      throw ingestionError("CHAIN_PROVIDER_INVALID", "The RPC block-by-number response is incomplete.", "retry_chain_read");
    }
    return {
      number: quantityToNumber(block.number, "block number"),
      hash: hash(block.hash, "block hash"),
      parentHash: hash(block.parentHash, "parent block hash")
    };
  }

  /** Return the block selected by BSC's consensus `finalized` tag. */
  async finalizedBlock(): Promise<RpcBlockReference> {
    const block = await this.blockByNumberTag("finalized", false);
    if (block === null) {
      throw ingestionError("CHAIN_PROVIDER_UNAVAILABLE", "The chain provider returned no finalized block.", "retry_chain_read", undefined, true);
    }
    return block;
  }

  async blockByHash(blockHash: string): Promise<RpcBlockReference | null> {
    const normalizedHash = hash(blockHash, "requested block hash");
    const block = await this.request<{ readonly number?: unknown; readonly hash?: unknown; readonly parentHash?: unknown } | null>({
      method: "eth_getBlockByHash",
      params: [normalizedHash, false]
    });
    if (block === null) return null;
    if (block.number === undefined || block.hash === undefined || block.parentHash === undefined) throw ingestionError("CHAIN_PROVIDER_INVALID", "The RPC block-by-hash response is incomplete.", "retry_chain_read");
    return {
      number: quantityToNumber(block.number, "block number"),
      hash: hash(block.hash, "block hash"),
      parentHash: hash(block.parentHash, "parent block hash")
    };
  }

  async code(address: string, blockTag: string = "latest"): Promise<string> {
    if (!addressPattern.test(address)) throw ingestionError("CHAIN_PROVIDER_INVALID", "The contract address is invalid.", "fix_chain_configuration");
    if (blockTag !== "latest" && blockTag !== "finalized" && !quantityPattern.test(blockTag)) throw ingestionError("CHAIN_PROVIDER_INVALID", "The RPC block tag is invalid.", "fix_chain_read");
    return code(await this.request({ method: "eth_getCode", params: [address.toLowerCase(), blockTag] }), "bytecode");
  }

  async storageAt(address: string, slot: string, blockTag: string = "latest"): Promise<string> {
    if (!addressPattern.test(address) || !/^0x[0-9a-f]{64}$/iu.test(slot)) throw ingestionError("CHAIN_PROVIDER_INVALID", "The storage read address or slot is invalid.", "fix_chain_configuration");
    assertBlockTag(blockTag);
    return storageWord(await this.request({ method: "eth_getStorageAt", params: [address.toLowerCase(), slot.toLowerCase(), blockTag] }), "storage word");
  }

  async call(to: string, data: string, blockTag: string = "latest", from?: string): Promise<string> {
    if (!addressPattern.test(to) || !/^0x(?:[0-9a-f]{2})*$/iu.test(data)) throw ingestionError("CHAIN_PROVIDER_INVALID", "The eth_call target or calldata is invalid.", "fix_chain_read");
    assertBlockTag(blockTag);
    if (from !== undefined && !addressPattern.test(from)) throw ingestionError("CHAIN_PROVIDER_INVALID", "The eth_call from address is invalid.", "fix_chain_read");
    const request: Record<string, unknown> = { to: to.toLowerCase(), data: data.toLowerCase() };
    if (from !== undefined) request.from = from.toLowerCase();
    const result = await this.request<unknown>({ method: "eth_call", params: [request, blockTag] });
    return code(result, "eth_call result");
  }

  async logs(filter: Readonly<Record<string, unknown>>): Promise<readonly Readonly<Record<string, unknown>>[]> {
    if (typeof filter !== "object" || filter === null || Array.isArray(filter)) throw ingestionError("CHAIN_PROVIDER_INVALID", "The eth_getLogs filter is invalid.", "fix_chain_read");
    const address = filter.address;
    if (typeof address !== "string" || !addressPattern.test(address)) throw ingestionError("CHAIN_PROVIDER_INVALID", "The eth_getLogs address is invalid.", "fix_chain_configuration");
    const allowed = new Set(["address", "fromBlock", "toBlock", "topics", "blockHash"]);
    if (Object.keys(filter).some((key) => !allowed.has(key))) throw ingestionError("CHAIN_PROVIDER_INVALID", "The eth_getLogs filter contains an unsupported field.", "fix_chain_read");
    if (filter.fromBlock !== undefined) assertBlockTagValue(filter.fromBlock, "fromBlock");
    if (filter.toBlock !== undefined) assertBlockTagValue(filter.toBlock, "toBlock");
    if (filter.blockHash !== undefined && (typeof filter.blockHash !== "string" || !hashPattern.test(filter.blockHash))) throw ingestionError("CHAIN_PROVIDER_INVALID", "The eth_getLogs block hash is invalid.", "fix_chain_read");
    if (filter.topics !== undefined) assertTopics(filter.topics);
    const result = await this.request<unknown>({ method: "eth_getLogs", params: [filter] });
    if (!Array.isArray(result)) throw ingestionError("CHAIN_PROVIDER_INVALID", "The eth_getLogs result is invalid.", "retry_chain_read");
    if (result.some((entry) => typeof entry !== "object" || entry === null || Array.isArray(entry))) throw ingestionError("CHAIN_PROVIDER_INVALID", "The eth_getLogs result contains an invalid log.", "retry_chain_read");
    return result as readonly Readonly<Record<string, unknown>>[];
  }

  async proxyImplementation(address: string, blockTag: string = "latest"): Promise<string | null> {
    const word = await this.storageAt(address, implementationSlot, blockTag);
    const candidate = `0x${word.slice(-40)}`;
    return /^0x0{40}$/iu.test(candidate) ? null : candidate;
  }
}

function assertBlockTag(blockTag: string): void {
  if (blockTag !== "latest" && blockTag !== "finalized" && !quantityPattern.test(blockTag)) throw ingestionError("CHAIN_PROVIDER_INVALID", "The RPC block tag is invalid.", "fix_chain_read");
}

function assertBlockTagValue(value: unknown, field: string): void {
  if (typeof value !== "string") throw ingestionError("CHAIN_PROVIDER_INVALID", `The RPC ${field} tag is invalid.`, "fix_chain_read");
  assertBlockTag(value);
}

function assertTopics(value: unknown): void {
  if (!Array.isArray(value) || value.length > 4) throw ingestionError("CHAIN_PROVIDER_INVALID", "The eth_getLogs topics filter is invalid.", "fix_chain_read");
  for (const topic of value) {
    const values = Array.isArray(topic) ? topic : [topic];
    if (values.length > 128 || values.some((entry) => entry !== null && (typeof entry !== "string" || !/^0x[0-9a-f]{64}$/iu.test(entry)))) throw ingestionError("CHAIN_PROVIDER_INVALID", "The eth_getLogs topic value is invalid.", "fix_chain_read");
  }
}

export type RpcContractProbe = {
  readonly name: string;
  readonly address: string;
  readonly bytecodePresent: boolean;
  readonly bytecodeLength: number;
  readonly implementation: string | null;
};

export type RpcProbeReport = {
  readonly endpoint: string;
  readonly expectedChainId: number;
  readonly observedChainId: number;
  readonly latestBlock: number;
  readonly latestBlockHash: string | null;
  readonly contracts: readonly RpcContractProbe[];
};

/** Read-only readiness probe used by operations and release checks. */
export async function probeRpc(
  endpoint: string,
  expectedChainId: number,
  contracts: readonly { readonly name: string; readonly address: string }[],
  options: JsonRpcClientOptions = {}
): Promise<RpcProbeReport> {
  const client = new JsonRpcClient(endpoint, options);
  const observedChainId = await client.chainId();
  if (observedChainId !== expectedChainId) {
    throw ingestionError("CHAIN_NETWORK_MISMATCH", "The RPC endpoint is serving a different chain than configured.", "fix_chain_provider");
  }
  const latestBlock = await client.latestBlock();
  const latestBlockHash = await client.blockHash(latestBlock);
  const results: RpcContractProbe[] = [];
  for (const contract of contracts) {
    const address = contract.address.toLowerCase();
    if (!addressPattern.test(address)) throw ingestionError("CHAIN_PROVIDER_INVALID", `The configured ${contract.name} address is invalid.`, "fix_chain_configuration");
    const bytecode = await client.code(address);
    results.push({
      name: contract.name,
      address,
      bytecodePresent: bytecode !== "0x",
      bytecodeLength: Math.max(0, (bytecode.length - 2) / 2),
      implementation: bytecode === "0x" ? null : await client.proxyImplementation(address)
    });
  }
  return { endpoint: new URL(endpoint).toString(), expectedChainId, observedChainId, latestBlock, latestBlockHash, contracts: results };
}
