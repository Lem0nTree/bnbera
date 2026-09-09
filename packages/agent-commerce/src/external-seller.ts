import { z } from "zod";
import { getAddress, keccak256, toBytes, recoverMessageAddress, decodeEventLog, hexToString, parseAbiItem, type Hex } from "viem";
import { canonicalSha256Hex, erc8004IdentitySchema } from "@bnbera/domain";
import { CommerceError } from "./errors.js";
import { assertPublicPayloadSafe } from "./validation.js";
import { nonZeroAddressSchema, positiveDecimalUintSchema } from "./types.js";

const text = (max: number) => z.string().min(1).max(max);
const hash = z.string().regex(/^0x[0-9a-f]{64}$/iu);
const timestamp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const termsSchema = z.object({ deliverables: text(1200), quality_standards: text(1200), success_criteria: z.array(text(300)).max(8).optional(),
  evaluation_required: z.boolean().optional(), evaluator_type: text(64).optional(), price: positiveDecimalUintSchema, currency: nonZeroAddressSchema }).strict();
const negotiationSchema = z.object({
  request: z.object({ task_description: text(1600), terms: z.object({ deliverables: text(1200), quality_standards: text(1200),
    success_criteria: z.array(text(300)).max(8).optional(), evaluation_required: z.boolean().optional(), evaluator_type: text(64).optional() }).strict() }).strict(),
  request_hash: hash, response_hash: hash, negotiation_hash: hash, provider_sig: z.string().regex(/^0x[0-9a-f]{130}$/iu),
  chain_id: z.union([z.literal(56), z.literal(97)]), verifying_contract: nonZeroAddressSchema,
  // Some sellers repeat the actor outside the signed description. It cannot
  // replace signature/registry proof and must agree with the pinned provider.
  provider_address: nonZeroAddressSchema.optional(),
  response: z.object({ accepted: z.literal(true), terms: termsSchema, estimated_completion_seconds: timestamp.max(86400), quote_expires_at: timestamp, negotiated_at: timestamp }).strict()
}).strict();

export const externalSellerQuoteSchema = z.object({
  schemaVersion: z.literal("bnbera.external-erc8183-quote/v1"), identity: erc8004IdentitySchema,
  providerAddress: nonZeroAddressSchema, endpoint: z.string().url(), resultBaseUrl: z.string().url(),
  chainId: z.union([z.literal(56), z.literal(97)]), commerceContract: nonZeroAddressSchema,
  paymentToken: nonZeroAddressSchema, priceAtomic: positiveDecimalUintSchema,
  requestedTask: text(1600), deliverables: text(1200), qualityStandards: text(1200),
  issuedAtUnix: timestamp, expiresAtUnix: timestamp, estimatedCompletionSeconds: timestamp.max(86400),
  negotiationHash: hash, providerSignature: z.string().regex(/^0x[0-9a-f]{130}$/iu),
  signedDescription: text(4096), descriptionDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  finalizedIdentityBlock: z.string().regex(/^[0-9]+$/u)
}).strict();
export type ExternalSellerQuote = z.infer<typeof externalSellerQuoteSchema>;

export type ExternalSellerBinding = {
  identity: ExternalSellerQuote["identity"]; providerAddress: string; endpoint: string; resultBaseUrl: string;
  commerceContract: string; routerContract: string; policyContract: string; paymentToken: string; maxPriceAtomic: string;
};
export type ExternalSellerTask = { task: string; deliverables: string; qualityStandards: string };
export type ExternalSellerIdentityRead = { agentWallet: string; owner: string; finalizedBlock: string };
export type ExternalSellerJobRead = { jobId: string; chainId: number; commerceContract: string; client: string; provider: string;
  paymentToken: string; budgetAtomic: string; description: string; state: "OPEN" | "FUNDED" | "SUBMITTED" | "COMPLETED" | "REJECTED" | "EXPIRED";
  deliverable: string | null };
