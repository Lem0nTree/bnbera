import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresErc8183JobRepository, erc8183DeploymentPinDigest, erc8183JobRecordSchema } from "@bnbera/agent-commerce";
import { ExternalSellerLifecycle } from "./external-seller-lifecycle";
const rpc = vi.hoisted(() => ({ getBlock: vi.fn(), getTransaction: vi.fn() }));
vi.mock("viem", async original => ({ ...await original<typeof import("viem")>(), createPublicClient: () => rpc }));
const address = (char: string) => `0x${char.repeat(40)}`;
const hash = (char: string) => `0x${char.repeat(64)}` as `0x${string}`;
const buyer = { userId: "buyer", requesterAddress: address("1") };
const identity = { namespace: "eip155", chainId: 56, identityRegistry: address("2"), agentId: "7" };
const version = "00000000-0000-4000-8000-000000000007";
const quoteId = "00000000-0000-4000-8000-000000000008";
const pin = { enabled: true, chainId: 56, specRevision: "apex-v1", commerceContract: address("3"), paymentToken: address("4"), paymentDecimals: 18, abiHash: "a".repeat(64), evaluatorProfile: "verified-policy-v1", confirmationThreshold: 1, minExpiryLeadSeconds: 60, maxExpiryHorizonSeconds: 691200, minBudgetAtomic: "1", maxBudgetAtomic: "1000" } as const;
const offer = { providerAddress: address("5"), priceAtomic: "1000", signedDescription: "task", descriptionDigest: "b".repeat(64) };
const snapshot = { schemaVersion: "bnbera.erc8183-quote/v1", quoteId, agentIdentifier: "test", identity, agentVersionId: version, agentVersion: 1, providerAddress: offer.providerAddress, providerAddressSource: "erc8004_agent_wallet", service: { kind: "a2a", url: "https://seller.example/card", protocolVersion: "0.3.0", observedAt: "2026-09-09T00:00:00Z", probeObservedAt: "2026-09-09T00:00:00Z" }, chainId: 56, commerceContract: pin.commerceContract, paymentToken: pin.paymentToken, paymentDecimals: 18, tokenSymbol: "U", priceAtomic: "1000", task: "task", taskDigest: offer.descriptionDigest, issuedAt: "2026-09-09T00:00:00Z", expiresAt: "2026-09-09T01:00:00Z", status: "draft" };
function fixture(state: "completed" | "expired" | "rejected" = "completed") {
  const current = erc8183JobRecordSchema.parse({ jobKey: { chainId: 56, commerceContract: pin.commerceContract, jobId: "7" }, terms: { chainId: 56, commerceContract: pin.commerceContract, paymentToken: pin.paymentToken, paymentDecimals: 18, clientAddress: buyer.requesterAddress, providerAddress: offer.providerAddress, evaluatorAddress: address("6"), hookAddress: address("6"), budgetAtomic: "1000", descriptionDigest: offer.descriptionDigest, expiresAtUnix: 2000000000 }, deploymentPin: pin, deploymentPinDigest: erc8183DeploymentPinDigest(pin), state: "submitted", createdAtUnix: 1, updatedAtUnix: 2, deliverableDigest: "c".repeat(64), providerBinding: { identity, agentVersionId: version, agentVersion: 1 }, buyerApproval: null, fundingTransactionHash: hash("a"), submissionTransactionHash: hash("b"), completionTransactionHash: null, rejectionTransactionHash: null, refundTransactionHash: null, lastObservedBlock: "10", lastObservedBlockHash: hash("c"), lastObservedAtUnix: 2 });
  const transition = vi.spyOn(PostgresErc8183JobRepository.prototype, "transition").mockResolvedValue({ job: current, replayed: false });
  vi.spyOn(PostgresErc8183JobRepository.prototype, "get").mockResolvedValue(current);
  const query = vi.fn().mockResolvedValue({ rows: [{ submission_transaction_hash: hash("b"), submission_block_hash: hash("c") }] });
  const verifyReceiptForOperation = vi.fn().mockResolvedValue({ receipt: { blockNumber: 10n, blockHash: hash("c") } });
  const chain = { pin, verifyPublicTerminalReceipt: vi.fn().mockResolvedValue({ state, receipt: { blockNumber: 20n, blockHash: hash("d") }, job: { evaluator: address("6"), client: buyer.requesterAddress, chainDeliverable: hash("e") } }), verifyReceiptForOperation };
  const lifecycle = new ExternalSellerLifecycle({ pool: { query }, chain } as never);
  const assertQuote = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(lifecycle as unknown as { bound: () => Promise<unknown> }, "bound").mockResolvedValue({ quote: offer, row: { id: quoteId, quote: snapshot }, seller: { assertQuote } });
  return { lifecycle, transition, query, assertQuote, verifyReceiptForOperation };
}
beforeEach(() => {
  rpc.getBlock.mockImplementation(async ({ blockTag, blockNumber }) => blockTag ? { number: 30n, hash: hash("f") } : { number: blockNumber, hash: blockNumber === 10n ? hash("c") : hash("d") });
  rpc.getTransaction.mockResolvedValue({ blockHash: hash("d"), from: address("9") });
});
afterEach(() => vi.restoreAllMocks());
describe("finalized external terminal recovery", () => {
  it("records a distinct permissionless caller without creating buyer approval", async () => {
    const f = fixture();
    await expect(f.lifecycle.reconcileTerminal("7", buyer, hash("8"))).resolves.toEqual({ status: "completed", replayed: false });
    expect(f.assertQuote).toHaveBeenCalledWith(offer);
    expect(f.verifyReceiptForOperation).toHaveBeenCalledWith(expect.objectContaining({ expectation: { digest: hash("e") } }));
    expect(f.transition).toHaveBeenCalledWith(expect.objectContaining({ job: expect.objectContaining({ state: "completed", buyerApproval: null }), event: expect.objectContaining({ actorAddress: address("6"), payload: expect.objectContaining({ transactionSender: address("9"), buyerApprovalRecorded: false }) }) }));
    expect(f.query.mock.calls[0]?.[1]).toContain(hash("e"));
    expect(f.query.mock.calls[0]?.[1]).toContain(version);
  });
  it("rejects an unfinalized or orphaned terminal receipt", async () => {
    const f = fixture();
    rpc.getBlock.mockResolvedValue({ number: 19n, hash: hash("d") });
    await expect(f.lifecycle.reconcileTerminal("7", buyer, hash("8"))).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
    expect(f.transition).not.toHaveBeenCalled();
  });
  it("rejects a stored result whose exact digest or provider-version binding is missing", async () => {
    const f = fixture(); f.query.mockResolvedValue({ rows: [] });
    await expect(f.lifecycle.reconcileTerminal("7", buyer, hash("8"))).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH" });
    expect(f.transition).not.toHaveBeenCalled();
  });
  it("rejects a provider submission orphaned before settlement", async () => {
    const f = fixture();
    rpc.getBlock.mockImplementation(async ({ blockTag, blockNumber }) => blockTag ? { number: 30n } : { number: blockNumber, hash: blockNumber === 10n ? hash("f") : hash("d") });
    await expect(f.lifecycle.reconcileTerminal("7", buyer, hash("8"))).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH" });
    expect(f.transition).not.toHaveBeenCalled();
  });
  it.each(["expired", "rejected"] as const)("records a verified %s refund without requiring a delivered result", async state => {
    const f = fixture(state);
    await expect(f.lifecycle.reconcileTerminal("7", buyer, hash("8"))).resolves.toMatchObject({ status: state });
    expect(f.query).not.toHaveBeenCalled();
    expect(f.transition).toHaveBeenCalledWith(expect.objectContaining({ job: expect.objectContaining({ state, refundTransactionHash: hash("8"), buyerApproval: null }), event: expect.objectContaining({ actorAddress: buyer.requesterAddress }) }));
  });
});
