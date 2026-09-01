import { describe, expect, it } from "vitest";
import { canonicalSha256Hex, canonicalizeJson } from "../canonical.js";

describe("canonical JSON", () => {
  it("orders object keys recursively while preserving array order", () => {
    expect(canonicalizeJson({ z: 1, a: { y: true, x: [2, 1] } })).toBe(
      '{"a":{"x":[2,1],"y":true},"z":1}'
    );
  });

  it("produces the same digest for equivalent key order", () => {
    expect(canonicalSha256Hex({ b: 2, a: 1 })).toBe(canonicalSha256Hex({ a: 1, b: 2 }));
  });

  it("rejects undefined and non-finite values", () => {
    expect(() => canonicalizeJson({ secret: undefined })).toThrow(/undefined/);
    expect(() => canonicalizeJson({ amount: Number.NaN })).toThrow(/non-finite/);
  });
});