export interface ExternalSellerTransport {
  /** Implement with HTTPS, DNS/redirect checks, timeout and body bounds. */
  request(endpoint: string, body: unknown): Promise<unknown>;
  get(url: string): Promise<{ body: unknown; text: string }>;
}
export interface ExternalSellerDependencies {
  transport: ExternalSellerTransport;
  readIdentity(binding: ExternalSellerBinding): Promise<ExternalSellerIdentityRead>;
  readJob(jobId: string): Promise<ExternalSellerJobRead>;
  nowUnix?: () => number;
  randomId(): string;
}
function fail(message: string): never { throw new CommerceError({ code: "INVALID_QUOTE", message, nextAction: "refresh_seller_offer" }); }
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sanitize = (value: string) => value.replaceAll("[", "(").replaceAll("]", ")").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, "");
/** Official BNB SDK canonical JSON, including Python ensure_ascii parity. */
export function canonicalSellerJson(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : item && typeof item === "object"
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort((item as Record<string, unknown>)[key])])) : item;
  return JSON.stringify(sort(value)).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
function publicUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || [...url.searchParams.keys()].some(key => /key|token|secret|signature|auth/iu.test(key))) fail("The seller must publish a credential-free HTTPS endpoint.");
  return url.toString();
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function unwrapReply(value: unknown, id: string): Record<string, unknown> {
  const rpc = record(value);
  if (rpc.jsonrpc !== "2.0" || rpc.id !== id || rpc.error !== undefined) fail("The seller did not return a matching accepted A2A response.");
  const result = record(rpc.result);
  if (Array.isArray(result.parts)) {
    const data = result.parts.map(part => record(record(part).data)).filter(data => data.negotiation_hash !== undefined);
    if (data.length !== 1) fail("The seller returned no unique signed quote.");
    return data[0]!;
  }
  return result;
}

/** A narrow external seller adapter. No wallet, secret or transaction writer is
 * accepted. Signing, intent persistence and chain reconciliation remain in the
 * existing commerce composition. Card availability never implies execution. */
export class ExternalErc8183SellerAdapter {
  constructor(readonly binding: ExternalSellerBinding, private readonly deps: ExternalSellerDependencies) {
    erc8004IdentitySchema.parse(binding.identity);
    for (const address of [binding.providerAddress, binding.commerceContract, binding.routerContract, binding.policyContract, binding.paymentToken]) nonZeroAddressSchema.parse(address);
    positiveDecimalUintSchema.parse(binding.maxPriceAtomic);
    publicUrl(binding.endpoint); publicUrl(binding.resultBaseUrl);
    if (new URL(binding.endpoint).origin !== new URL(binding.resultBaseUrl).origin) fail("The seller result origin differs from its verified endpoint.");
  }
  private now(): number { return this.deps.nowUnix?.() ?? Math.floor(Date.now() / 1000); }

