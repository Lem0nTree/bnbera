import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeSessionDescriptor } from "@bnbera/altana";
import { afterEach, describe, expect, it } from "vitest";
import { creatorLocalStudioDestination, creatorRuntimeName, LocalCreatorStudioSecretSink } from "./creator-local-secret";

const draftId = "00000000-0000-4000-8000-000000000001";
const authorityId = "00000000-0000-4000-8000-000000000002";
const descriptor: RuntimeSessionDescriptor = {
  sessionId: "creator-browser:00000000-0000-4000-8000-000000000001:abcd1234",
  policy: {
    chainId: 97,
    adminAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    sessionPublicAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
    sessionPublicKey: `0x04${"11".repeat(64)}`,
    calls: [{ target: "0xdddddddddddddddddddddddddddddddddddddddd", selectors: ["0x12345678"], maxNativeValueWei: 0n }],
    spend: [],
    expiresAtUnix: 2_000_000_000,
  },
  policyDigest: `0x${"22".repeat(32)}`,
  grantTransactionHash: null,
  secretReference: null,
  grantedAtUnix: 1_700_000_000,
};

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("local Creator Studio secret sink", () => {
  it("writes the Studio envelope with owner-only modes and reconciles identical bytes", async () => {
    mkdirSync(join(process.cwd(), ".tmp"), { recursive: true });
    const root = mkdtempSync(join(process.cwd(), ".tmp", "creator-sink-"));
    roots.push(root);
    const sink = new LocalCreatorStudioSecretSink({ workspaceRoot: root, nowUnix: () => 1_700_000_001 });
    const destination = creatorLocalStudioDestination(creatorRuntimeName(draftId), authorityId);
    const bytes = new TextEncoder().encode("{\"version\":1}");
    const first = await sink.putRuntimeSession({ bytes, descriptor, destination });
    const file = join(root, creatorRuntimeName(draftId), ".studio", "wallets", "altana-session.json");
    expect(readFileSync(file, "utf8")).toBe("{\"version\":1}");
    expect(lstatSync(join(root, creatorRuntimeName(draftId))).mode & 0o777).toBe(0o700);
    expect(lstatSync(file).mode & 0o777).toBe(0o600);
    const second = await sink.putRuntimeSession({ bytes, descriptor, destination });
    expect(second.handoffId).toBe(first.handoffId);
    await expect(sink.putRuntimeSession({ bytes: new TextEncoder().encode("different"), descriptor, destination })).rejects.toThrow();
  });

  it("rejects traversal and symlink destinations without following them", async () => {
    mkdirSync(join(process.cwd(), ".tmp"), { recursive: true });
    const root = mkdtempSync(join(process.cwd(), ".tmp", "creator-sink-links-"));
    roots.push(root);
    const sink = new LocalCreatorStudioSecretSink({ workspaceRoot: root });
    await expect(sink.putRuntimeSession({ bytes: new Uint8Array([1]), descriptor, destination: { provider: "studio-delegated-secret-channel", reference: "studio-local/../escape/" } })).rejects.toThrow();
    const runtime = join(root, creatorRuntimeName(draftId));
    writeFileSync(runtime, "not-a-directory");
    await expect(sink.putRuntimeSession({ bytes: new Uint8Array([1]), descriptor, destination: creatorLocalStudioDestination(creatorRuntimeName(draftId), authorityId) })).rejects.toThrow();
  });
});
