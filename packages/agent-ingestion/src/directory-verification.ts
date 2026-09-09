import { canonicalSha256Hex } from "@bnbera/domain";
import { HttpServiceProbeTransport } from "./probe.js";
import { publicRecord, publicText, publicHttpsUrl, serviceVerificationSchema, type DirectorySnapshot, type ServiceVerification } from "./directory.js";

export async function verifyDirectoryService(service: DirectorySnapshot["services"][number], transport = new HttpServiceProbeTransport({ maxRedirects: 1 })): Promise<ServiceVerification> {
  const name = service.name.toLowerCase();
  const protocol = name === "a2a" || name === "mcp" || name === "web" || name === "api" ? name : "other";
  const started = Date.now();
  const base: ServiceVerification = { name: service.name, url: service.url, protocol, status: "advertised", checkedAt: null, expiresAt: null,
    latencyMs: null, httpStatus: null, reason: "PROTOCOL_CHECK_NOT_SUPPORTED", source: "bnbera-protocol-verifier-v1", protocolVersion: service.version,
    capabilityCount: null, capabilityNames: [], invocationUrls: [], responseDigest: null, evidence: "none" };
  if (protocol === "other") return base;
  let reason: string | null = null;
  try {
    const result = await transport.probe({ url: service.url, kind: protocol, ...(service.version ? { protocolVersion: service.version } : {}), timeoutMs: 8000, maxResponseBytes: 1024*1024 });
    reason = result.errorCode ?? null;
    const summary = publicRecord(result.safeCapabilityProbe);
    const verified = result.contractStatus === "healthy";
    const skills = Array.isArray(summary.skills) ? summary.skills.map(raw=>publicText(publicRecord(raw).name,160)).filter((x):x is string=>Boolean(x)) : [];
    const names = Array.isArray(summary.capabilityNames) ? summary.capabilityNames.flatMap(n=>publicText(n,160)??[]) : skills;
    return serviceVerificationSchema.parse({ ...base,
      status: verified ? (protocol === "a2a" || protocol === "mcp" ? "verified" : "reachable") : classifyFailure(reason),
      checkedAt: new Date(started).toISOString(), expiresAt: new Date(started+120000).toISOString(), latencyMs: Date.now()-started, httpStatus: result.statusCode || null, reason,
      protocolVersion: publicText(summary.protocolVersion,128) ?? service.version,
      capabilityCount: typeof summary.capabilityCount === "number" ? summary.capabilityCount : typeof summary.skillCount === "number" ? summary.skillCount : null,
      capabilityNames: names.slice(0,32), invocationUrls: Array.isArray(summary.invocationUrls) ? summary.invocationUrls.flatMap(u=>publicHttpsUrl(u)??[]) : [],
      responseDigest: Object.keys(summary).length ? canonicalSha256Hex(summary) : null,
      evidence: !verified ? "none" : protocol === "a2a" ? "agent-card-schema" : protocol === "mcp" ? "handshake-and-list" : "http-availability"
    });
  } catch (error) {
    const code = publicRecord(error).code;
    reason = typeof code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/u.test(code) ? code : "SERVICE_TRANSPORT_FAILED";
    return {...base, status: classifyFailure(reason), checkedAt:new Date(started).toISOString(), expiresAt:new Date(started+120000).toISOString(), latencyMs:Date.now()-started, reason};
  }
}
function classifyFailure(reason: string | null): ServiceVerification["status"] {
  if (reason === "SERVICE_AUTH_REQUIRED") return "auth_required";
  return /INVALID|MIME|UNSUPPORTED|SSRF|REDIRECT|REBINDING|HTTPS_REQUIRED|TOO_LARGE/u.test(reason??"") ? "invalid" : "unreachable";
}
