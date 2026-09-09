import { ingestionError } from "./errors.js";

/** Normalize a registry-returned URI without assuming a metadata transport. */
export function normalizeNullableForRegistryRead(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  // Inline JSON registrations are commonly larger than a web URL. Their decoded
  // bytes are separately bounded by BoundedMetadataResolver before parsing.
  const maximum = value.startsWith("data:") ? 1_500_000 : 2_048;
  if (value.length === 0 || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry agent URI is invalid.", "fix_registry_abi");
  let parsed: URL;
  try { parsed = new URL(value); } catch (cause) { throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry agent URI is invalid.", "fix_registry_abi", cause); }
  if (!["https:", "ipfs:", "data:"].includes(parsed.protocol) || parsed.username !== "" || parsed.password !== "" || parsed.hash !== "") throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry agent URI uses an unsupported form.", "fix_registry_abi");
  return parsed.toString();
}
