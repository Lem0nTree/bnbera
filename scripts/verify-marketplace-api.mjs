#!/usr/bin/env node

/**
 * Read-only W0/W1 API boundary probe.
 *
 * The endpoint is deliberately supplied by the caller. There is no fallback
 * route or fixture server here: a missing endpoint is an explicit seam defect.
 * The successful response is checked against the checked-in web read contract
 * and its W0/W1 fail-closed activation/provenance rules. This is a read-only
 * contract probe, not proof of a live registry, endpoint, payment, execution,
 * custody, or evidence integration.
 */

const endpointValue = process.env.BNBERA_MARKETPLACE_API_URL?.trim();
const expectError = process.env.BNBERA_EXPECT_ERROR === "1";
const maxBodyBytes = 1_048_576;
const marketplaceReadContractVersion = "bnbera.marketplace-read/v0.1";
const marketplaceReadStatuses = new Set(["ready", "loading", "empty", "degraded", "error"]);
const marketplaceDataModes = new Set(["fixture", "live", "degraded", "empty", "error"]);
const marketplaceStateAxes = {
  authorityStatus: new Set(["none", "active", "expired", "revoked"]),
  claimStatus: new Set(["unclaimed", "claimed", "stale"]),
  listingStatus: new Set(["draft", "published", "paused", "suspended", "delisted"]),
  originType: new Set(["discovered", "manual_import", "created"]),
  runtimeStatus: new Set(["live", "unavailable", "paused"]),
  verificationStatus: new Set(["pending", "verified", "degraded", "rejected"])
};

function defect(message) {
  console.error(`[DEFECT] ${message}`);
  process.exitCode = 2;
}

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exitCode = 1;
}

function normalizedKey(key) {
  return key.replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function sensitiveKey(key) {
  const normalized = normalizedKey(key);
  const referenceOnly = normalized.endsWith("reference");
  return normalized.includes("privatekey") ||
    normalized.includes("passkeyexport") ||
    normalized.includes("sessionmaterial") ||
    normalized === "password" ||
    normalized.includes("accesstoken") ||
    normalized.includes("rawcredential") ||
    (normalized.includes("secret") && !referenceOnly);
}

function findSensitiveField(value, path = "response") {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      const hit = findSensitiveField(child, `${path}[${index}]`);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (typeof value !== "object" || value === null) return null;

  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey(key)) return `${path}.${key}`;
    const nested = findSensitiveField(child, `${path}.${key}`);
    if (nested !== null) return nested;
  }
  return null;
}

function findSensitiveValue(value, path = "response") {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      const hit = findSensitiveValue(child, `${path}[${index}]`);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      const nested = findSensitiveValue(child, `${path}.${key}`);
      if (nested !== null) return nested;
    }
    return null;
  }
  if (typeof value !== "string") return null;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value) ||
      /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value)) {
    return path;
  }
  return null;
}

function isErrorEnvelope(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const error = value.error;
  return typeof error === "object" && error !== null && !Array.isArray(error) &&
    typeof error.code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/u.test(error.code) &&
    typeof error.message === "string" && error.message.length > 0 && error.message.length <= 500 &&
    typeof error.requestId === "string" && error.requestId.length > 0 && error.requestId.length <= 160 &&
    typeof error.retriable === "boolean" &&
    typeof error.nextAction === "string" && error.nextAction.length > 0 && error.nextAction.length <= 160;
}

function isNonEmptyString(value, maxLength = 2_000) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isAddress(value) {
  return typeof value === "string" && /^0x[0-9a-f]{40}$/iu.test(value);
}

function isDecimalAgentId(value) {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value);
}

function hasCompleteStateAxes(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = Object.keys(marketplaceStateAxes).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return false;
  return Object.entries(marketplaceStateAxes).every(([axis, allowed]) => allowed.has(value[axis]));
}

