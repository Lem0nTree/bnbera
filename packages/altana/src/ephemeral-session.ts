import { AltanaBoundaryError } from "./errors.ts";
import { assertPolicyValidAt } from "./policy.ts";
import type {
  HexString,
  PublicSessionHandoffReceipt,
  RuntimeSessionDescriptor,
  SecretReference,
  SessionHandoffReceipt,
} from "./types.ts";

/**
 * A deliberately non-serializable holder for the runtime session returned by
 * an external Altana adapter.  It provides a one-time consume operation for
 * the Studio/AWS secret sink and zeroes the local byte buffer afterwards.
 *
 * This is a containment aid, not a replacement for an OS/cloud secret store.
 * The sink implementation still has to avoid logging, persisting, or
 * returning the supplied bytes.
 */
export class EphemeralSessionMaterial {
  #bytes: Uint8Array | undefined;
  #consumed = false;

  constructor(bytes: Uint8Array) {
    if (bytes.byteLength === 0) {
      throw new AltanaBoundaryError(
        "SESSION_MATERIAL_EMPTY",
        "A runtime session handoff cannot contain empty material.",
      );
    }
    this.#bytes = new Uint8Array(bytes);
  }

  get consumed(): boolean {
    return this.#consumed;
  }

  /** Consume the bytes once. The caller must zero them after the sink returns. */
  consume(): Uint8Array {
    if (this.#bytes === undefined || this.#consumed) {
      throw new AltanaBoundaryError(
        "SESSION_MATERIAL_CONSUMED",
        "Runtime session material is one-time and is no longer available.",
      );
    }
    this.#consumed = true;
    const bytes = this.#bytes;
    this.#bytes = undefined;
    return bytes;
  }

  /** Drop an unconsumed buffer without exposing it. */
  dispose(): void {
    if (this.#bytes !== undefined) this.#bytes.fill(0);
    this.#bytes = undefined;
    this.#consumed = true;
  }

  /** Prevent accidental interpolation into logs, JSON, or error messages. */
  toString(): string {
    return "[REDACTED_EPHEMERAL_SESSION]";
  }

  toJSON(): { redacted: true } {
    return { redacted: true };
  }
}

export interface RuntimeSessionSecretSink {
  /**
   * Store the bytes in the approved delegated Studio/AWS secret path. The
   * implementation must not retain them in the returned receipt or logs.
   */
  putRuntimeSession(input: {
    readonly bytes: Uint8Array;
    readonly descriptor: RuntimeSessionDescriptor;
    readonly destination: SecretReference;
  }): Promise<SessionHandoffReceipt>;
}

const APPROVED_DESTINATION_PROVIDERS = new Set<SecretReference["provider"]>([
  "studio-delegated-secret-channel",
  "aws-secrets-manager",
  "local-test-only",
]);
const SAFE_PUBLIC_REFERENCE = /^\S.{0,511}$/s;
const SAFE_HANDOFF_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH_32 = /^0x[a-fA-F0-9]{64}$/;

function assertApprovedDestination(destination: SecretReference): void {
  if (
    destination === null ||
    typeof destination !== "object" ||
    !APPROVED_DESTINATION_PROVIDERS.has(destination.provider) ||
    typeof destination.reference !== "string" ||
    !SAFE_PUBLIC_REFERENCE.test(destination.reference)
  ) {
    throw new AltanaBoundaryError(
      "SESSION_HANDOFF_FAILED",
      "The runtime session destination is not an approved typed destination.",
    );
  }
}

function normalizePolicyDigest(policyDigest: string | null, label: string): HexString | null {
  if (policyDigest === null) return null;
  if (!HASH_32.test(policyDigest)) {
    throw new AltanaBoundaryError(
      "SESSION_HANDOFF_FAILED",
      `${label} is not a valid public policy digest.`,
    );
  }
  return `0x${policyDigest.slice(2).toLowerCase()}` as HexString;
}

function assertUnixTime(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AltanaBoundaryError("SESSION_HANDOFF_FAILED", `${label} must be a positive Unix-second integer.`);
  }
}

