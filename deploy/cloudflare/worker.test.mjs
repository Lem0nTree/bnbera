import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.mjs";
test("preserves browser caching only for successful immutable build assets", async () => {
  const original = globalThis.fetch;
  const env = { UPSTREAM_ORIGIN: "https://stable-origin.example", ORIGIN_ACCESS_CLIENT_ID: "id", ORIGIN_ACCESS_CLIENT_SECRET: "secret" };
  try {
    for (const [path, method, status, upstreamCache, expected] of [
      ["/_next/static/chunks/abc.js", "GET", 200, "public, max-age=31536000, immutable", "public, max-age=31536000, immutable"],
      ["/_next/static/css/abc.css", "HEAD", 200, "public, max-age=31536000, immutable", "public, max-age=31536000, immutable"],
      ["/_next/static/chunks/abc.js", "GET", 404, "immutable", "private, no-store"],
      ["/_next/static/chunks/abc.js", "GET", 200, "no-store", "public, max-age=31536000, immutable"],
      ["/_next/static/chunks/abc.js", "POST", 200, "immutable", "private, no-store"],
      ["/api/marketplace", "GET", 200, "immutable", "private, no-store"],
      ["/agents/example?_rsc=abc", "GET", 200, "immutable", "private, no-store"]
    ]) {
      globalThis.fetch = async () => new Response(null, { status, headers: { "Cache-Control": upstreamCache, "Content-Type": "application/javascript; charset=UTF-8" } });
      const response = await worker.fetch(new Request(`https://bnbera.ritarda.to${path}`, { method }), env);
      assert.equal(response.headers.get("Cache-Control"), expected);
    }
    globalThis.fetch = async () => new Response("Login", { headers: { "Content-Type": "text/html" } });
    const login = await worker.fetch(new Request("https://bnbera.ritarda.to/_next/static/chunks/abc.js"), env);
    assert.equal(login.headers.get("Cache-Control"), "private, no-store");
  } finally { globalThis.fetch = original; }
});
test("fails closed without a stable authenticated origin or for an unknown host", async () => {
  assert.equal((await worker.fetch(new Request("https://bnbera.ritarda.to/"), {})).status, 503);
  assert.equal((await worker.fetch(new Request("https://wrong.example/"), { UPSTREAM_ORIGIN: "https://origin.example" })).status, 421);
  assert.equal((await worker.fetch(new Request("https://bnbera.ritarda.to/"), { UPSTREAM_ORIGIN: "https://test.trycloudflare.com", ORIGIN_ACCESS_CLIENT_ID: "id", ORIGIN_ACCESS_CLIENT_SECRET: "secret" })).status, 503);
});
test("forwards cookies and public origin, replaces spoofed headers, rewrites redirects and does not cache", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url.toString(), "https://stable-origin.example/api/commerce?x=1");
      assert.equal(options.headers.get("Cookie"), "session=opaque");
      assert.equal(options.headers.get("Origin"), "https://bnbera.ritarda.to");
      assert.equal(options.headers.get("Referer"), "https://bnbera.ritarda.to/hired?job=7");
      assert.equal(options.headers.get("X-Forwarded-Host"), "bnbera.ritarda.to");
      assert.equal(options.headers.get("CF-Access-Client-Secret"), "installed-secret");
      assert.equal(options.headers.get("Forwarded"), null);
      assert.equal(options.redirect, "manual");
      const headers = new Headers({ Location: "https://stable-origin.example/my-hires" });
      headers.append("Set-Cookie", "session=opaque; Secure; HttpOnly; Path=/");
      headers.append("Set-Cookie", "CF_Authorization=origin-assertion; Secure; HttpOnly; Path=/");
      return new Response(null, { status: 302, headers });
    };
    const response = await worker.fetch(new Request("https://bnbera.ritarda.to/api/commerce?x=1", { headers: { Cookie: "session=opaque", Origin: "https://bnbera.ritarda.to", Referer: "https://bnbera.ritarda.to/hired?job=7", "X-Forwarded-Host": "evil.example", "CF-Access-Client-Secret": "attacker", Forwarded: "host=evil.example" } }), { UPSTREAM_ORIGIN: "https://stable-origin.example", ORIGIN_ACCESS_CLIENT_ID: "installed-id", ORIGIN_ACCESS_CLIENT_SECRET: "installed-secret" });
    assert.equal(response.headers.get("Location"), "https://bnbera.ritarda.to/my-hires");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.match(response.headers.get("Set-Cookie"), /HttpOnly/);
    assert.doesNotMatch(response.headers.get("Set-Cookie"), /CF_Authorization/);
  } finally { globalThis.fetch = original; }
});
test("does not translate an attacker-controlled origin", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.headers.get("Origin"), "https://evil.example");
      assert.equal(options.headers.get("Referer"), "https://evil.example/attack");
      return new Response("denied", { status: 403 });
    };
    const response = await worker.fetch(new Request("https://bnbera.ritarda.to/api/commerce", { headers: { Origin: "https://evil.example", Referer: "https://evil.example/attack" } }), { UPSTREAM_ORIGIN: "https://stable-origin.example", ORIGIN_ACCESS_CLIENT_ID: "installed-id", ORIGIN_ACCESS_CLIENT_SECRET: "installed-secret" });
    assert.equal(response.status, 403);
  } finally { globalThis.fetch = original; }
});
