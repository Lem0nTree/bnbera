import { AppError } from "@bnbera/config";
import {
  marketplaceAgentReadResponseSchema,
  parseMarketplaceSearchParams
} from "@/lib/marketplace-contract";
import { readMarketplaceAgentApi } from "@/lib/marketplace-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params;
  try {
    const input = parseMarketplaceSearchParams(new URL(request.url).searchParams);
    const result = marketplaceAgentReadResponseSchema.parse(await readMarketplaceAgentApi(slug, { preview: input.preview }));
    return Response.json(result, {
      status: result.status === "error" ? 503 : result.status === "empty" ? 404 : 200,
      headers: { "Cache-Control": "no-store", Vary: "Accept" }
    });
  } catch (error) {
    const appError = error instanceof AppError
      ? error
      : new AppError({
          code: "MARKETPLACE_DETAIL_QUERY_INVALID",
          safeMessage: "The marketplace agent identifier could not be validated.",
          requestId: "req_web_marketplace_detail_api",
          nextAction: "check_agent_identifier",
          cause: error
        });
    return Response.json(appError.toEnvelope(), {
      status: 400,
      headers: { "Cache-Control": "no-store", Vary: "Accept" }
    });
  }
}
