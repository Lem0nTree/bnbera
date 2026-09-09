import { describe, expect, it } from "vitest";
import { BoundedServiceProbe, HttpServiceProbeTransport, InMemoryIngestionRepository, type ServiceObservation } from "../index.js";

const service: ServiceObservation = {
  identityKey: "eip155:97:0x1111111111111111111111111111111111111111:1",
  kind: "mcp",
  url: "https://agent.example/mcp",
  protocolVersion: "2025-06-18",
  discoverySource: "manual",
  validationStatus: "pending",
  observedAt: "2026-09-02T00:00:00.000Z",
  latencyMs: null,
  safeCapabilityProbe: null,
  capabilityManifestDigest: null
};

describe("bounded advertised-service probes", () => {
  it.each(["valid", "secret", "depth", "bytes"])("bounds A2A extension schemas (%s) without persisting them", async violation => {
    let schema: unknown = { type: "number" };
    for (let i = 0; i < (violation === "depth" ? 35 : 7); i++) schema = { type: "object", properties: { value: schema } };
    const card = { name: "Grid planner", description: "Publishes a read-only grid.", version: "1.0", protocolVersion: "0.3.0", preferredTransport: "JSONRPC", url: "https://agent.example/",
      capabilities: { streaming: false, extensions: [{ uri: "https://agent.example/schema/v1", params: { grid: schema }, ...(violation === "secret" ? { api_key: "must-not-persist" } : {}) }] },
      skills: [{ id: "negotiate", name: "Negotiate", description: "Returns a quote.", tags: ["erc8183"] }],
      ...(violation === "bytes" ? { extra: "x".repeat(5000) } : {}) };
    const methods: string[] = [];
    const transport = new HttpServiceProbeTransport({ lookup: async () => [{ address: "93.184.216.34", family: 4 }], fetch: async (_url, init) => { methods.push(init?.method ?? "GET"); return Response.json(card); } });
    const pending = transport.probe({ kind: "a2a", url: "https://agent.example/.well-known/agent-card.json", timeoutMs: 2000, maxResponseBytes: 4096 });
    if (violation === "valid") {
      const result = await pending;
      expect(result).toMatchObject({ contractStatus: "healthy", safeCapabilityProbe: { skillCount: 1, capabilityEvidence: "advertised-only", invocationUrls: ["https://agent.example/"] } });
      expect(JSON.stringify(result)).not.toContain("extensions");
      expect(JSON.stringify(result)).not.toContain("properties");
    } else await expect(pending).rejects.toMatchObject({code: violation === "bytes" ? "SERVICE_RESPONSE_TOO_LARGE" : "SERVICE_A2A_AGENT_CARD_INVALID"});
    expect(methods).toEqual(["GET"]);
  });

  it("accepts bounded nested MCP tool schemas without persisting their wire bodies", async () => {
    const nested = (depth: number): unknown => depth ? { type: "object", properties: { data: nested(depth - 1) } } : { type: "string" };
    const tools = Array.from({ length: 19 }, (_, index) => ({ name: `readVault${index}`, inputSchema: { type: "object" }, outputSchema: nested(7) }));
    const methods: string[] = [];
    const transport = new HttpServiceProbeTransport({ lookup: async () => [{ address: "93.184.216.34", family: 4 }], fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body)); methods.push(request.method);
      if (!request.id) return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: request.id, result: request.method === "initialize"
        ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "nested-schema-server", version: "1.0.0" } }
        : { tools } });
    } });
    const result = await transport.probe({ kind: "mcp", url: service.url, timeoutMs: 2000, maxResponseBytes: 1024 * 1024 });
    expect(result).toMatchObject({ contractStatus: "healthy", safeCapabilityProbe: { capabilityCount: 19, toolInvocationPerformed: false } });
    expect(JSON.stringify(result)).not.toContain("outputSchema");
    expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list"]);
  });

  it.each(["secret", "depth", "bytes", "request-id"])("rejects MCP %s boundary violations", async (violation) => {
    let output: unknown = { type: "string" };
    for (let i = 0; i < (violation === "depth" ? 35 : 1); i++) output = { nested: output };
    const transport = new HttpServiceProbeTransport({ lookup: async () => [{ address: "93.184.216.34", family: 4 }], fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      if (!request.id) return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: violation === "request-id" ? 999 : request.id, result: request.method === "initialize"
        ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "test", version: "1" } }
        : { tools: [{ name: "readVault", inputSchema: { type: "object" }, outputSchema: output, ...(violation === "secret" ? { access_token: "sensitive" } : {}), ...(violation === "bytes" ? { description: "x".repeat(5000) } : {}) }] } });
    } });
    const result = await transport.probe({ kind: "mcp", url: service.url, timeoutMs: 2000, maxResponseBytes: 4096 });
    expect(result.contractStatus).toBe("unhealthy");
    expect(result.safeCapabilityProbe).toBeUndefined();
  });

  it("probes exactly the advertised URL and persists a safe result", async () => {
    const calls: string[] = [];
    const repository = new InMemoryIngestionRepository();
    const probe = new BoundedServiceProbe(
      {
        async probe(input) {
          calls.push(input.url);
          expect(input.timeoutMs).toBe(2_000);
          expect(input.maxResponseBytes).toBe(4_096);
          return {
            statusCode: 200,
            latencyMs: 42,
            safeCapabilityProbe: { protocol: "mcp" }
          };
        }
      },
      { timeoutMs: 2_000, maxResponseBytes: 4_096, now: () => new Date("2026-09-02T00:00:00.000Z") }
    );
    const result = await probe.probeAndPersist(repository, service);

    expect(calls).toEqual(["https://agent.example/mcp"]);
    expect(result.validationStatus).toBe("healthy");
    expect((await repository.listProbeResults(service.identityKey))).toHaveLength(1);
    expect((await repository.listServices(service.identityKey))[0]?.validationStatus).toBe("healthy");
  });

  it("rejects redirects and never follows a hidden universal route", async () => {
    let calledUrl = "";
    const probe = new BoundedServiceProbe({
      async probe(input) {
        calledUrl = input.url;
        return { statusCode: 302, latencyMs: 4, redirected: true };
      }
    });
    const result = await probe.probe(service);

    expect(calledUrl).toBe(service.url);
    expect(result.validationStatus).toBe("rejected");
    expect(result.errorCode).toBe("SERVICE_STATUS_NOT_HEALTHY");
  });

  it("does not mistake MCP HTTP405 for protocol verification and blocks private DNS targets", async () => {
    const calls: string[] = [];
    const transport = new HttpServiceProbeTransport({
      fetch: async (input) => {
        calls.push(String(input));
        return new Response(null, { status: 405 });
      },
      lookup: async () => [{ address: "93.184.216.34", family: 4 }]
    });
    const response = await transport.probe({ kind: service.kind, url: service.url, timeoutMs: 2_000, maxResponseBytes: 4_096 });
    expect(response).toMatchObject({ statusCode: 405, contractStatus: "unhealthy" });
    expect(calls).toEqual([service.url]);
    await expect(transport.probe({ url: "https://127.0.0.1/metadata", timeoutMs: 2_000, maxResponseBytes: 4_096 })).rejects.toThrow(/private|network/i);
  });

  it("validates the read-only A2A Agent Card contract and rejects generic JSON", async () => {
    const card = {
      name: "Example agent",
      description: "A public test agent.",
      version: "1.0.0",
      supportedInterfaces: [{
        url: "https://agent.example/a2a",
        protocolBinding: "JSONRPC",
        protocolVersion: "0.3"
      }],
      capabilities: { streaming: false },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [{ id: "status", name: "Status", description: "Reports status.", tags: ["health"] }]
    };
    const transport = new HttpServiceProbeTransport({
      fetch: async () => new Response(JSON.stringify(card), { status: 200, headers: { "content-type": "application/a2a+json" } }),
      lookup: async () => [{ address: "93.184.216.34", family: 4 }]
    });
    const response = await transport.probe({ kind: "a2a", url: "https://agent.example/.well-known/agent-card.json", timeoutMs: 2_000, maxResponseBytes: 4_096 });
    expect(response).toMatchObject({
      statusCode: 200,
      contractStatus: "healthy",
      safeCapabilityProbe: {
        protocol: "a2a",
        contract: "agent-card",
        skillCount: 1,
        interfaceCount: 1,
        cardUrl: "https://agent.example/.well-known/agent-card.json",
        invocationUrls: ["https://agent.example/a2a"],
        capabilityEvidence: "advertised-only",
        skills: [{ id: "status", name: "Status", description: "Reports status.", tags: ["health"] }]
      }
    });

    const genericJson = new HttpServiceProbeTransport({
      fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
      lookup: async () => [{ address: "93.184.216.34", family: 4 }]
    });
    await expect(genericJson.probe({ kind: "a2a", url: "https://agent.example/.well-known/agent-card.json", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .rejects.toMatchObject({ code: "SERVICE_A2A_AGENT_CARD_INVALID" });
  });

  it("retains bounded public A2A skill keywords as advertised metadata", async () => {
    const card = {
      name: "Grid agent",
      description: "A public test agent.",
      version: "1.0.0",
      supportedInterfaces: [{
        url: "https://agent.example/a2a",
        protocolBinding: "JSONRPC",
        protocolVersion: "0.3"
      }],
      capabilities: { streaming: false },
      skills: [{
        id: "strategy",
        name: "Strategy",
        description: "Publishes an advertised strategy label.",
        tags: ["grid"],
        keywords: ["grid-trading", "grid-trading"]
      }]
    };
    const transport = new HttpServiceProbeTransport({
      fetch: async () => new Response(JSON.stringify(card), { status: 200, headers: { "content-type": "application/a2a+json" } }),
      lookup: async () => [{ address: "93.184.216.34", family: 4 }]
    });
    await expect(transport.probe({ kind: "a2a", url: "https://agent.example/.well-known/agent-card.json", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .resolves.toMatchObject({
        contractStatus: "healthy",
        safeCapabilityProbe: {
          capabilityEvidence: "advertised-only",
          skills: [{ tags: ["grid"], keywords: ["grid-trading"] }]
        }
      });

    const unsafe = new HttpServiceProbeTransport({
      fetch: async () => new Response(JSON.stringify({
        ...card,
        skills: [{ ...card.skills[0], keywords: [{ secret: "must-not-be-consumed" }] }]
      }), { status: 200, headers: { "content-type": "application/a2a+json" } }),
      lookup: async () => [{ address: "93.184.216.34", family: 4 }]
    });
    await expect(unsafe.probe({ kind: "a2a", url: "https://agent.example/.well-known/agent-card.json", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .rejects.toMatchObject({ code: "SERVICE_A2A_AGENT_CARD_INVALID" });

    const missingTags = new HttpServiceProbeTransport({
      fetch: async () => new Response(JSON.stringify({
        ...card,
        skills: [{ ...card.skills[0], tags: undefined }]
      }), { status: 200, headers: { "content-type": "application/a2a+json" } }),
      lookup: async () => [{ address: "93.184.216.34", family: 4 }]
    });
    await expect(missingTags.probe({ kind: "a2a", url: "https://agent.example/.well-known/agent-card.json", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .rejects.toMatchObject({ code: "SERVICE_A2A_AGENT_CARD_INVALID" });

    for (const invalidTag of ["grid\u0000trading", "grid\ntrading"]) {
      const controls = new HttpServiceProbeTransport({
        fetch: async () => new Response(JSON.stringify({
          ...card,
          skills: [{ ...card.skills[0], tags: [invalidTag] }]
        }), { status: 200, headers: { "content-type": "application/a2a+json" } }),
        lookup: async () => [{ address: "93.184.216.34", family: 4 }]
      });
      await expect(controls.probe({ kind: "a2a", url: "https://agent.example/.well-known/agent-card.json", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
        .rejects.toMatchObject({ code: "SERVICE_A2A_AGENT_CARD_INVALID" });
    }
  });

  it("requires structured adapter capability evidence instead of marker-only JSON", async () => {
    const invalid = new HttpServiceProbeTransport({
      fetch: async () => new Response(JSON.stringify({ protocol: "vendor", capabilities: { status: true } }), { status: 200, headers: { "content-type": "application/json" } }),
      lookup: async () => [{ address: "93.184.216.34", family: 4 }]
    });
    await expect(invalid.probe({ kind: "adapter", url: "https://agent.example/adapter", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .rejects.toMatchObject({ code: "SERVICE_ADAPTER_CONTRACT_INVALID" });

    const valid = new HttpServiceProbeTransport({
      fetch: async () => new Response(JSON.stringify({
        protocol: "vendor-read-only-v1",
        capabilities: [{ id: "health", description: "Reports public health." }]
      }), { status: 200, headers: { "content-type": "application/json" } }),
      lookup: async () => [{ address: "93.184.216.34", family: 4 }]
    });
    await expect(valid.probe({ kind: "adapter", url: "https://agent.example/adapter", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .resolves.toMatchObject({
        contractStatus: "healthy",
        safeCapabilityProbe: {
          capabilityEvidence: "advertised-only",
          capabilityCount: 1,
          capabilityIds: ["health"]
        }
      });
  });

  it("rejects A2A invocation URLs that resolve to loopback or private targets", async () => {
    const card = {
      name: "Example agent",
      description: "A public test agent.",
      version: "1.0.0",
      supportedInterfaces: [{
        url: "https://127.0.0.1/invoke",
        protocolBinding: "JSONRPC",
        protocolVersion: "0.3"
      }],
      capabilities: { streaming: false },
      skills: [{ id: "status", name: "Status", description: "Reports status.", tags: ["health"] }]
    };
    const loopback = new HttpServiceProbeTransport({
      fetch: async () => new Response(JSON.stringify(card), { status: 200, headers: { "content-type": "application/a2a+json" } }),
      lookup: async () => [{ address: "93.184.216.34", family: 4 }]
    });
    await expect(loopback.probe({ kind: "a2a", url: "https://agent.example/.well-known/agent-card.json", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .rejects.toMatchObject({ code: "SERVICE_A2A_AGENT_CARD_INVALID" });

    const privateHost = new HttpServiceProbeTransport({
      fetch: async () => new Response(JSON.stringify({
        ...card,
        supportedInterfaces: [{ ...card.supportedInterfaces[0], url: "https://invoke.internal/a2a" }]
      }), { status: 200, headers: { "content-type": "application/a2a+json" } }),
      lookup: async (hostname) => [{ address: hostname === "invoke.internal" ? "10.0.0.7" : "93.184.216.34", family: 4 }]
    });
    await expect(privateHost.probe({ kind: "a2a", url: "https://agent.example/.well-known/agent-card.json", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .rejects.toMatchObject({ code: "SERVICE_A2A_AGENT_CARD_INVALID" });
  });

  it("rejects transport-only MCP responses, validates readiness, and never guesses auth", async () => {
    const lookup = async () => [{ address: "93.184.216.34", family: 4 }] as const;
    const mcp405 = new HttpServiceProbeTransport({ fetch: async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return new Response(null, { status: 405 });
    }, lookup });
    await expect(mcp405.probe({ kind: "mcp", url: "https://agent.example/mcp", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .resolves.toMatchObject({ contractStatus: "unhealthy" });

    const mcpSse = new HttpServiceProbeTransport({
      fetch: async () => new Response("event: ready\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }),
      lookup
    });
    await expect(mcpSse.probe({ kind: "mcp", url: "https://agent.example/mcp", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .resolves.toMatchObject({ contractStatus: "unhealthy", errorCode: "SERVICE_MCP_CONTRACT_INVALID" });

    const readiness = new HttpServiceProbeTransport({
      fetch: async () => new Response(JSON.stringify({ status: "not_ready" }), { status: 200, headers: { "content-type": "application/json" } }),
      lookup
    });
    await expect(readiness.probe({ kind: "readiness", url: "https://agent.example/ready", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .resolves.toMatchObject({ contractStatus: "unhealthy", errorCode: "SERVICE_READINESS_NOT_READY" });

    const protectedService = new HttpServiceProbeTransport({
      fetch: async (_input, init) => {
        expect(new Headers(init?.headers).has("authorization")).toBe(false);
        return new Response(null, { status: 401 });
      },
      lookup
    });
    await expect(protectedService.probe({ kind: "readiness", url: "https://agent.example/ready", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .resolves.toMatchObject({ contractStatus: "unhealthy", errorCode: "SERVICE_AUTH_REQUIRED" });
  });

  it("accepts an x402 challenge without sending payment and rejects unsafe transports", async () => {
    const challenge = Buffer.from(JSON.stringify({
      x402Version: 2,
      accepts: [{ scheme: "exact", network: "eip155:8453", amount: "1000", asset: "USDC" }]
    }), "utf8").toString("base64");
    const transport = new HttpServiceProbeTransport({
      fetch: async (_input, init) => {
        expect(init?.method).toBe("GET");
        expect(new Headers(init?.headers).has("payment-signature")).toBe(false);
        return new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": challenge } });
      },
      lookup: async () => [{ address: "93.184.216.34", family: 4 }]
    });
    await expect(transport.probe({ kind: "x402", url: "https://agent.example/pay", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .resolves.toMatchObject({ contractStatus: "healthy", safeCapabilityProbe: { protocol: "x402", x402Version: 2, acceptedMethods: 1 } });

    const insecure = new HttpServiceProbeTransport({
      allowInsecureHttp: true,
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      fetch: async () => new Response(JSON.stringify({ status: "ready" }), { status: 200, headers: { "content-type": "application/json" } })
    });
    await expect(insecure.probe({ kind: "readiness", url: "http://agent.example/ready", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .resolves.toMatchObject({ contractStatus: "healthy" });
    const productionTransport = new HttpServiceProbeTransport({
      lookup: async () => [{ address: "93.184.216.34", family: 4 }]
    });
    await expect(productionTransport.probe({ kind: "readiness", url: "http://agent.example/ready", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .rejects.toMatchObject({ code: "SERVICE_HTTPS_REQUIRED" });
  });

  it("fails closed on DNS changes, redirects, MIME, and response-size violations", async () => {
    let lookupCount = 0;
    const rebinding = new HttpServiceProbeTransport({
      fetch: async () => new Response(JSON.stringify({ status: "ready" }), { status: 200, headers: { "content-type": "application/json" } }),
      lookup: async () => {
        lookupCount += 1;
        return [{ address: lookupCount === 1 ? "93.184.216.34" : "93.184.216.35", family: 4 }];
      }
    });
    await expect(rebinding.probe({ kind: "readiness", url: "https://agent.example/ready", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .rejects.toMatchObject({ code: "SERVICE_DNS_REBINDING" });

    const redirected = new HttpServiceProbeTransport({
      maxRedirects: 1,
      fetch: async () => new Response(null, { status: 302, headers: { location: "https://private.example/ready" } }),
      lookup: async (hostname) => [{ address: hostname === "private.example" ? "10.0.0.1" : "93.184.216.34", family: 4 }]
    });
    await expect(redirected.probe({ kind: "readiness", url: "https://agent.example/ready", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .rejects.toMatchObject({ code: "SERVICE_SSRF_BLOCKED" });

    const unsupportedMime = new HttpServiceProbeTransport({
      fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "text/html" } }),
      lookup: async () => [{ address: "93.184.216.34", family: 4 }]
    });
    await expect(unsupportedMime.probe({ kind: "readiness", url: "https://agent.example/ready", timeoutMs: 2_000, maxResponseBytes: 4_096 }))
      .rejects.toMatchObject({ code: "SERVICE_MIME_UNSUPPORTED" });

    const oversized = new HttpServiceProbeTransport({
      fetch: async () => new Response(JSON.stringify({ status: "ready", padding: "123456789" }), { status: 200, headers: { "content-type": "application/json" } }),
      lookup: async () => [{ address: "93.184.216.34", family: 4 }]
    });
    await expect(oversized.probe({ kind: "readiness", url: "https://agent.example/ready", timeoutMs: 2_000, maxResponseBytes: 8 }))
      .rejects.toMatchObject({ code: "SERVICE_RESPONSE_TOO_LARGE" });
  });

  it("isolates services while bounding concurrency and request-start rate", async () => {
    const services = [0, 1, 2, 3].map((index) => ({
      ...service,
      kind: "readiness" as const,
      url: `https://agent.example/ready/${index}`
    }));
    let active = 0;
    let maximumActive = 0;
    let clock = 0;
    const starts: number[] = [];
    const probe = new BoundedServiceProbe({
      async probe(input) {
        starts.push(clock);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        active -= 1;
        if (input.url.endsWith("/1")) throw new Error("one endpoint failed");
        return { statusCode: 200, latencyMs: 1, contractStatus: "healthy", safeCapabilityProbe: { protocol: "readiness" } };
      }
    });
    const results = await probe.probeMany(services, {
      maxConcurrency: 2,
      minIntervalMs: 10,
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; }
    });
    expect(results).toHaveLength(4);
    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(results.map((result) => result.validationStatus)).toEqual(["healthy", "unhealthy", "healthy", "healthy"]);
    expect(starts).toEqual([0, 10, 20, 30]);
    expect(results[1]?.errorCode).toBe("SERVICE_TRANSPORT_FAILED");
  });
});
