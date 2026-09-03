import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { errorEnvelopeSchema } from "../../packages/config/src/errors.js";

const lockPath = fileURLToPath(new URL("../../config/standards.lock.json", import.meta.url));
const schemaPath = fileURLToPath(new URL("../../packages/db/src/schema.ts", import.meta.url));
const webReadPath = fileURLToPath(new URL("../../apps/web/src/lib/marketplace-contract.ts", import.meta.url));
const browseRoutePath = fileURLToPath(new URL("../../apps/web/app/api/marketplace/route.ts", import.meta.url));
const detailRoutePath = fileURLToPath(new URL("../../apps/web/app/api/marketplace/[slug]/route.ts", import.meta.url));
const apiProbePath = fileURLToPath(new URL("../../scripts/verify-marketplace-api.mjs", import.meta.url));
const browserProbePath = fileURLToPath(new URL("../../scripts/verify-marketplace-browser.sh", import.meta.url));

type StandardsLock = {
  readonly lockStatus: string;
  readonly networks: Record<string, {
    readonly erc8004: {
      readonly identityRegistry: string | null;
      readonly reputationRegistry: string | null;
      readonly validationRegistry: string | null;
      readonly abiHashes: { readonly identityRegistry: string | null; readonly reputationRegistry: string | null };
      readonly verificationStatus: string;
    };
    readonly erc8183: Record<string, unknown>;
    readonly b402: { readonly enabled: boolean; readonly verificationStatus: string };
  }>;
  readonly greenfield: { readonly sdkVersion: string | null; readonly storageProviders: readonly unknown[]; readonly verificationStatus: string };
  readonly altana: {
    readonly mainnet: { readonly verificationStatus: string };
    readonly testnet: { readonly verificationStatus: string };
  };
  readonly releaseGates: Record<string, unknown>;
};

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function containsForbiddenSecretField(value: unknown, path = "response"): string | null {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      const hit = containsForbiddenSecretField(child, `${path}[${index}]`);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (typeof value !== "object" || value === null) return null;

  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    const allowedReference = normalized.endsWith("referenc") || normalized.endsWith("reference");
    const forbidden =
      normalized.includes("privatekey") ||
      normalized.includes("passkeyexport") ||
      normalized.includes("sessionmaterial") ||
      normalized === "password" ||
      normalized.includes("accesstoken") ||
      normalized.includes("rawcredential") ||
      (normalized.includes("secret") && !allowedReference);
    if (forbidden) return `${path}.${key}`;
    const nested = containsForbiddenSecretField(child, `${path}.${key}`);
    if (nested !== null) return nested;
  }
  return null;
}

