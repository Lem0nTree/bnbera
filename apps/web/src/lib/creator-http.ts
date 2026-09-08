import { randomUUID } from "node:crypto";
import { AppError } from "@bnbera/config";
import { CreatorAuthorityError } from "./creator-authority-runtime";
import { CreatorRepositoryError } from "./creator-repository";

export async function parseCreatorJson<T>(request: Request, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, options: { readonly maxBytes?: number } = {}): Promise<T> {
  const maxBytes = options.maxBytes;
  const contentLength = request.headers.get("content-length");
  if (maxBytes !== undefined && contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) throw new AppError({ code: "CREATOR_REQUEST_TOO_LARGE", safeMessage: "The Creator request is too large.", requestId: "req_creator", nextAction: "reduce_request" });
  }
  let body: unknown;
  try { body = await request.json(); } catch { throw new AppError({ code: "CREATOR_REQUEST_INVALID", safeMessage: "The Creator request must be valid JSON.", requestId: "req_creator", nextAction: "check_request" }); }
  if (maxBytes !== undefined) {
    const encoded = new TextEncoder().encode(JSON.stringify(body));
    if (encoded.byteLength > maxBytes) throw new AppError({ code: "CREATOR_REQUEST_TOO_LARGE", safeMessage: "The Creator request is too large.", requestId: "req_creator", nextAction: "reduce_request" });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError({ code: "CREATOR_REQUEST_INVALID", safeMessage: "Use the audited health-factor template fields only.", requestId: "req_creator", nextAction: "check_request" });
  return parsed.data;
}

/** Browser mutations must use JSON and may not arrive from another origin. */
export function assertCreatorMutationRequest(request: Request): void {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new AppError({ code: "CREATOR_REQUEST_INVALID", safeMessage: "The Creator request must use JSON.", requestId: "req_creator", nextAction: "check_request" });
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  if ((origin !== null && origin !== expectedOrigin) || (origin === null && referer !== null && new URL(referer).origin !== expectedOrigin) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AppError({ code: "CREATOR_CSRF_REJECTED", safeMessage: "The Creator request origin is not allowed.", requestId: "req_creator", nextAction: "retry_same_origin" });
  }
}

export function creatorJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", Vary: "Accept" } });
}

export function creatorHttpError(error: unknown): Response {
  const requestId = randomUUID();
  const code = error instanceof CreatorAuthorityError || error instanceof CreatorRepositoryError ? error.code : error instanceof AppError ? error.code : "CREATOR_UNAVAILABLE";
  const safeMessage = error instanceof CreatorAuthorityError || error instanceof CreatorRepositoryError ? error.message
    : error instanceof AppError ? error.toEnvelope().error.message
      : "Creator is temporarily unavailable.";
  const status = code === "AUTH_REQUIRED" ? 401 : code === "CREATOR_CSRF_REJECTED" ? 403 : code === "CREATOR_REQUEST_TOO_LARGE" ? 413 : code === "DRAFT_NOT_FOUND" || code === "CREATOR_AUTHORITY_NOT_FOUND" ? 404 : code === "IDEMPOTENCY_CONFLICT" || code === "CREATOR_AUTHORITY_EXISTS" ? 409 : code.includes("AUTHORITY") || code.includes("UNAVAILABLE") ? 503 : 400;
  return creatorJson({ error: { code, safeMessage, requestId, retriable: status >= 500 } }, status);
}
