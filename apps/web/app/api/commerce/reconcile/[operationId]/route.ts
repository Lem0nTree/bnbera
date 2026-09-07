import { toErc8183PublicOperation } from "@bnbera/agent-commerce";
import {
  commerceActionResponse,
  commerceReconcileRequestSchema
} from "@/lib/commerce-contract";
import {
  commerceHttpError,
  commerceHttpJson,
  parseCommerceJson,
  parseCommerceOperationId
} from "@/lib/commerce-http";
import { getCommerceComposition } from "@/lib/commerce-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { readonly params: Promise<{ readonly operationId: string }> }
): Promise<Response> {
  try {
    const { operationId: rawOperationId } = await params;
    const operationId = parseCommerceOperationId(rawOperationId);
    await parseCommerceJson(request, commerceReconcileRequestSchema);
    const composition = await getCommerceComposition();
    const result = await composition.reconcile(request, operationId);
    const jobId = result.operation.jobId;
    const job = jobId === null ? null : await composition.readWithoutActor(jobId);
    return commerceHttpJson(commerceActionResponse({
      status: "reconciled",
      jobId,
      operationId: result.operation.operationId,
      operation: toErc8183PublicOperation(result.operation),
      job,
      dispatch: null
    }));
  } catch (error) {
    return commerceHttpError(error);
  }
}
