import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { erc8183Addresses } from "@altananetwork/sdk";
import { describe, expect, it } from "vitest";
import { resolveErc8183DeploymentVerification } from "../src/index.js";

type Erc8183Lock = {
  readonly enabled?: unknown;
  readonly releaseEnabled?: unknown;
  readonly disabledReason?: unknown;
  readonly sourceRevision?: unknown;
  readonly commerceProxy?: unknown;
  readonly routerProxy?: unknown;
  readonly policy?: unknown;
  readonly paymentToken?: unknown;
  readonly paymentTokenSymbol?: unknown;
  readonly paymentTokenName?: unknown;
  readonly paymentDecimals?: unknown;
  readonly commerceImplementation?: unknown;
  readonly routerImplementation?: unknown;
  readonly paymentTokenImplementation?: unknown;
  readonly paymentTokenProxyAdmin?: unknown;
  readonly abiHashes?: {
    readonly commerce?: unknown;
    readonly router?: unknown;
    readonly policy?: unknown;
  };
  readonly runtimeSha256?: {
    readonly commerceProxy?: unknown;
    readonly routerProxy?: unknown;
    readonly commerceImplementation?: unknown;
    readonly routerImplementation?: unknown;
    readonly policy?: unknown;
    readonly paymentToken?: unknown;
  };
  readonly riskLimits?: {
    readonly network?: unknown;
    readonly token?: unknown;
    readonly tokenSymbol?: unknown;
    readonly maxBudgetAtomic?: unknown;
    readonly maxBudgetDisplay?: unknown;
  };
};

type StandardsLock = {
  readonly networks?: Record<string, { readonly erc8183?: Erc8183Lock }>;
};

const SOURCE_REVISION = "b40b18011407ba13516661d3784bcb727a0c7794";
const lockPath = fileURLToPath(new URL("../../../config/standards.lock.json", import.meta.url));
const lock = JSON.parse(readFileSync(lockPath, "utf8")) as StandardsLock;

function testnetLock(): Erc8183Lock {
  const deployment = lock.networks?.["97"]?.erc8183;
  if (deployment === undefined) throw new Error("BSC testnet ERC-8183 lock is missing.");
  return deployment;
}

function address(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is missing from the T4 lock.`);
  return value.toLowerCase();
}

describe("T4 ERC-8183 standards lock", () => {
  it("composes all four chain-97 addresses from the authoritative SDK deployment", () => {
    const pin = testnetLock();
    const sdk = erc8183Addresses(97);

    expect(pin.sourceRevision).toBe(SOURCE_REVISION);
    expect(address(pin.commerceProxy, "commerceProxy")).toBe(sdk.commerce.toLowerCase());
    expect(address(pin.routerProxy, "routerProxy")).toBe(sdk.router.toLowerCase());
    expect(address(pin.policy, "policy")).toBe(sdk.policy.toLowerCase());
    expect(address(pin.paymentToken, "paymentToken")).toBe(sdk.paymentToken.toLowerCase());
    expect(address(pin.riskLimits?.token, "riskLimits.token")).toBe(sdk.paymentToken.toLowerCase());
  });

  it("keeps the development canary and release paths fail-closed", () => {
    const pin = testnetLock();

    expect(pin.enabled).toBe(true);
    expect(pin.releaseEnabled).toBe(false);
    expect(pin.disabledReason).toMatch(/canary|release/i);
    expect(pin.paymentTokenSymbol).toBe("U");
    expect(pin.paymentTokenName).toBe("United Stables");
    expect(pin.paymentDecimals).toBe(18);
    expect(pin.riskLimits).toMatchObject({
      network: 97,
      tokenSymbol: "U",
      maxBudgetAtomic: "10000000000000000",
      maxBudgetDisplay: "0.01"
    });
  });

  it("retains bytecode and source ABI evidence for each reviewed contract", () => {
    const pin = testnetLock();

    expect(pin.commerceImplementation).toBe("0x153783ddbdf5233c591965f04644b1df2d1a7815");
    expect(pin.routerImplementation).toBe("0x40c0254610d92f1eb9c2d7d5d2114bc4c99d935e");
    expect(pin.paymentTokenImplementation).toBe("0x6b5c44cbd4bbddf11723557ba1b77ec5e33225cc");
    expect(pin.paymentTokenProxyAdmin).toBe("0x1e33d209c18f51d97f66ea461c6f819b59e78b30");
    expect(pin.abiHashes).toEqual({
      commerce: "4d8ac8b406dff522f1b9066eb3e00e2c8e491d4d09df2564ede124220b623ede",
      router: "75194cd4777b17459108a69da2e65c15dc00b2b8c7fe340794d28dceeb3d3329",
      policy: "843d484a26c8a21271df31078347cdb5bcfad705cd69bed729c2773bb392cc62"
    });
    expect(pin.runtimeSha256).toEqual({
      commerceProxy: "a04dc24cdccd0690eae672f2ce21d4b2188c15bc30000b783da51d6bbd6ea13d",
      routerProxy: "a04dc24cdccd0690eae672f2ce21d4b2188c15bc30000b783da51d6bbd6ea13d",
      commerceImplementation: "df9996ee849157d112de9ca9eff870ddf30bd51d1c9b785669887797c697fd10",
      routerImplementation: "41ff045ec43932e4f28d25146edaf0a5c1d2425f3dab826c88afa52ec8ab1fa1",
      policy: "4a17125e2600679a15b88acf8cd481f442d8056fd38da709a4a774e621258ed5",
      paymentToken: "1076ca0b58e992bba671ddbde6a9d96685c712113eee50caa891c458fc2b48a9"
    });
  });

  it("composes runtime verification from the lock without enabling release", () => {
    const composed = resolveErc8183DeploymentVerification(lock, 97);

    expect(composed.enabled).toBe(true);
    expect(composed.releaseEnabled).toBe(false);
    expect(composed.verification).toMatchObject({
      commerceProxy: "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de",
      routerProxy: "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25",
      policy: "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea",
      paymentToken: "0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565",
      paymentDecimals: 18,
      commerceImplementation: "0x153783ddbdf5233c591965f04644b1df2d1a7815",
      routerImplementation: "0x40c0254610d92f1eb9c2d7d5d2114bc4c99d935e",
      paymentTokenImplementation: "0x6b5c44cbd4bbddf11723557ba1b77ec5e33225cc",
      paymentTokenSymbol: "U",
      paymentTokenName: "United Stables"
    });
    // The lock has no token implementation runtime hash; composition must
    // leave that optional until a reviewed lock update supplies one.
    expect(composed.verification.paymentTokenImplementationRuntimeSha256).toBeUndefined();
  });
});
