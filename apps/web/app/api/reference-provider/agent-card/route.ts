import { z } from "zod";
import { POST as invokeHealthFactor } from "../health-factor/route";
import { boundedJsonBody } from "@/lib/bounded-json-body";

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
  const skillDescription = "Compute collateral-adjusted lending health factor and classify safe, watch, or critical risk from a supplied protocol snapshot.";
  const card = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "BNBEra Reference Health-Factor Provider",
    description: "Clearly labelled BNBEra testnet reference agent. Calculates lending risk from your supplied collateral, debt and liquidation threshold, with exact inputs and result evidence. Buyer-attested inputs are not live on-chain positions.",
    version: "1.0.0",
    supportedProtocols: ["A2A/0.3"],
    services: [{ name: "A2A", kind: "a2a", endpoint: cardUrl, version: "0.3.0" }],
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
    protocolVersion: "0.3.0",
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    url: cardUrl,
    preferredTransport: "JSONRPC",
    additionalInterfaces: [{ url: cardUrl, transport: "JSONRPC" }],
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

/** A2A 0.3 message/send. The separate raw JSON API is used by the bound worker. */
export async function POST(request: Request): Promise<Response> {
  let id: string | number | null = null;
  try {
    const body=z.object({jsonrpc:z.literal("2.0"),id:z.union([z.string().max(128),z.number().finite()]),method:z.literal("message/send"),params:z.object({message:z.object({role:z.literal("user"),messageId:z.string().max(128),parts:z.array(z.object({kind:z.literal("data"),data:z.record(z.unknown())})).length(1)})})}).parse(await boundedJsonBody(request));
    id=body.id;
    const response=await invokeHealthFactor(new Request(new URL("/api/reference-provider/health-factor",request.url),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body.params.message.parts[0]!.data)}));
    if(!response.ok)throw new Error("INVALID_TASK");
    return Response.json({jsonrpc:"2.0",id,result:{kind:"message",messageId:crypto.randomUUID(),role:"agent",parts:[{kind:"data",data:await response.json()}]}},{headers:{"Cache-Control":"no-store"}});
  }catch{return Response.json({jsonrpc:"2.0",id,error:{code:-32602,message:"Use message/send with one structured reference-health-factor invocation data part."}},{status:400,headers:{"Cache-Control":"no-store"}});}
}
