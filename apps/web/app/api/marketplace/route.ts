import { AppError } from "@bnbera/config";
import {
  marketplaceSearchResponseSchema,
  parseMarketplaceSearchParams,
  readMarketplaceApi
} from "@/lib/marketplace-contract";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const input = parseMarketplaceSearchParams(new URL(request.url).searchParams);
    const result = marketplaceSearchResponseSchema.parse(await readMarketplaceApi(input));
    return Response.json(result, {
      status: result.status === "error" ? 503 : 200,
      headers: { "Cache-Control": "no-store", Vary: "Accept" }
    });
  } catch (error) {
    const appError = error instanceof AppError
      ? error
      : new AppError({
          code: "MARKETPLACE_QUERY_INVALID",
          safeMessage: "The marketplace query could not be validated.",
          requestId: "req_web_marketplace_api",
          nextAction: "check_query",
          cause: error
        });
    return Response.json(appError.toEnvelope(), {
      status: 400,
      headers: { "Cache-Control": "no-store", Vary: "Accept" }
    });
  }
}
