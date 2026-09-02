import {
  serviceValidationStatusSchema,
  type ServiceValidationStatus
} from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import { assertSafePublicValue } from "./normalize.js";
import type {
  IngestionRepository,
  ServiceObservation,
  ServiceProbeRecord
} from "./types.js";

export type ServiceProbeTransportResponse = {
  readonly statusCode: number;
  readonly latencyMs: number;
  readonly safeCapabilityProbe?: Readonly<Record<string, unknown>>;
  readonly redirected?: boolean;
};

/**
 * Transport is supplied by the runtime so DNS, timeout, redirect, SSRF, and
 * response-size policy can be enforced in one infrastructure boundary. This
 * package never appends `/health`, `/a2a`, or `/apex` to an advertised URL.
 */
export interface ServiceProbeTransport {
  probe(input: {
    readonly url: string;
    readonly timeoutMs: number;
    readonly maxResponseBytes: number;
  }): Promise<ServiceProbeTransportResponse>;
}

export type ServiceProbeOptions = {
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly now?: () => Date;
};

export type ServiceProbeResult = ServiceProbeRecord;

export class BoundedServiceProbe {
  public constructor(
    private readonly transport: ServiceProbeTransport,
    private readonly options: ServiceProbeOptions = {}
  ) {}

  async probe(service: ServiceObservation): Promise<ServiceProbeResult> {
    this.assertUrl(service.url);
    const now = this.options.now?.() ?? new Date();
    const timeoutMs = this.options.timeoutMs ?? 5_000;
    const maxResponseBytes = this.options.maxResponseBytes ?? 64 * 1024;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
      throw ingestionError("SERVICE_PROBE_FAILED", "The service probe timeout is invalid.", "fix_probe_policy");
    }
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0 || maxResponseBytes > 1_048_576) {
      throw ingestionError("SERVICE_PROBE_FAILED", "The service probe response limit is invalid.", "fix_probe_policy");
    }
    try {
      const response = await this.transport.probe({
        url: service.url,
        timeoutMs,
        maxResponseBytes
      });
      const result = this.normalizeResponse(service, response, now);
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === "AppError") {
        throw error;
      }
      return {
        identityKey: service.identityKey,
        kind: service.kind,
        url: service.url,
        validationStatus: "unhealthy",
        statusCode: null,
        latencyMs: null,
        safeCapabilityProbe: null,
        errorCode: "SERVICE_TRANSPORT_FAILED",
        observedAt: now
      };
    }
  }

  async probeAndPersist(
    repository: IngestionRepository,
    service: ServiceObservation
  ): Promise<ServiceProbeResult> {
    const result = await this.probe(service);
    await repository.appendProbeResult(result);
    await repository.upsertService({
      ...service,
      validationStatus: result.validationStatus,
      observedAt: result.observedAt.toISOString(),
      ...(result.latencyMs === null ? { latencyMs: null } : { latencyMs: result.latencyMs }),
      ...(result.safeCapabilityProbe === null
        ? { safeCapabilityProbe: null }
        : { safeCapabilityProbe: result.safeCapabilityProbe })
    });
    return result;
  }

  private normalizeResponse(
    service: ServiceObservation,
    response: ServiceProbeTransportResponse,
    observedAt: Date
  ): ServiceProbeResult {
    if (
      !Number.isSafeInteger(response.statusCode) ||
      response.statusCode < 100 ||
      response.statusCode > 599 ||
      !Number.isSafeInteger(response.latencyMs) ||
      response.latencyMs < 0 ||
      response.latencyMs > 300_000
    ) {
      throw ingestionError("SERVICE_PROBE_FAILED", "The service probe returned invalid telemetry.", "retry_probe");
    }
    if (response.safeCapabilityProbe !== undefined) {
      assertSafePublicValue(response.safeCapabilityProbe, "serviceProbe");
    }
    const validationStatus: Extract<ServiceValidationStatus, "healthy" | "unhealthy" | "rejected"> =
      response.redirected === true
        ? "rejected"
        : response.statusCode >= 200 && response.statusCode < 300
          ? "healthy"
          : response.statusCode >= 300 && response.statusCode < 400
            ? "rejected"
            : "unhealthy";
    serviceValidationStatusSchema.parse(validationStatus);
    return {
      identityKey: service.identityKey,
      kind: service.kind,
      url: service.url,
      validationStatus,
      statusCode: response.statusCode,
      latencyMs: response.latencyMs,
      safeCapabilityProbe: response.safeCapabilityProbe ?? null,
      errorCode: validationStatus === "healthy" ? null : "SERVICE_STATUS_NOT_HEALTHY",
      observedAt
    };
  }

  private assertUrl(value: string): void {
    try {
      const url = new URL(value);
      if (
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        url.username !== "" ||
        url.password !== "" ||
        url.hash !== ""
      ) {
        throw new Error("unsupported service URL");
      }
    } catch (cause) {
      throw ingestionError("SERVICE_PROBE_FAILED", "The advertised service URL cannot be probed safely.", "review_service", cause);
    }
  }
}
