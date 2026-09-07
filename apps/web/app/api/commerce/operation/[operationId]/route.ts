import { toErc8183PublicOperation } from "@bnbera/agent-commerce";
import {
  commerceOperationStatusResponse
} from "@/lib/commerce-contract";
import {
  commerceHttpError,
  commerceHttpJson,
  parseCommerceOperationId
} from "@/lib/commerce-http";
import { getCommerceComposition } from "@/lib/commerce-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Reload a browser operation by durable ID; response is actor-bound server state. */
export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly operationId: string }> }
): Promise<Response> {
  try {
    const { operationId: rawOperationId } = await params;
    const operationId = parseCommerceOperationId(rawOperationId);
    const composition = await getCommerceComposition();
    const result = await composition.operationStatus(request, operationId);
    return commerceHttpJson(commerceOperationStatusResponse({
      operation: toErc8183PublicOperation(result.operation),
      job: result.read,
      dispatch: result.dispatch
    }));
  } catch (error) {
    return commerceHttpError(error);
  }
}
