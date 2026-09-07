import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Abi,
  type Address,
  type Hex
} from "viem";
import {
  agentWalletTypedData,
  parseRegisteredReceipt,
  parseRegistrationArgs,
  planRegistration,
  reconcileRegistration,
  registrationConfigFromEnvironment,
  runRegistrationWrite,
  type RegistrationActor,
  type RegistrationChain,
  type RegistrationConfig,
  type RegistrationLog,
  type RegistrationReceipt,
  type RegistrationWriteInput
} from "./t5-reference-registration.ts";

const REGISTRY = "0x8004a818bfb912233c491871b3d84c89a494bd9e" as Address;
const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const PROVIDER = "0x2222222222222222222222222222222222222222" as Address;
const OTHER = "0x3333333333333333333333333333333333333333" as Address;
const URI = "https://example.test/api/reference-provider/agent-card";
const TX_REGISTER = `0x${"11".repeat(32)}` as Hex;
const TX_WALLET = `0x${"22".repeat(32)}` as Hex;
const BLOCK_HASH = `0x${"aa".repeat(32)}` as Hex;

const registeredAbi = [{
  type: "event",
  name: "Registered",
  anonymous: false,
  inputs: [
    { indexed: true, name: "agentId", type: "uint256" },
    { indexed: false, name: "agentURI", type: "string" },
    { indexed: true, name: "owner", type: "address" }
  ]
}] as const satisfies Abi;

function registeredLog(agentId: bigint, owner: Address, uri: string, address = REGISTRY): RegistrationLog {
  const topics = encodeEventTopics({
    abi: registeredAbi,
    eventName: "Registered",
    args: { agentId, owner }
  }) as readonly Hex[];
  const data = encodeAbiParameters([{ type: "string" }], [uri]);
  return { address, topics, data };
}

function receipt(txHash: Hex, logs: readonly RegistrationLog[] = [registeredLog(7n, OWNER, URI)]): RegistrationReceipt {
  return {
    status: "success",
    transactionHash: txHash,
    blockNumber: 123n,
    blockHash: BLOCK_HASH,
    logs
  };
}

function actor(address: Address, onSign?: (value: Parameters<NonNullable<RegistrationActor["signer"]["signTypedData"]>>[0]) => void): RegistrationActor {
  return {
    address,
    signer: {
      address,
      signTypedData: async (value) => {
        onSign?.(value);
        return `0x${"44".repeat(65)}` as Hex;
      }
    }
  };
}

function config(overrides: Partial<RegistrationConfig> = {}): RegistrationConfig {
  return {
    chainId: 97,
    identityRegistry: REGISTRY,
    identityAbiSha256: "6d5974b564d266507a53f65951adcd0ab288904d5a716a354ea237176ece8f83",
    rpcUrl: "https://bsc-testnet.example",
    agentUri: URI,
    existingAgentId: null,
    ownerAddress: OWNER,
    providerAddress: PROVIDER,
    reconcileTxHash: null,
    ...overrides
  };
}

function mockChain(input: {
  readonly chainId?: number;
  readonly owner?: Address;
  readonly uri?: string;
  readonly wallet?: Address;
  readonly registerReceipt?: RegistrationReceipt | null;
  readonly receiptByHash?: RegistrationReceipt | null;
  readonly onSend?: (request: RegistrationWriteInput) => void;
} = {}): RegistrationChain {
  let currentOwner = input.owner ?? OWNER;
  let currentUri = input.uri ?? URI;
  let currentWallet = input.wallet ?? OWNER;
  let sendIndex = 0;
  const sent: RegistrationWriteInput[] = [];
  const registerReceipt = input.registerReceipt === undefined ? receipt(TX_REGISTER) : input.registerReceipt;
  const receiptByHash = input.receiptByHash;
  return {
    getChainId: async () => input.chainId ?? 97,
    ownerOf: async () => currentOwner,
    tokenURI: async () => currentUri,
    getAgentWallet: async () => currentWallet,
    estimateGas: async () => 100_000n,
    gasPrice: async () => 1_000_000_000n,
    send: async (request) => {
      sent.push(request);
      input.onSend?.(request);
      sendIndex += 1;
      if (request.functionName === "register") {
        currentOwner = OWNER;
        currentUri = String(request.args[0]);
        return TX_REGISTER;
      }
      if (request.functionName === "setAgentURI") {
        currentUri = String(request.args[1]);
        return TX_WALLET;
      }
      currentWallet = String(request.args[1]).toLowerCase() as Address;
      return sendIndex === 1 ? TX_REGISTER : TX_WALLET;
    },
    waitForReceipt: async (hash) => {
      if (hash === TX_REGISTER) return registerReceipt;
      if (receiptByHash !== undefined) return receiptByHash;
      return receipt(TX_WALLET, []);
    },
    getReceipt: async () => receiptByHash ?? null
  };
}

