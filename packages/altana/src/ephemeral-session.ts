import { AltanaBoundaryError } from "./errors.ts";
import type {
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

export async function handoffRuntimeSession(input: {
  readonly material: EphemeralSessionMaterial;
  readonly descriptor: RuntimeSessionDescriptor;
  readonly destination: SecretReference;
  readonly sink: RuntimeSessionSecretSink;
  readonly nowUnix?: number;
}): Promise<SessionHandoffReceipt> {
  if (input.descriptor.secretReference !== null) {
    throw new AltanaBoundaryError(
      "SESSION_HANDOFF_FAILED",
      "A descriptor cannot already contain a destination secret value or reference.",
    );
  }

  const bytes = input.material.consume();
  try {
    const receipt = await input.sink.putRuntimeSession({
      bytes,
      descriptor: input.descriptor,
      destination: input.destination,
    });

    if (receipt.consumed !== true) {
      throw new AltanaBoundaryError(
        "SESSION_HANDOFF_FAILED",
        "The secret sink did not confirm one-time consumption.",
      );
    }
    return receipt;
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

