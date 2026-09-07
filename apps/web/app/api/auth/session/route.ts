import {
  authHttpError,
  authNoStoreHeaders,
  getAuthenticatedSession
} from "@/lib/commerce-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await getAuthenticatedSession(request);
    return Response.json(session === null ? { authenticated: false } : {
      authenticated: true,
      walletAddress: session.walletAddress,
      chainId: session.chainId,
      expiresAt: session.expiresAt.toISOString()
    }, { status: 200, headers: authNoStoreHeaders() });
  } catch (error) {
    return authHttpError(error);
  }
}
