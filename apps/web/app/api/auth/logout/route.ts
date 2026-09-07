import {
  authHttpError,
  authNoStoreHeaders,
  clearAuthSessionCookie,
  revokeAuthenticatedSession
} from "@/lib/commerce-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    await revokeAuthenticatedSession(request);
    return Response.json({ authenticated: false }, {
      status: 200,
      headers: { ...authNoStoreHeaders(), "Set-Cookie": clearAuthSessionCookie() }
    });
  } catch (error) {
    return authHttpError(error);
  }
}