export async function handoffRuntimeSession(input: {
  readonly material: EphemeralSessionMaterial;
  readonly descriptor: RuntimeSessionDescriptor;
  readonly destination: SecretReference;
  readonly sink: RuntimeSessionSecretSink;
  readonly nowUnix?: number;
}): Promise<SessionHandoffReceipt> {
  const nowUnix = input.nowUnix ?? Math.floor(Date.now() / 1000);
  assertUnixTime(nowUnix, "Handoff time");
  if (input.descriptor.secretReference !== null) {
    throw new AltanaBoundaryError(
      "SESSION_HANDOFF_FAILED",
      "A descriptor cannot already contain a destination secret value or reference.",
    );
  }
  assertPolicyValidAt(input.descriptor.policy, nowUnix);
  assertUnixTime(input.descriptor.grantedAtUnix, "Grant time");
  if (
    input.descriptor.grantedAtUnix > nowUnix ||
    input.descriptor.grantedAtUnix >= input.descriptor.policy.expiresAtUnix
  ) {
    throw new AltanaBoundaryError(
      "SESSION_HANDOFF_FAILED",
      "The runtime session grant time is outside the unexpired session window.",
    );
  }
  const descriptorPolicyDigest = normalizePolicyDigest(
    input.descriptor.policyDigest,
    "Descriptor policy digest",
  );
  assertApprovedDestination(input.destination);
  if (!SAFE_HANDOFF_ID.test(input.descriptor.sessionId)) {
    throw new AltanaBoundaryError(
      "SESSION_HANDOFF_FAILED",
      "The runtime session identifier is not a safe public identifier.",
    );
  }
  if (input.sink === null || typeof input.sink.putRuntimeSession !== "function") {
    throw new AltanaBoundaryError(
      "SESSION_HANDOFF_FAILED",
      "A runtime session requires an approved secret sink.",
    );
  }

  if (!(input.material instanceof EphemeralSessionMaterial)) {
    throw new AltanaBoundaryError(
      "SESSION_HANDOFF_FAILED",
      "A runtime session handoff requires the one-time material wrapper.",
    );
  }
  const bytes = input.material.consume();
  try {
    const receipt = await input.sink.putRuntimeSession({
      bytes,
      descriptor: input.descriptor,
      destination: input.destination,
    });

    if (receipt === null || typeof receipt !== "object" || receipt.consumed !== true) {
      throw new AltanaBoundaryError(
        "SESSION_HANDOFF_FAILED",
        "The secret sink did not confirm one-time consumption.",
      );
    }
    if (
      receipt.destination === null ||
      typeof receipt.destination !== "object" ||
      receipt.destination.provider !== input.destination.provider ||
      receipt.destination.reference !== input.destination.reference ||
      receipt.sessionId !== input.descriptor.sessionId ||
      !SAFE_HANDOFF_ID.test(receipt.handoffId) ||
      typeof receipt.acceptedAtUnix !== "number"
    ) {
      throw new AltanaBoundaryError(
        "SESSION_HANDOFF_FAILED",
        "The secret sink receipt is not bound to the approved destination or session.",
      );
    }
    assertApprovedDestination(receipt.destination);
    const receiptPolicyDigest = normalizePolicyDigest(receipt.policyDigest, "Receipt policy digest");
    if (receiptPolicyDigest !== descriptorPolicyDigest) {
      throw new AltanaBoundaryError(
        "SESSION_HANDOFF_FAILED",
        "The secret sink receipt policy digest is not bound to the granted session.",
      );
    }
    assertUnixTime(receipt.acceptedAtUnix, "Handoff acceptance time");
    if (
      receipt.acceptedAtUnix < input.descriptor.grantedAtUnix ||
      receipt.acceptedAtUnix >= input.descriptor.policy.expiresAtUnix
    ) {
      throw new AltanaBoundaryError(
        "SESSION_HANDOFF_FAILED",
        "The secret sink receipt falls outside the unexpired session window.",
      );
    }
    return {
      handoffId: receipt.handoffId,
      destination: {
        provider: receipt.destination.provider,
        reference: receipt.destination.reference,
      },
      sessionId: receipt.sessionId,
      policyDigest: receiptPolicyDigest,
      acceptedAtUnix: receipt.acceptedAtUnix,
      consumed: true,
    };
  } catch (error) {
    if (error instanceof AltanaBoundaryError) throw error;
    throw new AltanaBoundaryError(
      "SESSION_HANDOFF_FAILED",
      "The runtime session could not be handed to the approved secret sink.",
      { retriable: true },
    );
  } finally {
    bytes.fill(0);
  }
}

/**
 * Remove provider-specific secret references before handoff metadata is
 * returned from a public runner or serialized into evidence. The full
 * receipt remains available only to the sink boundary for validation.
 */
export function toPublicSessionHandoffReceipt(
  receipt: SessionHandoffReceipt,
): PublicSessionHandoffReceipt {
  return {
    handoffId: receipt.handoffId,
    destinationProvider: receipt.destination.provider,
    sessionId: receipt.sessionId,
    policyDigest: receipt.policyDigest,
    acceptedAtUnix: receipt.acceptedAtUnix,
    consumed: true,
  };
}
