import {
  authHttpError,
  authNoStoreHeaders,
  authenticateEoa,
  parseAuthJson
} from "@/lib/commerce-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verify the EOA's SIWE signature and issue the bounded HttpOnly session. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseAuthJson(request);
    const authenticated = await authenticateEoa(body);
    return Response.json({
      authenticated: true,
      walletAddress: authenticated.session.walletAddress,
      chainId: authenticated.session.chainId,
      expiresAt: authenticated.session.expiresAt.toISOString()
    }, {
      status: 200,
      headers: {
        ...authNoStoreHeaders(),
        "Set-Cookie": authenticated.setCookie
      }
    });
  } catch (error) {
    return authHttpError(error);
  }
}
