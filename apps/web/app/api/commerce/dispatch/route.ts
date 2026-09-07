import { toErc8183PublicOperation } from "@bnbera/agent-commerce";
import {
  commerceActionResponse,
  commerceExternalDispatchRequestSchema
} from "@/lib/commerce-contract";
import {
  commerceHttpError,
  commerceHttpJson,
  parseCommerceJson
} from "@/lib/commerce-http";
import { getCommerceComposition } from "@/lib/commerce-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Attach browser-observed relay/receipt identifiers; never dispatch server-side. */
export async function POST(request: Request): Promise<Response> {
  try {
    const input = await parseCommerceJson(request, commerceExternalDispatchRequestSchema);
    const composition = await getCommerceComposition();
    const result = await composition.attachExternalExecution(request, input);
    return commerceHttpJson(commerceActionResponse({
      status: result.operation.status === "reconciled" || result.operation.status === "confirmed" ? "confirmed" : "pending",
      jobId: result.operation.jobId,
      operationId: result.operation.operationId,
      operation: toErc8183PublicOperation(result.operation),
      job: result.read,
      dispatch: result.dispatch
    }));
  } catch (error) {
    return commerceHttpError(error);
  }
}
