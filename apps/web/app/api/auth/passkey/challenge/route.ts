import {
  authHttpError,
  authNoStoreHeaders,
  createPasskeyChallenge,
  parseAuthJson
} from "@/lib/commerce-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseAuthJson(request);
    const challenge = await createPasskeyChallenge(body);
    return Response.json(challenge, { status: 200, headers: authNoStoreHeaders() });
  } catch (error) {
    return authHttpError(error);
  }
}