function isMarketplaceAgentReadModel(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (!isNonEmptyString(value.id, 400) || !isNonEmptyString(value.slug, 160) ||
      !isNonEmptyString(value.name, 160) || !isNonEmptyString(value.tagline, 240) ||
      !isNonEmptyString(value.description)) return false;
  if (typeof value.category !== "string" || !isNonEmptyString(value.category, 64)) return false;
  if (!Array.isArray(value.protocols) || !value.protocols.every((protocol) => isNonEmptyString(protocol, 128))) return false;
  const identity = value.identity;
  if (typeof identity !== "object" || identity === null || Array.isArray(identity) ||
      !isNonEmptyString(identity.namespace, 128) ||
      !Number.isInteger(identity.chainId) || ![56, 97].includes(identity.chainId) ||
      !isAddress(identity.identityRegistry) || !isDecimalAgentId(identity.agentId)) return false;
  const expectedIdentityKey = [
    identity.namespace.trim(),
    identity.chainId.toString(10),
    identity.identityRegistry.toLowerCase(),
    identity.agentId
  ].join(":");
  if (value.id !== expectedIdentityKey) return false;
  if (!hasCompleteStateAxes(value.stateAxes)) return false;
  if (!Array.isArray(value.services) || !value.services.every((service) =>
      typeof service === "object" && service !== null && !Array.isArray(service) &&
      isNonEmptyString(service.kind, 32) && isNonEmptyString(service.protocolVersion, 128) &&
      typeof service.url === "string" && /^https?:\/\/[^\s#?]+(?:\?[^\s#]*)?$/iu.test(service.url) &&
      !service.url.includes("@")
  ) || !Array.isArray(value.capabilityManifest?.capabilities)) return false;
  if (value.ownerAddress !== null && !isAddress(value.ownerAddress)) return false;
  if (value.agentWallet !== null && !isAddress(value.agentWallet)) return false;
  const activation = value.activation;
  if (typeof activation !== "object" || activation === null || Array.isArray(activation) ||
      activation.enabled !== false || activation.availability !== "unavailable" ||
      !isNonEmptyString(activation.reason, 500) || !isNonEmptyString(activation.nextAction, 160)) return false;
  const provenance = value.dataProvenance;
  if (typeof provenance !== "object" || provenance === null || Array.isArray(provenance) ||
      !new Set(["fixture", "live", "degraded"]).has(provenance.mode) ||
      !isNonEmptyString(provenance.label, 160) || !isNonEmptyString(provenance.details, 500)) return false;
  if (provenance.mode === "fixture" && !/fixture/iu.test(provenance.label)) return false;
  if (provenance.mode === "fixture" &&
      (value.evidence?.status !== "unavailable" || value.evidence?.ipfsUri !== null || value.evidence?.greenfieldUri !== null)) return false;
  return true;
}

function isMarketplaceReadResponse(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (value.contractVersion !== marketplaceReadContractVersion ||
      !marketplaceReadStatuses.has(value.status) || !marketplaceDataModes.has(value.mode) ||
      !isNonEmptyString(value.dataLabel, 160) || !isNonEmptyString(value.notice, 500) ||
      !Array.isArray(value.agents) || !Number.isInteger(value.total) || value.total < 0 ||
      value.agents.length > value.total || !isMarketplaceSelection(value.selection)) return false;
  if (value.status === "error") {
    if (!isErrorEnvelope(value.error)) return false;
  } else if (value.error !== null) {
    return false;
  }
  if (!value.agents.every(isMarketplaceAgentReadModel)) return false;
  if (value.mode === "fixture" && value.agents.some((agent) => agent.dataProvenance.mode !== "fixture")) return false;
  if (value.mode === "live" && value.agents.some((agent) => agent.dataProvenance.mode === "fixture")) return false;
  return true;
}

function isMarketplaceSelection(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return ["query", "category", "origin", "verification", "runtime", "protocol", "sort"]
    .every((key) => typeof value[key] === "string" || value[key] === null);
}

if (endpointValue === undefined || endpointValue.length === 0) {
  defect("BNBERA_MARKETPLACE_API_URL is not set; the W0/W1 API/read-model seam is unavailable in this checkout.");
} else {
  let endpoint;
  try {
    endpoint = new URL(endpointValue);
    if ((endpoint.protocol !== "http:" && endpoint.protocol !== "https:") || endpoint.username !== "" || endpoint.password !== "" || endpoint.hash !== "") {
      throw new Error("unsupported URL");
    }
  } catch {
    fail("BNBERA_MARKETPLACE_API_URL must be an HTTP(S) URL without credentials or a fragment.");
  }

  if (endpoint !== undefined && process.exitCode === undefined) {
    try {
      const response = await fetch(endpoint, { headers: { accept: "application/json" } });
      const contentType = response.headers.get("content-type") ?? "";
      const bodyText = await response.text();
      if (new TextEncoder().encode(bodyText).byteLength > maxBodyBytes) {
        fail("The marketplace API response exceeds the 1 MiB QA safety limit.");
      } else if (contentType.toLowerCase().includes("text/html") || bodyText.trimStart().startsWith("<")) {
        fail("The marketplace API returned HTML; clients must not parse an HTML error page as JSON.");
      } else if (!contentType.toLowerCase().includes("json")) {
        fail("The marketplace API response must declare a JSON content type.");
      } else {
        let body;
        try {
          body = JSON.parse(bodyText);
        } catch {
          fail("The marketplace API response is not valid JSON.");
        }

        if (body !== undefined) {
          const field = findSensitiveField(body) ?? findSensitiveValue(body);
          if (field !== null) {
            fail(`The marketplace API response contains a sensitive field or value at ${field}.`);
          } else if (!response.ok) {
            if (!expectError) {
              fail(`The marketplace API returned HTTP ${response.status}; set BNBERA_EXPECT_ERROR=1 only for an intentional error-state probe.`);
            } else if (!isErrorEnvelope(body)) {
              fail("The intentional marketplace API error response is not the shared error envelope.");
            } else {
              console.log(JSON.stringify({ ok: true, mode: "error-state", status: response.status, errorCode: body.error.code }));
            }
          } else if (isErrorEnvelope(body)) {
            fail("The marketplace API returned an error envelope with a successful HTTP status.");
          } else if (!isMarketplaceReadResponse(body)) {
            fail("The successful marketplace API response does not match the checked-in W0/W1 web read contract or fail-closed state rules.");
          } else {
            console.log(JSON.stringify({
              ok: true,
              mode: "read-state",
              status: response.status,
              contentType: contentType || "unspecified",
              contractVersion: body.contractVersion,
              readStatus: body.status,
              dataMode: body.mode,
              itemCount: body.agents.length,
              total: body.total
            }));
          }
        }
      }
    } catch {
      fail("The marketplace API could not be reached; no live read-model evidence was produced.");
    }
  }
}

if (process.exitCode === undefined) process.exitCode = 0;
