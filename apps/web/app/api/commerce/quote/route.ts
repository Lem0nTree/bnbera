import {
  commerceQuoteRequestSchema,
  commerceQuoteResponse
} from "@/lib/commerce-reservations";
import {
  commerceHttpError,
  commerceHttpJson,
  parseCommerceJson
} from "@/lib/commerce-http";
import { getCommerceComposition } from "@/lib/commerce-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Create or replay a buyer-scoped quote reservation. The request contains
 * only a public listing identifier and task; the composition resolves the
 * current identity/version/service/provider/price from PostgreSQL.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input = await parseCommerceJson(request, commerceQuoteRequestSchema);
    const composition = await getCommerceComposition(request);
    const quote = await composition.createQuote(request, input);
    return commerceHttpJson(commerceQuoteResponse(quote));
  } catch (error) {
    return commerceHttpError(error);
  }
}
