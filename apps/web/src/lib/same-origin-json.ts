import { AppError } from "@bnbera/config";
/** SameSite cookies are not an origin check: an attacker-controlled sibling
 * subdomain is still same-site. Reject browser cross-origin JSON mutations. */
export function assertSameOriginJsonMutation(request: Request): void {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new AppError({ code: "REQUEST_ORIGIN_INVALID", safeMessage: "This action requires a same-origin JSON request.", requestId: "req_web_origin", nextAction: "retry_same_origin" });
  assertSameOriginMutation(request);
}
export function assertSameOriginMutation(request: Request): void {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  let valid = request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    // Next's server Request URL can contain the loopback/upstream origin behind
    // a trusted reverse proxy. APP_URL is the canonical browser origin.
    const expected = process.env.APP_URL ? new URL(process.env.APP_URL).origin : new URL(request.url).origin;
    valid &&= origin !== null ? origin === expected : referer === null || new URL(referer).origin === expected;
  } catch { valid = false; }
  if (!valid) throw new AppError({ code: "REQUEST_ORIGIN_INVALID", safeMessage: "This action requires a same-origin JSON request.", requestId: "req_web_origin", nextAction: "retry_same_origin" });
}