  async negotiate(task: ExternalSellerTask): Promise<ExternalSellerQuote> {
    text(1600).parse(task.task); text(1200).parse(task.deliverables); text(1200).parse(task.qualityStandards);
    const id = this.deps.randomId();
    const raw = await this.deps.transport.request(this.binding.endpoint, { jsonrpc: "2.0", id, method: "message/send", params: { message: {
      messageId: id, role: "user", parts: [{ kind: "data", data: { skill: "negotiate", task_description: task.task,
        terms: { deliverables: task.deliverables, quality_standards: task.qualityStandards } } }] } } });
    const quote = negotiationSchema.parse(unwrapReply(raw, id)); assertPublicPayloadSafe(quote);
    if (quote.provider_address && !same(quote.provider_address, this.binding.providerAddress)) fail("The seller response names a different provider wallet.");
    const response = quote.response; const terms = response.terms; const now = this.now();
    if (quote.request.task_description !== task.task || quote.request.terms.deliverables !== task.deliverables || quote.request.terms.quality_standards !== task.qualityStandards ||
      terms.deliverables !== task.deliverables || terms.quality_standards !== task.qualityStandards) fail("The seller changed the requested task or delivery requirements.");
    if (quote.chain_id !== this.binding.identity.chainId || !same(quote.verifying_contract, this.binding.commerceContract) || !same(terms.currency, this.binding.paymentToken)) fail("The seller quote names a different chain, commerce contract or payment token.");
    if (BigInt(terms.price) >= (1n << 256n) - 1n || (this.binding.identity.chainId === 97 && BigInt(terms.price) > BigInt(this.binding.maxPriceAtomic))) fail("The seller price must be an exact positive uint256 amount, never unlimited approval; testnet allowance limits remain separate.");
    if (response.negotiated_at > now + 5 || response.negotiated_at < now - 60 || response.quote_expires_at < now + 30 || response.quote_expires_at > response.negotiated_at + 900) fail("The seller quote is expired or has an unsupported lifetime.");
    const responseHashInput = { accepted: true, terms, estimated_completion_seconds: response.estimated_completion_seconds, quote_expires_at: response.quote_expires_at };
    if (keccak256(toBytes(canonicalSellerJson(quote.request))) !== quote.request_hash || keccak256(toBytes(canonicalSellerJson(responseHashInput))) !== quote.response_hash) fail("The signed quote request or response hash does not match its content.");
    const content = { version: 1, negotiated_at: response.negotiated_at, quote_expires_at: response.quote_expires_at,
      task: sanitize(task.task), terms: { deliverables: sanitize(terms.deliverables), quality_standards: sanitize(terms.quality_standards),
        ...(terms.success_criteria?.length ? { success_criteria: terms.success_criteria.map(sanitize) } : {}) },
      price: terms.price, currency: terms.currency, chain_id: quote.chain_id, verifying_contract: getAddress(quote.verifying_contract) };
    if (keccak256(toBytes(canonicalSellerJson(content))) !== quote.negotiation_hash) fail("The provider-signed description hash does not match the agreed quote.");
    const signer = await recoverMessageAddress({ message: quote.negotiation_hash, signature: quote.provider_sig as Hex });
    const identity = await this.deps.readIdentity(this.binding);
    if (!same(identity.agentWallet, this.binding.providerAddress) || !same(signer, identity.agentWallet)) fail("The quote signer no longer matches the finalized registry agent wallet.");
    const signedDescription = canonicalSellerJson({ ...content, negotiation_hash: quote.negotiation_hash, provider_sig: quote.provider_sig });
    if (new TextEncoder().encode(signedDescription).byteLength > 4096) fail("The signed task exceeds the contract description size bound.");
    return externalSellerQuoteSchema.parse({ schemaVersion: "bnbera.external-erc8183-quote/v1", identity: this.binding.identity,
      providerAddress: signer, endpoint: this.binding.endpoint, resultBaseUrl: this.binding.resultBaseUrl, chainId: quote.chain_id,
      commerceContract: quote.verifying_contract, paymentToken: terms.currency, priceAtomic: terms.price,
      requestedTask: task.task, deliverables: task.deliverables, qualityStandards: task.qualityStandards,
      issuedAtUnix: response.negotiated_at, expiresAtUnix: response.quote_expires_at, estimatedCompletionSeconds: response.estimated_completion_seconds,
      negotiationHash: quote.negotiation_hash, providerSignature: quote.provider_sig, signedDescription, descriptionDigest: canonicalSha256Hex(signedDescription), finalizedIdentityBlock: identity.finalizedBlock });
  }

