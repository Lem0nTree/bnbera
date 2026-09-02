import { describe, expect, it } from "vitest";
import { BoundedServiceProbe, InMemoryIngestionRepository, type ServiceObservation } from "../index.js";

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
});
