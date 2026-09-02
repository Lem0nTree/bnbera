import { createHash } from "node:crypto";
import { keccak256Hex } from "@bnbera/evidence";
import { PublicationProviderError, type GreenfieldPublisher, type IpfsPublisher } from "./types.js";

export interface FakeStorageOptions {
  readonly failCreate?: boolean;
  readonly submittedWithoutReference?: boolean;
  readonly failUpload?: boolean;
  readonly failRead?: boolean;
  readonly missingOnRead?: boolean;
  readonly timeoutOnSeal?: boolean;
  readonly missingOnSeal?: boolean;
  readonly corruptReadback?: boolean;
  readonly sealAfterPolls?: number;
  readonly malformedTransactionHash?: boolean;
}

function fakeHash(input: string): string {
  return `0x${createHash("sha256").update(input).digest("hex")}`;
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

/** A deterministic IPFS fake; no network or credentials are used. */
export class DeterministicIpfsPublisher implements IpfsPublisher {
  private readonly objects = new Map<string, Uint8Array>();

  constructor(private readonly options: FakeStorageOptions = {}) {}

  async upload(input: { readonly bytes: Uint8Array; readonly objectName: string }): Promise<{
    readonly uri: string;
    readonly network: string;
    readonly providerReference: string;
  }> {
    if (this.options.failUpload) {
      throw new PublicationProviderError("UPLOAD_FAILED", "deterministic IPFS upload failure");
    }
    const uri = `ipfs://fake-${createHash("sha256").update(input.bytes).digest("hex")}`;
    this.objects.set(uri, cloneBytes(input.bytes));
    return { uri, network: "ipfs-test", providerReference: input.objectName };
  }

  async read(input: { readonly uri: string }): Promise<Uint8Array> {
    if (this.options.failRead) {
      throw new PublicationProviderError("PROVIDER_FAILED", "deterministic IPFS read failure");
    }
    if (this.options.missingOnRead) {
      throw new PublicationProviderError("MISSING_OBJECT", "deterministic IPFS object missing", false);
    }
    const bytes = this.objects.get(input.uri);
    if (bytes === undefined) {
      throw new PublicationProviderError("MISSING_OBJECT", "deterministic IPFS object missing", false);
    }
    if (this.options.corruptReadback) {
      const corrupted = cloneBytes(bytes);
      corrupted[0] = (corrupted[0] ?? 0) ^ 0xff;
      return corrupted;
    }
    return cloneBytes(bytes);
  }
}

/** A deterministic Greenfield fake modelling create/upload/seal/readback. */
export class DeterministicGreenfieldPublisher implements GreenfieldPublisher {
  private readonly objects = new Map<string, Uint8Array>();
  private polls = 0;
  private creates = 0;
  private uploads = 0;

  constructor(private readonly options: FakeStorageOptions = {}) {}

  async createObject(input: { readonly objectName: string }): Promise<{
    readonly objectReference: string | null;
    readonly creationTransactionHash: string;
    readonly status: "submitted" | "confirmed";
  }> {
    this.creates += 1;
    if (this.options.failCreate) {
      throw new PublicationProviderError("CREATE_FAILED", "deterministic Greenfield create failure");
    }
    if (this.options.submittedWithoutReference) {
      return {
        objectReference: null,
        creationTransactionHash: this.options.malformedTransactionHash
          ? "not-a-transaction-hash"
          : fakeHash(`create:${input.objectName}`),
        status: "submitted"
      };
    }
    return {
      objectReference: input.objectName,
      creationTransactionHash: this.options.malformedTransactionHash
        ? "not-a-transaction-hash"
        : fakeHash(`create:${input.objectName}`),
      status: "confirmed"
    };
  }

  async uploadObject(input: { readonly bytes: Uint8Array; readonly objectReference: string }): Promise<{
    readonly uri: string;
    readonly network: string;
    readonly bucket: string;
    readonly providerReference: string;
  }> {
    this.uploads += 1;
    if (this.options.failUpload) {
      throw new PublicationProviderError("UPLOAD_FAILED", "deterministic Greenfield upload failure");
    }
    this.objects.set(input.objectReference, cloneBytes(input.bytes));
    return {
      uri: `greenfield://greenfield-test/${input.objectReference}`,
      network: "greenfield_5600-1",
      bucket: "greenfield-test",
      providerReference: input.objectReference
    };
  }

  async waitForSeal(): Promise<{
    readonly status: "sealed" | "pending" | "missing";
    readonly sealTransactionHash: string | null;
  }> {
    this.polls += 1;
    if (this.options.missingOnSeal) {
      return { status: "missing", sealTransactionHash: null };
    }
    if (this.options.timeoutOnSeal || this.polls < (this.options.sealAfterPolls ?? 1)) {
      return { status: "pending", sealTransactionHash: null };
    }
    return {
      status: "sealed",
      sealTransactionHash: this.options.malformedTransactionHash
        ? "not-a-transaction-hash"
        : fakeHash(`seal:${this.polls}`)
    };
  }

  async readObject(input: { readonly objectReference: string }): Promise<Uint8Array> {
    if (this.options.failRead) {
      throw new PublicationProviderError("PROVIDER_FAILED", "deterministic Greenfield read failure");
    }
    if (this.options.missingOnRead) {
      throw new PublicationProviderError("MISSING_OBJECT", "deterministic Greenfield object missing", false);
    }
    const bytes = this.objects.get(input.objectReference);
    if (bytes === undefined) {
      throw new PublicationProviderError("MISSING_OBJECT", "deterministic Greenfield object missing", false);
    }
    if (this.options.corruptReadback) {
      const corrupted = cloneBytes(bytes);
      corrupted[0] = (corrupted[0] ?? 0) ^ 0xff;
      return corrupted;
    }
    return cloneBytes(bytes);
  }

  getPollCount(): number {
    return this.polls;
  }

  getCreateCount(): number {
    return this.creates;
  }

  getUploadCount(): number {
    return this.uploads;
  }
}

export { fakeHash, keccak256Hex };
