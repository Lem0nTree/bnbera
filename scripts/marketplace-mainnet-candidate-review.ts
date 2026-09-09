/** Read-only production-adapter acceptance of two discovered calculator leads.
 * Historical work is read, never requested. This does not enable publication. */
import {readFile, writeFile} from "node:fs/promises";
import {createPublicClient, http, parseAbi, decodeEventLog} from "viem";
import {canonicalSha256Hex} from "../packages/domain/src/index.ts";
import {ExternalErc8183SellerAdapter, externalSellerDeliverableUrl, externalSellerQuoteSchema, type ExternalSellerJobRead} from "../packages/agent-commerce/src/external-seller.ts";
import {ERC8183_COMMERCE_EVENTS_ABI} from "../packages/agent-commerce/src/chain.ts";
import {HttpServiceProbeTransport} from "../packages/agent-ingestion/src/probe.ts";
import {createExternalSellerTransport} from "../apps/web/src/lib/external-seller-transport.ts";
const dir = new URL("../.runtime/mainnet-supply-upgrade/", import.meta.url);
async function main() {
  if (process.env.MAINNET_CANDIDATE_REVIEW_ENABLED !== "true") return;
  const offers = JSON.parse(await readFile(new URL("adapter-audit.json", dir), "utf8"));
  const history = JSON.parse(await readFile(new URL("provider-result-audit-v2.json", dir), "utf8"));
  const identities = JSON.parse(await readFile(new URL("direct-identity-audit.json", dir), "utf8"));
  const lock = JSON.parse(await readFile(new URL("../config/standards.lock.json", import.meta.url), "utf8"));
  const pin = lock.networks["56"].erc8183;
  const client = createPublicClient({transport: http(process.env.BSC_MAINNET_RPC_URL, {timeout: 15000, retryCount: 1})});
  if (await client.getChainId() !== 56) throw new Error("CHAIN_MISMATCH");
  const registryAbi = parseAbi(["function ownerOf(uint256) view returns(address)", "function getAgentWallet(uint256) view returns(address)"]);
  const jobAbi = parseAbi(["function getJob(uint256) view returns((uint256 id,address client,address provider,address evaluator,string description,uint256 budget,uint256 expiredAt,uint8 status,address hook,uint256 submittedAt,bytes32 deliverable))"]);
  const results: Record<string, unknown>[] = [];
  for (const target of [{agentId: "303779", jobId: "56720", kind: "deterministic-grid-plan"}, {agentId: "341565", jobId: "56756", kind: "deterministic-loan-health"}]) {
    const row: Record<string, unknown> = {...target, hireable: false, checkedAt: new Date().toISOString()};
    try {
      const offer = offers.find((offer: {agentId: string; status: string}) => offer.agentId === target.agentId && offer.status === "VERIFIED_CAPPED_SIGNED_OFFER");
      if (!offer) throw new Error("CURRENT_PRODUCTION_QUOTE_MISSING");
      const binding = offer.binding;
      for (const [actual, expected] of [[binding.commerceContract, pin.commerceProxy], [binding.routerContract, pin.routerProxy], [binding.policyContract, pin.policy], [binding.paymentToken, pin.paymentToken], [binding.identity.identityRegistry, lock.networks["56"].erc8004.identityRegistry]]) {
        if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error("PIN_MISMATCH");
      }
      if (binding.maxPriceAtomic !== pin.riskLimits.maxBudgetAtomic) throw new Error("BUDGET_CAP_MISMATCH");
      const block = await client.getBlock({blockTag: "finalized"});
      const args = [BigInt(target.agentId)] as const;
      const [owner, agentWallet, job] = await Promise.all([
        client.readContract({address: binding.identity.identityRegistry, abi: registryAbi, functionName: "ownerOf", args, blockNumber: block.number}),
        client.readContract({address: binding.identity.identityRegistry, abi: registryAbi, functionName: "getAgentWallet", args, blockNumber: block.number}),
        client.readContract({address: binding.commerceContract, abi: jobAbi, functionName: "getJob", args: [BigInt(target.jobId)], blockNumber: block.number}),
      ]);
      const cardUrl = identities.results.find((identity: {agentId: string}) => identity.agentId === target.agentId)?.detail?.cards?.[0]?.url;
      const card = await new HttpServiceProbeTransport().probe({kind: "a2a", url: cardUrl, timeoutMs: 8000, maxResponseBytes: 65536});
      if (card.contractStatus !== "healthy" || !Array.isArray(card.safeCapabilityProbe?.invocationUrls) || !card.safeCapabilityProbe.invocationUrls.includes(binding.endpoint)) throw new Error("PUBLIC_CARD_BINDING_MISMATCH");
      if (agentWallet.toLowerCase() !== binding.providerAddress.toLowerCase() || job.provider.toLowerCase() !== agentWallet.toLowerCase()) throw new Error("PROVIDER_IDENTITY_MISMATCH");
      if (job.evaluator.toLowerCase() !== pin.routerProxy.toLowerCase() || job.hook.toLowerCase() !== pin.routerProxy.toLowerCase()) throw new Error("JOB_DEPLOYMENT_MISMATCH");
      const record = history.results.find((result: {jobId: string}) => result.jobId === target.jobId);
      const receipt = await client.getTransactionReceipt({hash: record.transactionHash});
      if (receipt.status !== "success" || receipt.blockNumber > block.number) throw new Error("SUBMISSION_NOT_FINALIZED");
      const events = receipt.logs.filter(log => log.address.toLowerCase() === binding.commerceContract.toLowerCase()).flatMap(log => {
        try {const event = decodeEventLog({abi: ERC8183_COMMERCE_EVENTS_ABI, data: log.data, topics: log.topics}); return event.eventName === "JobSubmitted" && event.args.jobId === job.id && event.args.provider.toLowerCase() === agentWallet.toLowerCase() && event.args.deliverable === job.deliverable ? [event] : [];} catch {return [];}
      });
      if (events.length !== 1) throw new Error("SUBMISSION_EVENT_MISMATCH");
      const pointer = externalSellerDeliverableUrl({policyContract: binding.policyContract, jobId: target.jobId, deliverable: job.deliverable, logs: receipt.logs});
      const signed = JSON.parse(job.description);
      // Every signed field below comes from the actual historical job. Current
      // endpoint/identity metadata only supplies the verified retrieval binding.
      const historicalQuote = externalSellerQuoteSchema.parse({...offer.quote, priceAtomic: job.budget.toString(), requestedTask: signed.task,
        deliverables: signed.terms.deliverables, qualityStandards: signed.terms.quality_standards, issuedAtUnix: signed.negotiated_at, expiresAtUnix: signed.quote_expires_at,
        negotiationHash: signed.negotiation_hash, providerSignature: signed.provider_sig, signedDescription: job.description, descriptionDigest: canonicalSha256Hex(job.description)});
      const state = (["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const)[job.status];
      if (!state) throw new Error("JOB_STATE_INVALID");
      const adapter = new ExternalErc8183SellerAdapter(binding, {transport: createExternalSellerTransport(), randomId: () => {throw new Error("READ_ONLY_REVIEW");}, readIdentity: async () => ({owner, agentWallet, finalizedBlock: block.number.toString()}), readJob: async (): Promise<ExternalSellerJobRead> => ({jobId: job.id.toString(), chainId: 56, commerceContract: binding.commerceContract, client: job.client, provider: job.provider, paymentToken: binding.paymentToken, budgetAtomic: job.budget.toString(), description: job.description, state, deliverable: job.deliverable})});
      await adapter.assertQuote(offer.quote);
      if (offer.quote.expiresAtUnix < Math.floor(Date.now() / 1000) + 30) throw new Error("CURRENT_QUOTE_EXPIRED");
      const result = await adapter.readResult({quote: historicalQuote, jobId: target.jobId, buyerAddress: job.client, deliverableUrl: pointer, submissionTransactionHash: receipt.transactionHash});
      const output = JSON.parse(result.manifest.response.content);
      row.status = "READ_ONLY_ADAPTER_ACCEPTANCE_VERIFIED";
      row.identity = binding.identity; row.providerAddress = agentWallet; row.owner = owner; row.finalizedBlock = block.number.toString();
      row.currentQuote = {priceAtomic: offer.quote.priceAtomic, paymentToken: binding.paymentToken, negotiationHash: offer.quote.negotiationHash, expiresAtUnix: offer.quote.expiresAtUnix};
      row.card = {url: cardUrl, endpoint: binding.endpoint, digest: card.safeCapabilityProbe?.agentCardDigest};
      row.historicalResult = {jobId: target.jobId, state, transactionHash: receipt.transactionHash, pointer, deliverable: result.deliverable, output};
      row.blockers = ["TEN_AGENT_SUPPLY_TARGET_UNMET", "SELLER_SPECIFIC_TASK_UI_AND_LISTING_INTEGRATION_PENDING", "MAINNET_APPLICATION_RELEASE_ACCEPTANCE_PENDING"];
    } catch (error) {row.status = "REJECTED"; row.reason = error instanceof Error && /^[A-Z_]+$/u.test(error.message) ? error.message : "PRODUCTION_BOUNDARY_REJECTED";}
    results.push(row);
    console.log(JSON.stringify({agentId: target.agentId, status: row.status, reason: row.reason}));
  }
  const output = {observedAt: new Date().toISOString(), results, releaseEnabled: pin.releaseEnabled, chainWrites: false, fundedNotifications: false};
  await writeFile(new URL(`candidate-review-${Date.now()}.json`, dir), JSON.stringify(output, null, 2), {mode: 0o600});
}
main().catch(() => {console.error("MAINNET_CANDIDATE_REVIEW_FAILED"); process.exitCode = 1;});