describe("T5 reference registration harness", () => {
  it("defaults to a read-only plan and exposes no key material", () => {
    const flags = parseRegistrationArgs([]);
    expect(flags).toMatchObject({ mode: "plan", chainId: 97, broadcast: false });
    const report = planRegistration(config(), {});
    expect(report.status).toBe("planned");
    expect(report.writesBroadcast).toBe(false);
    expect(JSON.stringify(report)).not.toMatch(/private|secret|0x[0-9a-f]{64}/iu);
  });

  it("requires both write and broadcast flags", () => {
    expect(() => parseRegistrationArgs(["--plan", "--write"])).toThrow("REGISTRATION_MODE_CONFLICT");
    expect(() => parseRegistrationArgs(["--write"])).toThrow("EXPLICIT_BROADCAST_REQUIRED");
    expect(() => parseRegistrationArgs(["--broadcast"])).toThrow("BROADCAST_REQUIRES_WRITE");
    expect(parseRegistrationArgs(["--network=97", "--write", "--broadcast"]).mode).toBe("write");
    expect(() => parseRegistrationArgs(["--network=56"])).toThrow("EXPLICIT_CHAIN_97_REQUIRED");
  });

  it("reads the exact standards-locked registry and rejects malformed URI config", () => {
    const env = {
      APP_URL: "https://reference.example",
      BSC_TESTNET_RPC_URL: "https://rpc.example"
    };
    const loaded = registrationConfigFromEnvironment(env, { agentId: null, reconcileTxHash: null });
    expect(loaded.identityRegistry).toBe(REGISTRY);
    expect(loaded.agentUri).toBe("https://reference.example/api/reference-provider/agent-card");
    expect(() => registrationConfigFromEnvironment({ APP_URL: "https://bad.example/#credentials" }, { agentId: null, reconcileTxHash: null })).toThrow("AGENT_URI_INVALID");
  });

  it("rejects a wrong network and a wrong locked registry before writing", async () => {
    await expect(runRegistrationWrite({
      chain: mockChain({ chainId: 56 }),
      config: config(),
      actors: { owner: actor(OWNER), provider: actor(PROVIDER) }
    })).rejects.toThrow("CHAIN_NETWORK_MISMATCH");
    await expect(runRegistrationWrite({
      chain: mockChain(),
      config: config({ identityRegistry: OTHER }),
      actors: { owner: actor(OWNER), provider: actor(PROVIDER) }
    })).rejects.toThrow("IDENTITY_REGISTRY_NOT_LOCKED");
  });

  it("requires on-chain ownership for an explicit existing agent", async () => {
    await expect(runRegistrationWrite({
      chain: mockChain({ owner: OTHER }),
      config: config({ existingAgentId: "7" }),
      actors: { owner: actor(OWNER), provider: actor(PROVIDER) }
    })).rejects.toThrow("EXISTING_AGENT_OWNER_MISMATCH");
  });

  it("is idempotent for an already configured identity and updates only changed fields", async () => {
    const unchanged = await runRegistrationWrite({
      chain: mockChain({ wallet: PROVIDER }),
      config: config({ existingAgentId: "7" }),
      actors: { owner: actor(OWNER), provider: actor(PROVIDER) }
    });
    expect(unchanged.status).toBe("already_configured");
    expect(unchanged.txHashes).toEqual([]);

    let signatureInput: Parameters<NonNullable<RegistrationActor["signer"]["signTypedData"]>>[0] | undefined;
    const updated = await runRegistrationWrite({
      chain: mockChain({ uri: "https://old.example/card", wallet: OWNER }),
      config: config({ existingAgentId: "7" }),
      actors: { owner: actor(OWNER), provider: actor(PROVIDER, (value) => { signatureInput = value; }) }
    });
    expect(updated.status).toBe("updated");
    expect(updated.txHashes).toHaveLength(2);
    expect(signatureInput?.identityRegistry).toBe(REGISTRY);
    expect(signatureInput?.newWallet).toBe(PROVIDER);
    expect(signatureInput?.owner).toBe(OWNER);
  });

  it("parses exactly one Registered event and returns sanitized receipt evidence", () => {
    const parsed = parseRegisteredReceipt({
      receipt: receipt(TX_REGISTER),
      identityRegistry: REGISTRY,
      expectedOwner: OWNER,
      expectedUri: URI,
      abi: registeredAbi
    });
    expect(parsed).toMatchObject({ agentId: "7", transactionHash: TX_REGISTER, blockNumber: 123 });
    expect(() => parseRegisteredReceipt({
      receipt: receipt(TX_REGISTER, [registeredLog(7n, OWNER, URI, OTHER)]),
      identityRegistry: REGISTRY,
      expectedOwner: OWNER,
      expectedUri: URI,
      abi: registeredAbi
    })).toThrow("REGISTERED_EVENT_MISSING");
  });

  it("stops after an unknown registration outcome and reconciles without rebroadcast", async () => {
    const sent: RegistrationWriteInput[] = [];
    const unknown = await mockChain({ registerReceipt: null, onSend: (request) => sent.push(request) });
    await expect(runRegistrationWrite({
      chain: unknown,
      config: config(),
      actors: { owner: actor(OWNER), provider: actor(PROVIDER) }
    })).rejects.toMatchObject({ code: "REGISTER_TX_OUTCOME_UNKNOWN", transactionHash: TX_REGISTER });
    expect(sent).toHaveLength(1);

    const reconciled = await reconcileRegistration({
      chain: mockChain({ receiptByHash: receipt(TX_REGISTER) }),
      config: config(),
      transactionHash: TX_REGISTER
    });
    expect(reconciled.status).toBe("reconciled");
    expect(reconciled.agentId).toBe("7");
    expect(reconciled.diagnostics).toContain("REGISTRATION_RECONCILED_NO_REBROADCAST");
  });

  it("builds the provider wallet proof for chain 97 and the locked registry", () => {
    const data = agentWalletTypedData(REGISTRY, { agentId: 7n, newWallet: PROVIDER, owner: OWNER, deadline: 1_700_000_000n });
    expect(data.domain).toEqual({ name: "ERC8004IdentityRegistry", version: "1", chainId: 97, verifyingContract: REGISTRY });
    expect(data.primaryType).toBe("AgentWalletSet");
    expect(data.types.AgentWalletSet.map((field) => `${field.name}:${field.type}`)).toEqual([
      "agentId:uint256", "newWallet:address", "owner:address", "deadline:uint256"
    ]);
  });
});
