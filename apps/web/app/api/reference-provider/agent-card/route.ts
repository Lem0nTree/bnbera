import { z } from "zod";
import { POST as invokeHealthFactor } from "../health-factor/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const baseUrlSchema = z.string().url().refine((value) => {
  const parsed = new URL(value);
  return parsed.username === "" && parsed.password === "" && parsed.hash === "" && (parsed.protocol === "https:" || parsed.protocol === "http:");
}, "The reference provider base URL must be a credential-free HTTP(S) URL.");

function publicBaseUrl(request: Request): string {
  const configured = process.env.T5_REFERENCE_PROVIDER_PUBLIC_BASE_URL?.trim() || process.env.APP_URL?.trim();
  if (configured !== undefined && configured !== "") {
    const parsed = baseUrlSchema.safeParse(configured);
    if (parsed.success) return parsed.data.replace(/\/$/u, "");
  }
  return new URL(request.url).origin;
}

export async function GET(request: Request): Promise<Response> {
  const base = publicBaseUrl(request);
  const cardUrl = `${base}/api/reference-provider/agent-card`;
  const invocationUrl = `${base}/api/reference-provider/health-factor`;
  const skillDescription = "Compute collateral-adjusted lending health factor and classify safe, watch, or critical risk from a supplied protocol snapshot.";
  const card = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "BNBEra Reference Health-Factor Provider",
    description: "BNBEra-operated callable provider that derives a lending health factor from a validated, timestamped snapshot and returns a provenance-bound risk interpretation.",
    version: "1.0.0",
    supportedProtocols: ["A2A/0.3"],
    services: [{ kind: "a2a", endpoint: cardUrl, version: "0.3.0" }],
    capabilityManifest: {
      schemaVersion: "bnbera.reference.health-factor.capability/v1",
      capabilities: [{
        id: "health_factor_monitor",
        description: skillDescription,
        inputSchema: { type: "object", required: ["schemaVersion", "jobKey", "providerBinding", "account", "protocol", "requestedAtUnix", "lendingSnapshot"] },
        outputSchema: { type: "object", required: ["fixture", "source", "healthFactor", "healthFactorExact", "provenance"] },
        requiredProtocols: ["A2A/0.3"],
        allowedActions: ["message/send"]
      }]
    },
    protocolVersion: "0.3",
    supportedInterfaces: [{
      url: invocationUrl,
      protocolBinding: "HTTP+JSON",
      protocolVersion: "0.3"
    }],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false
    },
    skills: [{
      id: "health_factor_monitor",
      name: "Health-factor monitoring",
      description: skillDescription,
      tags: ["health-factor", "lending-risk", "provenance"],
      keywords: ["health factor", "liquidation threshold", "collateral", "debt"],
      inputModes: ["application/json"],
      outputModes: ["application/json"]
    }]
  };
  return Response.json(card, {
    headers: { "Cache-Control": "public, max-age=60", Vary: "Accept" }
  });
}

/** The card URL is a callable A2A service endpoint as well as the discovery document. */
export async function POST(request: Request): Promise<Response> {
  return invokeHealthFactor(request);
}
