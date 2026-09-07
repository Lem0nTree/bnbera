import {
  canonicalHealthFactorResultBytes,
  createReferenceHealthFactorResult,
  createReferenceHealthFactorTask,
  referenceHealthFactorInvocationSchema
} from "@bnbera/agent-commerce";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maxBodyBytes = 64 * 1024;

async function parseBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^[0-9]+$/u.test(contentLength) || Number(contentLength) > maxBodyBytes)) {
    throw new Error("request too large");
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBodyBytes) throw new Error("request too large");
  return JSON.parse(body) as unknown;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = referenceHealthFactorInvocationSchema.parse(await parseBody(request));
    const task = createReferenceHealthFactorTask({
      jobKey: parsed.jobKey,
      providerBinding: parsed.providerBinding,
      account: parsed.account,
      protocol: parsed.protocol,
      requestedAtUnix: parsed.requestedAtUnix,
      lendingSnapshot: parsed.lendingSnapshot
    });
    const result = createReferenceHealthFactorResult({ task, observedAtUnix: parsed.requestedAtUnix });
    const bytes = canonicalHealthFactorResultBytes(result.result);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-BNBEra-Result-SHA256": result.resultDigest,
        Vary: "Accept"
      }
    });
  } catch {
    return Response.json({ error: "The reference provider request is invalid or unavailable." }, {
      status: 400,
      headers: { "Cache-Control": "no-store", Vary: "Accept" }
    });
  }
}

export async function GET(): Promise<Response> {
  return Response.json({ status: "ready", provider: "bnbera.reference.health-factor", contract: "bnbera-reference-readiness-v1" }, {
    status: 200,
    headers: { "Cache-Control": "no-store", Vary: "Accept" }
  });
}
