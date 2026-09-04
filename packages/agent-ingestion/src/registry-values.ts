import { ingestionError } from "./errors.js";

/** Normalize a registry-returned URI without assuming a metadata transport. */
export function normalizeNullableForRegistryRead(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value.length === 0 || value.length > 2_048 || /[\u0000-\u001f\u007f]/u.test(value)) throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry agent URI is invalid.", "fix_registry_abi");
  let parsed: URL;
  try { parsed = new URL(value); } catch (cause) { throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry agent URI is invalid.", "fix_registry_abi", cause); }
  if (!["https:", "ipfs:", "data:"].includes(parsed.protocol) || parsed.username !== "" || parsed.password !== "" || parsed.hash !== "") throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry agent URI uses an unsupported form.", "fix_registry_abi");
  return parsed.toString();
}