  /** Re-read exact funded chain state before the explicit buyer delivery action.
   * A caller must durably claim this action once before invoking it; unknown
   * replies are reconciled through job/result reads, never blindly retried. */
  async notifyFunded(input: { quote: ExternalSellerQuote; jobId: string; buyerAddress: string }): Promise<{ status: "notified"; responseDigest: string }> {
    const quote = externalSellerQuoteSchema.parse(input.quote);
    await this.assertJob(quote, input.jobId, input.buyerAddress, ["FUNDED"]);
    const wireJobId = Number(input.jobId);
    if (!Number.isSafeInteger(wireJobId)) fail("The seller JSON protocol cannot represent this job ID exactly.");
    const id = this.deps.randomId();
    let response: Record<string, unknown>;
    try {
      response = record(await this.deps.transport.request(quote.endpoint, { jsonrpc: "2.0", id, method: "message/send", params: { message: {
        messageId: id, role: "user", parts: [{ kind: "data", data: { skill: "notify_funded", job_id: wireJobId } }] } } }));
    } catch (cause) {
      throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "The seller notification outcome is unknown. Check the saved job before retrying.", nextAction: "reconcile_job", cause });
    }
    const reply = record(response.result);
    const candidates = Array.isArray(reply.parts) ? reply.parts.map(part => record(record(part).data)).filter(data => data.status !== undefined || data.acknowledged !== undefined) : [reply];
    const candidate = candidates[0];
    const accepted = candidate && (candidate.status === "accepted" || candidate.acknowledged === true)
      && (candidate.status === undefined || candidate.status === "accepted")
      && (candidate.acknowledged === undefined || candidate.acknowledged === true);
    if (response.jsonrpc !== "2.0" || response.id !== id || response.error !== undefined || candidates.length !== 1 || !accepted || String(candidate!.job_id) !== input.jobId) throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "The seller has not acknowledged this funded job. Check the saved job and result before any retry.", nextAction: "reconcile_job" });
    assertPublicPayloadSafe(response);
    return { status: "notified", responseDigest: canonicalSha256Hex(response) };
  }

  async assertQuote(quote: ExternalSellerQuote): Promise<void> {
    externalSellerQuoteSchema.parse(quote);
    if (canonicalSha256Hex(quote.signedDescription) !== quote.descriptionDigest || quote.endpoint !== this.binding.endpoint || quote.resultBaseUrl !== this.binding.resultBaseUrl || !same(quote.providerAddress, this.binding.providerAddress) || quote.identity.agentId !== this.binding.identity.agentId || !same(quote.identity.identityRegistry, this.binding.identity.identityRegistry) || quote.identity.namespace !== this.binding.identity.namespace || quote.identity.chainId !== this.binding.identity.chainId || quote.chainId !== this.binding.identity.chainId || !same(quote.commerceContract, this.binding.commerceContract) || !same(quote.paymentToken, this.binding.paymentToken) || BigInt(quote.priceAtomic) >= (1n << 256n) - 1n || (quote.chainId === 97 && BigInt(quote.priceAtomic) > BigInt(this.binding.maxPriceAtomic))) fail("The saved quote no longer matches this seller binding.");
    const description = record(JSON.parse(quote.signedDescription));
    const { provider_sig: signature, negotiation_hash: negotiationHash, ...content } = description;
    if (signature !== quote.providerSignature || negotiationHash !== quote.negotiationHash || keccak256(toBytes(canonicalSellerJson(content))) !== quote.negotiationHash || !same(await recoverMessageAddress({ message: quote.negotiationHash, signature: quote.providerSignature as Hex }), quote.providerAddress) || content.price !== quote.priceAtomic || !same(String(content.currency), quote.paymentToken) || content.chain_id !== quote.chainId || !same(String(content.verifying_contract), quote.commerceContract) || content.task !== sanitize(quote.requestedTask) || record(content.terms).deliverables !== sanitize(quote.deliverables) || record(content.terms).quality_standards !== sanitize(quote.qualityStandards) || content.quote_expires_at !== quote.expiresAtUnix || content.negotiated_at !== quote.issuedAtUnix) fail("The saved signed description failed integrity verification.");
  }

  async assertJob(quote: ExternalSellerQuote, jobId: string, buyerAddress: string, allowedStates: ExternalSellerJobRead["state"][]): Promise<ExternalSellerJobRead> {
    await this.assertQuote(quote);
    if (!/^[1-9][0-9]*$/u.test(jobId) || BigInt(jobId) >= 1n << 256n) fail("A confirmed positive uint256 job ID is required.");
    nonZeroAddressSchema.parse(buyerAddress);
    const job = await this.deps.readJob(jobId);
    if (job.jobId !== jobId || job.chainId !== quote.chainId || !same(job.commerceContract, quote.commerceContract) || !same(job.client, buyerAddress) || !same(job.provider, quote.providerAddress) || !same(job.paymentToken, quote.paymentToken) || job.budgetAtomic !== quote.priceAtomic || job.description !== quote.signedDescription || !allowedStates.includes(job.state)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The confirmed job does not match the saved seller, buyer, terms or required state.", nextAction: "reconcile_job" });
    return job;
  }

  /** Read-only retrieval. A successful HTTP/A2A response is not proof of work:
   * only the exact canonical manifest committed by the bound onchain job is returned. */
  async readResult(input: { quote: ExternalSellerQuote; jobId: string; buyerAddress: string; deliverableUrl: string; submissionTransactionHash?: string }): Promise<{ manifest: ExternalSellerManifest; deliverable: string; observedAtUnix: number }> {
    const job = await this.assertJob(input.quote, input.jobId, input.buyerAddress, ["SUBMITTED", "COMPLETED", "REJECTED"]);
    if (!job.deliverable || !hash.safeParse(job.deliverable).success) fail("The provider has not committed a valid result digest onchain.");
    // This pointer must come from the verified policy event in the provider's
    // submission receipt. Seller cards do not promise a /job route.
    const reply = await this.deps.transport.get(publicUrl(input.deliverableUrl));
    const body = record(reply.body);
    const { success, ...rest } = body;
    if (success !== undefined && success !== true) fail("The seller has not published a successful result.");
    let document = success === undefined ? body : rest;
    // Some Studio response routes project the committed manifest while moving
    // its deployment fields out of the HTTP response. Restore only those
    // independently verified fields; the complete canonical hash below must
    // still equal the provider's on-chain commitment exactly.
    if (document.chain_id === undefined && document.contracts === undefined && document.deliverable_url === input.deliverableUrl && hash.safeParse(document.tx_hash).success) {
      const { tx_hash: transactionHash, deliverable_url: _pointer, ...projected } = document;
      void _pointer;
      if (input.submissionTransactionHash && !same(String(transactionHash), input.submissionTransactionHash)) fail("The response wrapper names a different submission receipt.");
      document = { ...projected, chain_id: input.quote.chainId, contracts: { commerce: this.binding.commerceContract, router: this.binding.routerContract, policy: this.binding.policyContract } };
    }
    const manifest = externalSellerManifestSchema.parse(document);
    assertPublicPayloadSafe(manifest);
    if (String(manifest.job_id) !== input.jobId || manifest.chain_id !== input.quote.chainId || !same(manifest.contracts.commerce, this.binding.commerceContract) || !same(manifest.contracts.router, this.binding.routerContract) || !same(manifest.contracts.policy, this.binding.policyContract) || keccak256(toBytes(canonicalSellerJson(manifest))) !== job.deliverable) fail("The retrieved result does not match the exact job, deployment or onchain deliverable digest.");
    return { manifest, deliverable: job.deliverable, observedAtUnix: this.now() };
  }
}

