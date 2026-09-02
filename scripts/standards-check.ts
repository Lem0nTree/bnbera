import { readFile } from "node:fs/promises";
import { JsonRpcClient, probeRpc, type RpcProbeReport } from "../packages/agent-ingestion/src/rpc.ts";

type Erc8004Lock = {
  readonly identityRegistry?: unknown;
  readonly reputationRegistry?: unknown;
  readonly verificationStatus?: unknown;
};

type NetworkLock = {
  readonly name?: unknown;
  readonly environment?: unknown;
  readonly erc8004?: Erc8004Lock;
  readonly erc8183?: { readonly verificationStatus?: unknown };
  readonly b402?: { readonly enabled?: unknown; readonly verificationStatus?: unknown };
};

type StandardsLock = {
  readonly networks?: Record<string, NetworkLock>;
  readonly greenfield?: { readonly verificationStatus?: unknown };
  readonly altana?: {
    readonly mainnet?: { readonly verificationStatus?: unknown };
    readonly testnet?: { readonly verificationStatus?: unknown };
  };
  readonly releaseGates?: Record<string, unknown>;
};

const addressPattern = /^0x[0-9a-f]{40}$/iu;

function requiredEndpoint(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for the standards readiness check.`);
  }
  return value;
}

function requiredAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || !addressPattern.test(value)) {
    throw new Error(`${field} is not a configured EVM address.`);
  }
  return value.toLowerCase();
}

function endpointLabel(endpoint: string): string {
  const parsed = new URL(endpoint);
  return `${parsed.protocol}//${parsed.host}`;
}

function status(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function verifyNetwork(
  networkId: "56" | "97",
  endpoint: string,
  network: NetworkLock
): Promise<{
  readonly networkId: number;
  readonly name: string | null;
  readonly environment: string | null;
  readonly endpoint: string;
  readonly report: RpcProbeReport;
  readonly implementationCode: readonly { readonly name: string; readonly address: string; readonly bytecodePresent: boolean }[];
}> {
  const erc8004 = network.erc8004;
  if (erc8004 === undefined) throw new Error(`Network ${networkId} has no ERC-8004 configuration.`);
  const contracts = [
    { name: "erc8004-identity", address: requiredAddress(erc8004.identityRegistry, `${networkId}.erc8004.identityRegistry`) },
    { name: "erc8004-reputation", address: requiredAddress(erc8004.reputationRegistry, `${networkId}.erc8004.reputationRegistry`) }
  ];
  const report = await probeRpc(endpoint, Number(networkId), contracts);
  const client = new JsonRpcClient(endpoint);
  const implementationCode = await Promise.all(report.contracts.map(async (contract) => {
    if (contract.implementation === null) return { name: contract.name, address: "", bytecodePresent: true };
    const bytecode = await client.code(contract.implementation);
    return { name: contract.name, address: contract.implementation, bytecodePresent: bytecode !== "0x" };
  }));
  if (report.contracts.some((contract) => !contract.bytecodePresent) || implementationCode.some((contract) => !contract.bytecodePresent)) {
    throw new Error(`Configured ERC-8004 bytecode is missing on network ${networkId}.`);
  }
  return {
    networkId: Number(networkId),
    name: typeof network.name === "string" ? network.name : null,
    environment: typeof network.environment === "string" ? network.environment : null,
    endpoint: endpointLabel(endpoint),
    report,
    implementationCode
  };
}

const lockPath = new URL("../config/standards.lock.json", import.meta.url);
const lock = JSON.parse(await readFile(lockPath, "utf8")) as StandardsLock;
const networks = lock.networks ?? {};
const mainnet = networks["56"];
const testnet = networks["97"];
if (mainnet === undefined || testnet === undefined) throw new Error("The standards lock must configure BSC mainnet and testnet.");

try {
  const [mainnetResult, testnetResult] = await Promise.all([
    verifyNetwork("56", requiredEndpoint("BSC_MAINNET_RPC_URL"), mainnet),
    verifyNetwork("97", requiredEndpoint("BSC_TESTNET_RPC_URL"), testnet)
  ]);
  const redactReport = (result: Awaited<ReturnType<typeof verifyNetwork>>) => ({
    networkId: result.networkId,
    name: result.name,
    environment: result.environment,
    endpoint: result.endpoint,
    observedChainId: result.report.observedChainId,
    latestBlock: result.report.latestBlock,
    latestBlockHash: result.report.latestBlockHash,
    contracts: result.report.contracts.map((contract) => ({
      name: contract.name,
      address: contract.address,
      bytecodePresent: contract.bytecodePresent,
      bytecodeLength: contract.bytecodeLength,
      implementation: contract.implementation,
      implementationBytecodePresent: result.implementationCode.find((entry) => entry.name === contract.name)?.bytecodePresent ?? false
    }))
  });
  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    networks: [redactReport(mainnetResult), redactReport(testnetResult)],
    releaseGates: {
      erc8004Mainnet: status(mainnet.erc8004?.verificationStatus),
      erc8004Testnet: status(testnet.erc8004?.verificationStatus),
      erc8183Mainnet: status(mainnet.erc8183?.verificationStatus),
      erc8183Testnet: status(testnet.erc8183?.verificationStatus),
      b402Mainnet: status(mainnet.b402?.verificationStatus),
      b402Testnet: status(testnet.b402?.verificationStatus),
      greenfield: status(lock.greenfield?.verificationStatus),
      altanaMainnet: status(lock.altana?.mainnet?.verificationStatus),
      altanaTestnet: status(lock.altana?.testnet?.verificationStatus),
      bscMainTrackNetworkDecision: status(lock.releaseGates?.bscMainTrackNetworkDecision)
    }
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Standards readiness check failed.");
  process.exitCode = 1;
}
