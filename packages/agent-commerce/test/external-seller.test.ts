import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress, keccak256, toBytes, parseAbiItem, encodeEventTopics, encodeAbiParameters, toHex } from "viem";
import { canonicalSha256Hex } from "@bnbera/domain";
import { ExternalErc8183SellerAdapter, canonicalSellerJson, externalSellerDeliverableUrl, type ExternalSellerBinding, type ExternalSellerJobRead } from "../src/external-seller.js";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const binding: ExternalSellerBinding = {
  identity: { namespace: "eip155", chainId: 56, identityRegistry: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432", agentId: "208760" },
  providerAddress: account.address, endpoint: "https://seller.example/a2a", resultBaseUrl: "https://seller.example",
  commerceContract: "0xEa4DAa3100A767e86FDed867729ae7446476EBA6", routerContract: "0x51895229E12F9876011789B04f8698af06cCD6DA",
  policyContract: "0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5", paymentToken: "0xcE24439F2D9C6a2289F741120FE202248B666666", maxPriceAtomic: "10000000000000000"
};
const task = { task: "Public read-only report", deliverables: "Timestamped findings", qualityStandards: "Public sources and limitations" };
const buyerAddress = `0x${"22".repeat(20)}`;
async function setup(patch: Record<string, unknown> = {}) {
  const request = { task_description: task.task, terms: { deliverables: task.deliverables, quality_standards: task.qualityStandards } };
  const response = { accepted: true, terms: { ...request.terms, price: "100000000000000", currency: binding.paymentToken }, estimated_completion_seconds: 30, quote_expires_at: 1200, negotiated_at: 1000 };
  const content = { version: 1, negotiated_at: 1000, quote_expires_at: 1200, task: task.task, terms: request.terms, price: response.terms.price,
    currency: binding.paymentToken, chain_id: 56, verifying_contract: getAddress(binding.commerceContract) };
  const negotiation_hash = keccak256(toBytes(canonicalSellerJson(content)));
  const { negotiated_at: _time, ...responseInput } = response;
  void _time;
  const envelope = { request, response, request_hash: keccak256(toBytes(canonicalSellerJson(request))), response_hash: keccak256(toBytes(canonicalSellerJson(responseInput))),
    negotiation_hash, provider_sig: await account.signMessage({ message: negotiation_hash }), chain_id: 56, verifying_contract: binding.commerceContract, ...patch };
  let job: ExternalSellerJobRead;
  let result: unknown;
  const transport = { request: vi.fn(async () => ({ jsonrpc: "2.0", id: "request-1", result: { parts: [{ kind: "data", data: envelope }] } })), get: vi.fn(async () => ({ body: result, text: JSON.stringify(result) })) };
  const readIdentity = vi.fn(async () => ({ agentWallet: account.address, owner: buyerAddress, finalizedBlock: "120856720" }));
  const adapter = new ExternalErc8183SellerAdapter(binding, { transport, readIdentity, readJob: async () => job, nowUnix: () => 1000, randomId: () => "request-1" });
  return { adapter, transport, readIdentity, setJob(value: ExternalSellerJobRead) { job = value; }, setResult(value: unknown) { result = value; } };
}
describe("external ERC-8183 seller boundary", () => {
  it("matches Python ensure_ascii canonical JSON including surrogate pairs", () => {
    expect(canonicalSellerJson({ z: "😀", a: "é" })).toBe('{"a":"\\u00e9","z":"\\ud83d\\ude00"}');
  });
  it("verifies signed terms against finalized registry agent wallet without a transaction writer", async () => {
    const fixture = await setup(); const quote = await fixture.adapter.negotiate(task);
    expect(quote.providerAddress).toBe(account.address);
    expect(quote.descriptionDigest).toBe(canonicalSha256Hex(quote.signedDescription));
    expect(fixture.readIdentity).toHaveBeenCalledOnce();
    expect(fixture.transport.request).toHaveBeenCalledOnce();
  });
  it("accepts a redundant provider field only when it agrees with the signed registered actor", async () => {
    const matching = await setup({provider_address: account.address});
    await expect(matching.adapter.negotiate(task)).resolves.toMatchObject({providerAddress: account.address});
    const conflicting = await setup({provider_address: buyerAddress});
    await expect(conflicting.adapter.negotiate(task)).rejects.toThrow(/different provider wallet/u);
    const unsignedExtension = await setup({provider_address: account.address, alternate_provider: buyerAddress});
    await expect(unsignedExtension.adapter.negotiate(task)).rejects.toThrow();
  });
  it.each([{ chain_id: 97 }, { request_hash: `0x${"00".repeat(32)}` }, { negotiation_hash: `0x${"00".repeat(32)}` }, { verifying_contract: buyerAddress }])("rejects changed signed binding %j", async patch => {
    const fixture = await setup(patch); await expect(fixture.adapter.negotiate(task)).rejects.toThrow();
  });
  it("rejects a valid signature from a wallet that is no longer registered", async () => {
    const fixture = await setup(); fixture.readIdentity.mockResolvedValue({ agentWallet: buyerAddress, owner: buyerAddress, finalizedBlock: "120856721" });
    await expect(fixture.adapter.negotiate(task)).rejects.toThrow(/registry agent wallet/u);
  });
  it("requires exact funded chain state before notifying, and treats transport failure as unknown", async () => {
    const fixture = await setup(); const quote = await fixture.adapter.negotiate(task);
    const job: ExternalSellerJobRead = { jobId: "123", chainId: 56, commerceContract: binding.commerceContract, client: buyerAddress, provider: account.address,
      paymentToken: binding.paymentToken, budgetAtomic: quote.priceAtomic, description: quote.signedDescription, state: "OPEN", deliverable: null };
    fixture.setJob(job);
    await expect(fixture.adapter.notifyFunded({ quote, jobId: "123", buyerAddress })).rejects.toThrow(/confirmed job/u);
    expect(fixture.transport.request).toHaveBeenCalledOnce();
    fixture.setJob({ ...job, state: "FUNDED" }); fixture.transport.request.mockRejectedValue(new Error("timeout"));
    await expect(fixture.adapter.notifyFunded({ quote, jobId: "123", buyerAddress })).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
  });
  it.each([{status:"rejected",job_id:123},{status:"accepted",job_id:124},{acknowledged:false,job_id:123},{acknowledged:true,job_id:124},{acknowledged:true,status:"rejected",job_id:123},{acknowledged:false,status:"accepted",job_id:123},{}])("does not call a generic or rejected response delivery acknowledgement: %j", async reply => {
    const fixture = await setup(); const quote = await fixture.adapter.negotiate(task);
    fixture.setJob({jobId:"123",chainId:56,commerceContract:binding.commerceContract,client:buyerAddress,provider:account.address,paymentToken:binding.paymentToken,budgetAtomic:quote.priceAtomic,description:quote.signedDescription,state:"FUNDED",deliverable:null});
    fixture.transport.request.mockResolvedValue({jsonrpc:"2.0",id:"request-1",result:{parts:[{kind:"data",data:reply}]}} as never);
    await expect(fixture.adapter.notifyFunded({quote,jobId:"123",buyerAddress})).rejects.toMatchObject({code:"RECONCILIATION_REQUIRED"});
  });
  it.each([{status:"accepted",job_id:123},{acknowledged:true,already_submitted:false,job_id:123}])("accepts acknowledgement only for the exact funded job: %j", async reply => {
    const fixture = await setup(); const quote = await fixture.adapter.negotiate(task);
    fixture.setJob({jobId:"123",chainId:56,commerceContract:binding.commerceContract,client:buyerAddress,provider:account.address,paymentToken:binding.paymentToken,budgetAtomic:quote.priceAtomic,description:quote.signedDescription,state:"FUNDED",deliverable:null});
    fixture.transport.request.mockResolvedValue({jsonrpc:"2.0",id:"request-1",result:{parts:[{kind:"data",data:reply}]}} as never);
    await expect(fixture.adapter.notifyFunded({quote,jobId:"123",buyerAddress})).resolves.toMatchObject({status:"notified"});
    expect(fixture.transport.request).toHaveBeenLastCalledWith(binding.endpoint, expect.objectContaining({params:{message:{messageId:"request-1",role:"user",parts:[{kind:"data",data:{skill:"notify_funded",job_id:123}}]}}}));
  });
  it("never rounds a uint256 job ID into a different seller job", async () => {
    const fixture = await setup(); const quote = await fixture.adapter.negotiate(task);
    const jobId = "9007199254740993";
    fixture.setJob({jobId,chainId:56,commerceContract:binding.commerceContract,client:buyerAddress,provider:account.address,paymentToken:binding.paymentToken,budgetAtomic:quote.priceAtomic,description:quote.signedDescription,state:"FUNDED",deliverable:null});
    await expect(fixture.adapter.notifyFunded({quote,jobId,buyerAddress})).rejects.toThrow(/represent this job ID exactly/u);
    expect(fixture.transport.request).toHaveBeenCalledOnce();
  });
  it("returns only a manifest matching the exact job and committed digest", async () => {
    const fixture = await setup(); const quote = await fixture.adapter.negotiate(task);
    const manifest = { version: 1, job_id: 123, chain_id: 56, contracts: { commerce: binding.commerceContract, router: binding.routerContract, policy: binding.policyContract }, response: { content: "Public report", content_type: "text/plain" }, metadata: { observedAt: "2026-09-09" } };
    const deliverable = keccak256(toBytes(canonicalSellerJson(manifest)));
    fixture.setJob({ jobId: "123", chainId: 56, commerceContract: binding.commerceContract, client: buyerAddress, provider: account.address, paymentToken: binding.paymentToken, budgetAtomic: quote.priceAtomic, description: quote.signedDescription, state: "SUBMITTED", deliverable });
    fixture.setResult({ success: true, ...manifest });
    const deliverableUrl = "https://storage.example/manifests/report.json";
    expect((await fixture.adapter.readResult({ quote, jobId: "123", buyerAddress, deliverableUrl })).manifest).toEqual(manifest);
    expect(fixture.transport.get).toHaveBeenCalledWith(deliverableUrl);
    const submissionTransactionHash = `0x${"98".repeat(32)}`;
    fixture.setResult({version:manifest.version,job_id:manifest.job_id,response:manifest.response,metadata:manifest.metadata,tx_hash:submissionTransactionHash,deliverable_url:deliverableUrl});
    expect((await fixture.adapter.readResult({quote,jobId:"123",buyerAddress,deliverableUrl,submissionTransactionHash})).manifest).toEqual(manifest);
    await expect(fixture.adapter.readResult({quote,jobId:"123",buyerAddress,deliverableUrl,submissionTransactionHash:`0x${"99".repeat(32)}`})).rejects.toThrow(/different submission receipt/u);
    fixture.setResult({ success: true, ...manifest, response: { content: "Changed report" } });
    await expect(fixture.adapter.readResult({ quote, jobId: "123", buyerAddress, deliverableUrl })).rejects.toThrow(/onchain deliverable digest/u);
    await expect(fixture.adapter.readResult({ quote: { ...quote, priceAtomic: "1" }, jobId: "123", buyerAddress, deliverableUrl })).rejects.toThrow(/integrity/u);
  });
  it("uses only the exact policy event pointer and rejects a mismatched or duplicate event", () => {
    const event = parseAbiItem("event JobInitialised(uint256 indexed jobId,bytes32 deliverable,uint64 submittedAt,bytes optParams)");
    const deliverable = `0x${"12".repeat(32)}` as const;
    const log = { address: binding.policyContract, topics: encodeEventTopics({abi:[event],eventName:"JobInitialised",args:{jobId:123n}}), data: encodeAbiParameters([{type:"bytes32"},{type:"uint64"},{type:"bytes"}], [deliverable,1000n,toHex(JSON.stringify({deliverable_url:"https://storage.example/result.json"}))]) };
    expect(externalSellerDeliverableUrl({policyContract:binding.policyContract,jobId:"123",deliverable,logs:[log]})).toBe("https://storage.example/result.json");
    expect(()=>externalSellerDeliverableUrl({policyContract:binding.policyContract,jobId:"124",deliverable,logs:[log]})).toThrow(/no unique/u);
    expect(()=>externalSellerDeliverableUrl({policyContract:binding.policyContract,jobId:"123",deliverable,logs:[log,log]})).toThrow(/no unique/u);
    expect(()=>externalSellerDeliverableUrl({policyContract:buyerAddress,jobId:"123",deliverable,logs:[log]})).toThrow(/no unique/u);
  });
});
