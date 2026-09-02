import { ingestionError } from "./errors.js";

const httpUrlPattern = /^https?:\/\/[^\s]+$/iu;
const quantityPattern = /^0x[0-9a-f]+$/iu;
const hashPattern = /^0x[0-9a-f]{64}$/iu;
const addressPattern = /^0x[0-9a-f]{40}$/iu;
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export type JsonRpcRequest = {
  readonly method: string;
  readonly params?: readonly unknown[];
};

export type JsonRpcClientOptions = {
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
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
  private nextId = 1;

  constructor(endpoint: string, options: JsonRpcClientOptions = {}) {
    this.endpoint = assertEndpoint(endpoint);
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 250 || this.timeoutMs > 120_000) {
      throw ingestionError("CHAIN_PROVIDER_INVALID", "The RPC timeout is invalid.", "fix_chain_provider");
    }
    this.headers = { "content-type": "application/json", ...(options.headers ?? {}) };
  }

  async request<T>(request: JsonRpcRequest): Promise<T> {
    const method = typeof request.method === "string" && /^[A-Za-z0-9_.-]{1,128}$/u.test(request.method)
      ? request.method
      : null;
    if (method === null) throw ingestionError("CHAIN_PROVIDER_INVALID", "The RPC method is invalid.", "fix_chain_provider");
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
      throw ingestionError("CHAIN_PROVIDER_UNAVAILABLE", "The chain provider could not be reached.", "retry_chain_read", cause, true);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw ingestionError("CHAIN_PROVIDER_UNAVAILABLE", "The chain provider returned an unsuccessful HTTP response.", "retry_chain_read", undefined, true);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw ingestionError("CHAIN_PROVIDER_INVALID", "The chain provider returned invalid JSON.", "retry_chain_read", cause);
    }
    const parsed = responseObject(body);
    if (parsed.id !== id || parsed.jsonrpc !== "2.0") {
      throw ingestionError("CHAIN_PROVIDER_INVALID", "The chain provider returned a mismatched JSON-RPC response.", "retry_chain_read");
    }
    if (parsed.error !== undefined) {
      const message = typeof parsed.error.message === "string" ? parsed.error.message.slice(0, 160) : "RPC request failed";
      throw ingestionError("CHAIN_PROVIDER_ERROR", `The chain provider rejected the read: ${message}.`, "retry_chain_read", undefined, true);
    }
    return parsed.result as T;
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

  async code(address: string, blockTag: string = "latest"): Promise<string> {
    if (!addressPattern.test(address)) throw ingestionError("CHAIN_PROVIDER_INVALID", "The contract address is invalid.", "fix_chain_configuration");
    if (blockTag !== "latest" && blockTag !== "finalized" && !quantityPattern.test(blockTag)) throw ingestionError("CHAIN_PROVIDER_INVALID", "The RPC block tag is invalid.", "fix_chain_read");
    return code(await this.request({ method: "eth_getCode", params: [address.toLowerCase(), blockTag] }), "bytecode");
  }

  async storageAt(address: string, slot: string, blockTag: string = "latest"): Promise<string> {
    if (!addressPattern.test(address) || !/^0x[0-9a-f]{64}$/iu.test(slot)) throw ingestionError("CHAIN_PROVIDER_INVALID", "The storage read address or slot is invalid.", "fix_chain_configuration");
    return storageWord(await this.request({ method: "eth_getStorageAt", params: [address.toLowerCase(), slot.toLowerCase(), blockTag] }), "storage word");
  }

  async proxyImplementation(address: string, blockTag: string = "latest"): Promise<string | null> {
    const word = await this.storageAt(address, implementationSlot, blockTag);
    const candidate = `0x${word.slice(-40)}`;
    return /^0x0{40}$/iu.test(candidate) ? null : candidate;
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
