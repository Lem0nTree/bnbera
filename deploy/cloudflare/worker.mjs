/** Edge-only proxy. Keep the Node application, PostgreSQL and bounded workers
 * on a supervised durable origin; this Worker never receives database keys. */
export default {
  async fetch(request, env) {
    let upstream;
    try { upstream = new URL(env.UPSTREAM_ORIGIN); } catch { return new Response("Origin not configured", { status: 503 }); }
    const incoming = new URL(request.url);
    const publicHost = "bnbera.ritarda.to";
    if (incoming.hostname !== publicHost || incoming.protocol !== "https:") return new Response("Unknown host", { status: 421 });
    if (upstream.protocol !== "https:" || upstream.username || upstream.password || upstream.pathname !== "/" || upstream.search || upstream.hash || upstream.hostname === publicHost || upstream.hostname.endsWith(".trycloudflare.com") || !env.ORIGIN_ACCESS_CLIENT_ID || !env.ORIGIN_ACCESS_CLIENT_SECRET) return new Response("Origin not configured", { status: 503 });
    upstream.pathname = incoming.pathname; upstream.search = incoming.search;
    const headers = new Headers(request.headers);
    for (const name of ["forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-for", "cf-access-client-id", "cf-access-client-secret", "cf-access-jwt-assertion"]) headers.delete(name);
    headers.set("X-Forwarded-Host", publicHost); headers.set("X-Forwarded-Proto", "https");
    headers.set("CF-Access-Client-Id", env.ORIGIN_ACCESS_CLIENT_ID);
    headers.set("CF-Access-Client-Secret", env.ORIGIN_ACCESS_CLIENT_SECRET);
    try {
      const response = await fetch(upstream, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body, redirect: "manual", cf: { cacheEverything: false, cacheTtl: 0 } });
      const output = new Response(response.body, response);
      // Next's build-addressed assets are safe to reuse in the browser. Keep
      // HTML, RSC, APIs, redirects and failures private and uncached.
      const immutableAsset = ["GET", "HEAD"].includes(request.method)
        && /^\/_next\/static\/[a-zA-Z0-9_./-]+$/u.test(incoming.pathname)
        && response.status === 200
        // Access may replace the origin's Cache-Control. Check the asset
        // MIME type too so an Access login/error HTML response is never cached.
        && /^(?:(?:application|text)\/(?:javascript|x-javascript)|text\/css|font\/[a-z0-9-]+|image\/[a-z0-9.+-]+)(?:;|$)/iu.test(response.headers.get("Content-Type") ?? "");
      output.headers.set("Cache-Control", immutableAsset ? "public, max-age=31536000, immutable" : "private, no-store");
      // Access authenticates the Worker to the private origin. Its assertion
      // cookies are edge credentials and must never be forwarded to browsers.
      const responseCookies = typeof output.headers.getSetCookie === "function" ? output.headers.getSetCookie() : [];
      if (responseCookies.length) {
        output.headers.delete("Set-Cookie");
        for (const cookie of responseCookies) if (!/^CF_(?:Authorization|AppSession)=/iu.test(cookie)) output.headers.append("Set-Cookie", cookie);
      }
      const location = output.headers.get("Location");
      if (location) {
        const redirect = new URL(location, upstream);
        if (redirect.origin === upstream.origin) { redirect.hostname = publicHost; redirect.port = ""; output.headers.set("Location", redirect.toString()); }
      }
      return output;
    } catch { return new Response("Origin temporarily unavailable", { status: 502, headers: { "Cache-Control": "no-store" } }); }
  }
};