describe("W0/W1 optional rails fail closed", () => {
  it("keeps unresolved standards-lock rails disabled", async () => {
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as StandardsLock;

    expect(lock.lockStatus).toBe("candidate");
    expect(lock.networks["56"]?.b402.enabled).toBe(false);
    expect(lock.networks["97"]?.b402.enabled).toBe(false);
    expect(lock.networks["56"]?.b402.verificationStatus).toMatch(/blocked|pending/i);
    expect(lock.networks["97"]?.b402.verificationStatus).toMatch(/blocked|pending/i);
    expect(lock.networks["97"]?.erc8183.verificationStatus).toMatch(/blocked|pending/i);
    expect(lock.greenfield.sdkVersion).toBeNull();
    expect(lock.greenfield.storageProviders).toHaveLength(0);
    expect(lock.greenfield.verificationStatus).toMatch(/pending|blocked/i);
    expect(lock.altana.mainnet.verificationStatus).toMatch(/pending|blocked/i);
    expect(lock.altana.testnet.verificationStatus).toMatch(/pending|blocked/i);
    expect(lock.releaseGates.bscMainTrackNetworkDecision).toBe("unresolved");
    expect(lock.releaseGates.erc8004ValidationRegistry).toBe("disabled-no-official-bsc-address");
  });

  it("does not treat missing ERC-8004 ABI hashes as verified evidence", async () => {
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as StandardsLock;
    for (const networkId of ["56", "97"]) {
      const erc8004 = lock.networks[networkId]?.erc8004;
      expect(erc8004).toBeDefined();
      expect(erc8004?.abiHashes.identityRegistry).toBeNull();
      expect(erc8004?.abiHashes.reputationRegistry).toBeNull();
      expect(erc8004?.verificationStatus).toMatch(/pending|blocked/i);
    }
  });

  it("rejects secret-bearing response shapes while allowing opaque references", () => {
    expect(containsForbiddenSecretField({
      secretReference: "arn:aws:secretsmanager:example",
      merchantCredentialReference: "secret://merchant",
      nested: { runtimeSessionReference: "secret://session" }
    })).toBeNull();
    expect(containsForbiddenSecretField({ nested: { private_key: "never" } })).toBe("response.nested.private_key");
    expect(containsForbiddenSecretField({ sessionMaterial: "never" })).toBe("response.sessionMaterial");
    expect(containsForbiddenSecretField({ accessToken: "never" })).toBe("response.accessToken");
  });

  it("keeps the database schema reference-only for secrets and digest-only for sessions", async () => {
    const schema = await readFile(schemaPath, "utf8");
    expect(schema).not.toMatch(/private[_-]?key/iu);
    expect(schema).not.toMatch(/session[_-]?material/iu);
    expect(schema).toContain("secretReference");
    expect(schema).toContain("tokenDigest");
    expect(schema).not.toContain("token: text");
  });
});

describe("stable error boundary", () => {
  it("accepts only the public error envelope shape", () => {
    const envelope = {
      error: {
        code: "MARKETPLACE_UNAVAILABLE",
        message: "The marketplace read model is unavailable.",
        requestId: "qa-boundary-1",
        retriable: true,
        nextAction: "retry"
      }
    };
    expect(errorEnvelopeSchema.parse(envelope)).toEqual(envelope);
    const parsed = errorEnvelopeSchema.parse({ ...envelope, error: { ...envelope.error, cause: "secret" } });
    expect(parsed).not.toHaveProperty("error.cause");
  });
});

describe("read-only marketplace surface", () => {
  it("does not expose signing, payment, or credential-bearing hooks", async () => {
    const sourcePaths = [webReadPath, browseRoutePath, detailRoutePath];
    const sources = await Promise.all(sourcePaths.map((path) => readFile(path, "utf8")));

    for (const source of sources) {
      expect(source).not.toMatch(/private[_-]?key|passkey[_-]?export|session[_-]?material|access[_-]?token/iu);
      expect(source).not.toMatch(/sendTransaction|writeContract|signTransaction|broadcastTransaction|paymentChallenge/iu);
    }
    expect(sources[1]).toMatch(/export async function GET/iu);
    expect(sources[1]).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/iu);
    expect(sources[2]).toMatch(/export async function GET/iu);
    expect(sources[2]).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/iu);
  });

  it("keeps verification probes explicit, read-only, and fail-closed", async () => {
    const [apiProbe, browserProbe] = await Promise.all([
      readFile(apiProbePath, "utf8"),
      readFile(browserProbePath, "utf8")
    ]);

    expect(apiProbe).toContain("checked-in W0/W1 web read contract");
    expect(apiProbe).toContain("no live read-model evidence was produced");
    expect(apiProbe).toContain("BNBERA_MARKETPLACE_API_URL is not set");
    for (const route of [
      "/marketplace",
      "/marketplace/rebalancing",
      "/marketplace/grid-trading",
      "/marketplace/yield-optimisation",
      "/marketplace/health-factor",
      "/compare"
    ]) {
      expect(browserProbe).toContain(`"${route}"`);
    }
    expect(browserProbe).toContain("BNBERA_REQUIRE_STATE_MARKERS");
    expect(browserProbe).toContain("agent-browser close");
    expect(browserProbe).not.toMatch(/state (save|load)|cookie|localStorage|sessionMaterial/iu);
  });
});
