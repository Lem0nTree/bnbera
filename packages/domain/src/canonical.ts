import { createHash } from "node:crypto";

function escapeString(value: string): string {
  return JSON.stringify(value);
}

function canonicalValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return escapeString(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot contain non-finite numbers");
    }
    return Object.is(value, -0) ? "0" : String(value);
  }

  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError("Canonical JSON cannot contain bigint, function, or symbol values");
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalValue(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON only accepts plain objects");
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => {
        const entry = record[key];
        if (entry === undefined) {
          throw new TypeError(`Canonical JSON cannot contain undefined field: ${key}`);
        }
        return `${escapeString(key)}:${canonicalValue(entry)}`;
      });
    return `{${entries.join(",")}}`;
  }

  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
}

export function canonicalizeJson(value: unknown): string {
  return canonicalValue(value);
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalSha256Hex(value: unknown): string {
  return sha256Hex(canonicalizeJson(value));
}
