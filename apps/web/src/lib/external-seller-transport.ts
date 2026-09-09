import { resolveSafePublicNetworkTarget } from "@bnbera/agent-ingestion";
import { CommerceError, assertPublicPayloadSafe, type ExternalSellerTransport } from "@bnbera/agent-commerce";

type Resolve = typeof resolveSafePublicNetworkTarget;
/** Untrusted public seller traffic: no cookies/authorization, redirects or
 * automatic retries. A POST timeout is an unknown outcome, not a retry signal. */
export function createExternalSellerTransport(deps: { fetch?: typeof fetch; resolve?: Resolve } = {}): ExternalSellerTransport {
  const resolve = deps.resolve ?? resolveSafePublicNetworkTarget;
  const fetcher = deps.fetch ?? fetch;
  async function send(endpoint: string, body?: unknown): Promise<{ body: unknown; text: string }> {
    const before = await resolve(endpoint);
    if (before.url.protocol !== "https:" || [...before.url.searchParams.keys()].some(key => /key|token|secret|auth|signature/iu.test(key))) throw new CommerceError({ code: "INVALID_QUOTE", message: "A credential-free public HTTPS seller endpoint is required." });
    const response = await fetcher(before.url, { method: body === undefined ? "GET" : "POST", redirect: "manual", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(12000),
      headers: { accept: "application/json", "accept-encoding": "identity", ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const after = await resolve(endpoint);
    if (JSON.stringify([...before.addresses].sort()) !== JSON.stringify([...after.addresses].sort())) { await response.body?.cancel(); throw new CommerceError({ code: "INVALID_QUOTE", message: "The seller network target changed during verification." }); }
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (!response.ok || contentType !== "application/json" || Number(response.headers.get("content-length") ?? 0) > 65536) { await response.body?.cancel(); throw new CommerceError({ code: "INVALID_QUOTE", message: "The seller did not return a bounded successful JSON response." }); }
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (!reader) throw new CommerceError({ code: "INVALID_QUOTE", message: "The seller returned an empty response." });
    try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 65536) throw new CommerceError({ code: "INVALID_QUOTE", message: "The seller response exceeds the configured limit." }); chunks.push(next.value); } }
    finally { await reader.cancel(); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); const parsed: unknown = JSON.parse(text);
    let nodes = 0;
    function bounded(value: unknown, depth: number): void {
      if (++nodes > 4096 || depth > 16) throw new CommerceError({ code: "INVALID_QUOTE", message: "The seller JSON structure exceeds the configured limit." });
      if (value && typeof value === "object") for (const child of Object.values(value)) bounded(child, depth + 1);
    }
    bounded(parsed, 0); assertPublicPayloadSafe(parsed);
    return { body: parsed, text };
  }
  return { request: async (endpoint, body) => (await send(endpoint, body)).body, get: endpoint => send(endpoint) };
}
