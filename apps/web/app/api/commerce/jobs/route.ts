import {
  getCommerceAuthDatabasePool,
  requireAuthenticatedCommerceIdentity
} from "@/lib/commerce-auth";
import {
  listBuyerJobs,
  parseCommerceJobsQuery
} from "@/lib/commerce-job-list";
import { commerceHttpError, commerceHttpJson } from "@/lib/commerce-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const identity = await requireAuthenticatedCommerceIdentity(request);
    const response = await listBuyerJobs(
      getCommerceAuthDatabasePool(),
      identity.userId,
      parseCommerceJobsQuery(request.url)
    );
    return commerceHttpJson(response);
  } catch (error) {
    return commerceHttpError(error);
  }
}
