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
      output.headers.set("Cache-Control", "private, no-store");
      const location = output.headers.get("Location");
      if (location) {
        const redirect = new URL(location, upstream);
        if (redirect.origin === upstream.origin) { redirect.hostname = publicHost; redirect.port = ""; output.headers.set("Location", redirect.toString()); }
      }
      return output;
    } catch { return new Response("Origin temporarily unavailable", { status: 502, headers: { "Cache-Control": "no-store" } }); }
  }
};
