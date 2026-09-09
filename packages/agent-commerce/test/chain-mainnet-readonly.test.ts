import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BNB } from "@altananetwork/sdk";
import type { Address, Hex } from "viem";
import { Erc8183AltanaAdapter, ERC8183_EOA_MAINNET_CONTRACTS, assertSdkDeploymentMatchesPin, resolveErc8183DeploymentVerification, type Erc8183DeploymentReader } from "../src/index.js";

const a = ERC8183_EOA_MAINNET_CONTRACTS;
const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const PIN = { enabled: true, chainId: 56, specRevision: "apex-v1", commerceContract: a.commerceContract, paymentToken: a.paymentToken, paymentDecimals: 18,
  abiHash: "4d8ac8b406dff522f1b9066eb3e00e2c8e491d4d09df2564ede124220b623ede", evaluatorProfile: "verified-policy-v1", confirmationThreshold: 1,
  minExpiryLeadSeconds: 60, maxExpiryHorizonSeconds: 691_200, minBudgetAtomic: "1", maxBudgetAtomic: "10000000000000000" };

function fixture() {
  const lock = JSON.parse(readFileSync(new URL("../../../config/standards.lock.json", import.meta.url), "utf8"));
  const deployment = lock.networks["56"].erc8183;
  deployment.releaseEnabled = false;
  for (const key of Object.keys(deployment.runtimeSha256)) deployment.runtimeSha256[key] = EMPTY_SHA;
  const implementations: Record<string, string> = {
    [a.commerceContract.toLowerCase()]: deployment.commerceImplementation,
    [a.routerContract.toLowerCase()]: deployment.routerImplementation,
    [a.paymentToken.toLowerCase()]: deployment.paymentTokenImplementation
  };
  const reader: Erc8183DeploymentReader = {
    getChainId: async () => 56,
    getBytecode: async () => "0x",
    getStorageAt: async ({ address, slot }) => `0x${"0".repeat(24)}${(slot.startsWith("0xb531") ? deployment.paymentTokenProxyAdmin : implementations[address.toLowerCase()]!).slice(2)}` as Hex,
    readContract: async ({ functionName }) => {
      if (functionName === "paymentToken") return a.paymentToken;
      if (functionName === "decimals") return 18;
      if (functionName === "symbol") return "U";
      if (functionName === "name") return "United Stables";
      if (functionName === "commerce") return a.commerceContract;
      if (functionName === "router") return a.routerContract;
      if (functionName === "policyWhitelist") return true;
      if (functionName === "paused") return false;
      if (functionName === "frozen") return false;
      if (functionName === "balanceOf" || functionName === "allowance") return 1000n;
      if (functionName === "disputeWindow") return 604_800n;
      if (functionName === "platformFeeBP") return 0n;
      throw new Error(`Unexpected read: ${functionName}`);
    }
  };
  return { lock, deployment, reader };
}

function enable() { vi.stubEnv("EXTERNAL_ERC8183_MAINNET_ENABLED", "true"); }
function options() { const f = fixture(); return { pin: PIN, standardsLock: f.lock, deploymentReader: f.reader, externalMainnetBrowserEnabled: true, runtimeEnvironment: "preview" as const }; }
afterEach(() => vi.unstubAllEnvs());