export const externalSellerManifestSchema = z.object({
  version: z.literal(1), job_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), chain_id: z.union([z.literal(56), z.literal(97)]),
  contracts: z.object({ commerce: nonZeroAddressSchema, router: nonZeroAddressSchema, policy: nonZeroAddressSchema }).strict(),
  response: z.object({ content: text(48000), content_type: text(128).optional() }).strict(),
  metadata: z.record(z.unknown())
}).strict();
export type ExternalSellerManifest = z.infer<typeof externalSellerManifestSchema>;

const initialisedEvent = parseAbiItem("event JobInitialised(uint256 indexed jobId,bytes32 deliverable,uint64 submittedAt,bytes optParams)");
/** Official APEX pointer: emitted by the pinned policy in the same receipt as
 * JobSubmitted. The transport separately checks public DNS and response bounds. */
export function externalSellerDeliverableUrl(input: { policyContract: string; jobId: string; deliverable: string; logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[] }): string {
  const matches = input.logs.filter(log => same(log.address, input.policyContract)).flatMap(log => {
    try { const event = decodeEventLog({ abi: [initialisedEvent], data: log.data, topics: log.topics as [Hex, ...Hex[]] }); return event.args.jobId.toString() === input.jobId && same(event.args.deliverable, input.deliverable) ? [event.args.optParams] : []; } catch { return []; }
  });
  if (matches.length !== 1 || matches[0]!.length > 16386) fail("The provider submission has no unique bounded result pointer from the pinned policy.");
  const pointer = record(JSON.parse(hexToString(matches[0]!)));
  if (typeof pointer.deliverable_url !== "string") fail("The provider submission has no published deliverable URL.");
  return publicUrl(pointer.deliverable_url);
}
