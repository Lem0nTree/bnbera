import {
  authHttpError,
  authNoStoreHeaders,
  authenticatePasskey,
  parseAuthJson
} from "@/lib/commerce-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseAuthJson(request);
    const authenticated = await authenticatePasskey(body);
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