describe("reviewed mainnet browser-only adapter", () => {
  it.each([[0, "pending"], [1, "approve"], [2, "reject"]] as const)("reads policy verdict %s without inferring it from time", async (value, expected) => {
    enable();
    const config = options();
    const readContract = vi.fn(async () => [value, `0x${"0".repeat(64)}`]);
    config.deploymentReader.readContract = readContract;
    const adapter = new Erc8183AltanaAdapter(config);
    await expect(adapter.readPolicyVerdict("56765")).resolves.toBe(expected);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ address: a.policyContract, functionName: "check", args: [56765n, "0x"] }));
  });

  it("does not turn unknown verdicts or RPC failures into approval", async () => {
    enable();
    const config = options();
    const readContract = vi.fn(async (): Promise<unknown> => [3, `0x${"0".repeat(64)}`]);
    config.deploymentReader.readContract = readContract;
    const adapter = new Erc8183AltanaAdapter(config);
    await expect(adapter.readPolicyVerdict("56765")).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH" });
    readContract.mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(adapter.readPolicyVerdict("56765")).rejects.toThrow();
  });

  it("requires every explicit gate and keeps the public Altana pin validator testnet-only", () => {
    vi.stubEnv("EXTERNAL_ERC8183_MAINNET_ENABLED", "false");
    expect(() => new Erc8183AltanaAdapter(options())).toThrow(/explicitly enabled/i);
    enable();
    expect(() => new Erc8183AltanaAdapter({ ...options(), externalMainnetBrowserEnabled: false })).toThrow(/explicitly enabled/i);
    for (const runtimeEnvironment of ["development", "test"] as const) expect(() => new Erc8183AltanaAdapter({ ...options(), runtimeEnvironment })).toThrow(/explicitly enabled/i);
    const closed = new Erc8183AltanaAdapter({ ...options(), runtimeEnvironment: "production" });
    expect(() => closed.assertBrowserNewHireReleased()).toThrow(/release gate/i);
    const production = options(); production.standardsLock.networks["56"].erc8183.releaseEnabled = true;
    expect(() => new Erc8183AltanaAdapter({ ...production, runtimeEnvironment: "production" })).not.toThrow();
    expect(() => assertSdkDeploymentMatchesPin(PIN)).toThrow(/97/);
    expect(() => new Erc8183AltanaAdapter({ ...options(), developmentCanaryEnabled: true })).toThrow(/97/);
  });

  it("verifies the disabled-release candidate read-only and revokes an existing instance when the gate closes", async () => {
    enable();
    const instance = new Erc8183AltanaAdapter(options());
    expect(instance.network).toBe(BNB);
    await expect(instance.verifyNetwork()).resolves.toMatchObject({ chainId: 56, sdkAddressesMatch: true });
    vi.stubEnv("EXTERNAL_ERC8183_MAINNET_ENABLED", "false");
    await expect(instance.verifyNetwork()).rejects.toMatchObject({ code: "COMMERCE_DISABLED" });
    await expect(instance.readJob("7")).rejects.toMatchObject({ code: "COMMERCE_DISABLED" });
  });

  it("cannot enable any server-side Altana writer even when the lock release flag is true", async () => {
    enable();
    const o = options();
    o.standardsLock.networks["56"].erc8183.releaseEnabled = true;
    const writer = vi.fn();
    const instance = new Erc8183AltanaAdapter({ ...o, sdk: { hire: writer, submit: writer, settle: writer, execute: writer } });
    await expect((instance as unknown as { ensureNetworkVerified(): Promise<void> }).ensureNetworkVerified()).rejects.toThrow(/permanently restricted to chain 97/i);
    await expect(instance.hire({} as never, { providerAddress: "0x4444444444444444444444444444444444444444", task: "task", budgetAtomic: "1000" })).rejects.toThrow(/chain 97/i);
    await expect(instance.submit({} as never)).rejects.toThrow(/chain 97/i);
    await expect(instance.settle({} as never, { jobId: "7" })).rejects.toThrow(/chain 97/i);
    await expect(instance.claimRefund({} as never, { jobId: "7" })).rejects.toThrow(/chain 97/i);
    expect(writer).not.toHaveBeenCalled();
  });

  it("requires the enabled checked-in lock and all token implementation pins", () => {
    enable();
    expect(() => new Erc8183AltanaAdapter({ pin: PIN, externalMainnetBrowserEnabled: true, runtimeEnvironment: "preview" })).toThrow(/candidate lock/i);
    for (const key of ["paymentTokenImplementation", "runtimeSha256"]) {
      const f = fixture();
      if (key === "runtimeSha256") delete f.deployment.runtimeSha256.paymentTokenImplementation;
      else delete f.deployment[key];
      expect(() => resolveErc8183DeploymentVerification(f.lock, 56)).toThrow(/payment token implementation/i);
    }
    expect(() => new Erc8183AltanaAdapter({ ...options(), pin: { ...PIN, maxBudgetAtomic: "500000000000000000" } })).not.toThrow();
  });

  it("checks live frozen participants, balance and exact finite funding allowance", async () => {
    enable(); const o = options();
    o.standardsLock.networks["56"].erc8183.releaseEnabled = true;
    const buyer = "0x4444444444444444444444444444444444444444";
    await expect(new Erc8183AltanaAdapter(o).verifyBrowserPaymentParticipants({ buyer, step: "fund", budgetAtomic: "1000" })).resolves.toBeUndefined();
    for (const [name, value] of [["frozen", true], ["balanceOf", 999n], ["allowance", (1n << 256n) - 1n]] as const) {
      const reader = { ...o.deploymentReader, readContract: async (input: Parameters<Erc8183DeploymentReader["readContract"]>[0]) => input.functionName === name ? value : o.deploymentReader.readContract(input) };
      await expect(new Erc8183AltanaAdapter({ ...o, deploymentReader: reader }).verifyBrowserPaymentParticipants({ buyer, step: "fund", budgetAtomic: "1000" })).rejects.toBeDefined();
    }
  });

  it("preserves reads and disputes while paused, and only token pause blocks eligible refunds", async () => {
    enable(); const o = options(); const buyer = "0x4444444444444444444444444444444444444444";
    const readContract = o.deploymentReader.readContract;
    const instance = new Erc8183AltanaAdapter({ ...o, deploymentReader: { ...o.deploymentReader, readContract: async input => input.functionName === "paused" ? input.address.toLowerCase() !== a.paymentToken.toLowerCase() : readContract(input) } });
    await expect(instance.verifyNetwork()).resolves.toBeDefined();
    expect(() => instance.assertBrowserNewHireReleased()).toThrow(/release gate/i);
    await expect(instance.verifyBrowserPaymentParticipants({ buyer, step: "fund", budgetAtomic: "1000" })).rejects.toMatchObject({ code: "COMMERCE_DISABLED" });
    await expect(instance.verifyBrowserPaymentParticipants({ buyer, step: "claim_refund" })).resolves.toBeUndefined();
    const frozen = new Erc8183AltanaAdapter({ ...o, deploymentReader: { ...o.deploymentReader, readContract: async input => ["paused", "frozen"].includes(input.functionName) ? true : readContract(input) } });
    await expect(frozen.verifyBrowserPaymentParticipants({ buyer, step: "dispute" })).resolves.toBeUndefined();
    await expect(frozen.verifyBrowserPaymentParticipants({ buyer, step: "claim_refund" })).rejects.toMatchObject({ code: "COMMERCE_DISABLED" });
  });

  it("fails closed on RPC, bytecode, proxy, linkage and dispute-window drift", async () => {
    enable();
    const mutations: Partial<Erc8183DeploymentReader>[] = [
      { getChainId: async () => 97 },
      { getBytecode: async () => "0x01" },
      { getStorageAt: async () => `0x${"0".repeat(64)}` as Hex },
      ...["commerce", "policyWhitelist", "disputeWindow"].map((bad) => ({ readContract: async (input: Parameters<Erc8183DeploymentReader["readContract"]>[0]) => input.functionName === bad ? (bad === "commerce" ? "0x4444444444444444444444444444444444444444" as Address : bad === "disputeWindow" ? 60n : false) : fixture().reader.readContract(input) }))
    ];
    for (const mutation of mutations) {
      const o = options();
      await expect(new Erc8183AltanaAdapter({ ...o, deploymentReader: { ...o.deploymentReader, ...mutation } }).verifyNetwork()).rejects.toBeDefined();
    }
    const o = options();
    const { getChainId: omitted, ...reader } = o.deploymentReader;
    void omitted;
    await expect(new Erc8183AltanaAdapter({ ...o, deploymentReader: reader }).verifyNetwork()).rejects.toMatchObject({ code: "INVALID_CHAIN" });
  });
});
