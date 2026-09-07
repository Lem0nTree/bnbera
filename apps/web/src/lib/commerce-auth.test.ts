import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BNB_TESTNET } from "@altananetwork/sdk";
import { describe, expect, it } from "vitest";
import {
  assertAltanaAuthStandardsLock,
  readAltanaAuthStandardsLock
} from "./commerce-auth";

const lockPath = fileURLToPath(new URL("../../../../config/standards.lock.json", import.meta.url));

function lock(): Record<string, unknown> {
  return JSON.parse(readFileSync(lockPath, "utf8")) as Record<string, unknown>;
}

function cloneLock(): Record<string, unknown> {
  return structuredClone(lock());
}

function testnet(value: Record<string, unknown>): Record<string, unknown> {
  return ((value.altana as Record<string, unknown>).testnet as Record<string, unknown>);
}

describe("T5 Altana auth runtime lock", () => {
  it("accepts the checked-in SDK network and read-only verification", () => {
    expect(() => assertAltanaAuthStandardsLock(readAltanaAuthStandardsLock(), BNB_TESTNET)).not.toThrow();
  });

  it.each([
    ["keyStore", "0x1111111111111111111111111111111111111111"],
    ["publicRpcUrl", "https://wrong-rpc.example"],
    ["verificationStatus", "pending"],
    ["eip1967ImplementationSlot", `0x${"1".repeat(64)}`]
  ])("rejects a changed %s lock value", (field, value) => {
    const changed = cloneLock();
    testnet(changed)[field] = value;
    expect(() => assertAltanaAuthStandardsLock(changed, BNB_TESTNET)).toThrow(/temporarily unavailable/i);
  });

  it("rejects SDK network address drift even when the lock is unchanged", () => {
    expect(() => assertAltanaAuthStandardsLock(lock(), { ...BNB_TESTNET, keyStore: "0x1111111111111111111111111111111111111111" })).toThrow(/temporarily unavailable/i);
  });
});
