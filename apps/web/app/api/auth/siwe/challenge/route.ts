import {
  authHttpError,
  authNoStoreHeaders,
  createEoaSiweChallenge,
  parseAuthJson
} from "@/lib/commerce-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Issue a server-bound SIWE message for the currently connected EOA. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseAuthJson(request);
    const challenge = await createEoaSiweChallenge(body);
    return Response.json(challenge, { status: 200, headers: authNoStoreHeaders() });
  } catch (error) {
    return authHttpError(error);
  }
}
