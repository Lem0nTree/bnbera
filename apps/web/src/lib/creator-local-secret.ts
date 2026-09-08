import { createHash } from "node:crypto";
import { constants, chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { RuntimeSessionDescriptor, RuntimeSessionSecretSink, SecretReference, SessionHandoffReceipt } from "@bnbera/altana";

const runtimeNamePattern = /^bnberahf[0-9a-f]{12}$/u;
const authorityIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const destinationPattern = /^studio-local\/(bnberahf[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const sessionFileName = "altana-session.json";

export function creatorRuntimeName(draftId: string): string {
  return `bnberahf${createHash("sha256").update(draftId).digest("hex").slice(0, 12)}`;
}
export function creatorLocalStudioDestination(runtimeName: string, authorityId: string): SecretReference {
  if (!runtimeNamePattern.test(runtimeName) || !authorityIdPattern.test(authorityId)) throw new Error("Creator Studio destination is invalid.");
  return { provider: "studio-delegated-secret-channel", reference: `studio-local/${runtimeName}/${authorityId.toLowerCase()}` };
}

function privateDirectory(path: string): void {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Creator Studio secret path is not a private directory.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    mkdirSync(path, { recursive: true, mode: 0o700 });
    const created = lstatSync(path);
    if (created.isSymbolicLink() || !created.isDirectory()) throw new Error("Creator Studio secret path is not a private directory.");
  }
  chmodSync(path, 0o700);
}

function sameFile(path: string, bytes: Buffer): boolean {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Creator Studio secret file is not a regular file.");
  return readFileSync(path).equals(bytes);
}

function putNewFile(path: string, bytes: Buffer): boolean {
  let descriptor: number | undefined;
  try {
    const noFollow = constants.O_NOFOLLOW ?? 0;
    descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
    let offset = 0;
    while (offset < bytes.byteLength) offset += writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(path, 0o600);
    return true;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return sameFile(path, bytes);
    throw error;
  }
}

/**
 * Owner-only local Studio sink. The root is an explicit workspace parent,
 * and `.studio` is a sibling of `app/agent`, so the secret never enters the
 * deployable template artifact. No path supplied by the browser is used.
 */
export class LocalCreatorStudioSecretSink implements RuntimeSessionSecretSink {
  readonly #workspaceRoot: string;
  readonly #nowUnix: () => number;

  constructor(input: { readonly workspaceRoot: string; readonly nowUnix?: () => number }) {
    if (!isAbsolute(input.workspaceRoot)) throw new Error("Creator Studio workspace root must be absolute.");
    this.#workspaceRoot = resolve(input.workspaceRoot);
    this.#nowUnix = input.nowUnix ?? (() => Math.floor(Date.now() / 1000));
  }

  async putRuntimeSession(input: { readonly bytes: Uint8Array; readonly descriptor: RuntimeSessionDescriptor; readonly destination: SecretReference }): Promise<SessionHandoffReceipt> {
    const match = input.destination.provider === "studio-delegated-secret-channel" ? destinationPattern.exec(input.destination.reference) : null;
    if (match === null) throw new Error("Creator Studio secret destination is invalid.");
    const runtimeName = match[1]!;
    if (!runtimeNamePattern.test(runtimeName)) throw new Error("Creator Studio secret destination is invalid.");
    const runtimeRoot = join(this.#workspaceRoot, runtimeName);
    const studioRoot = join(runtimeRoot, ".studio");
    const walletsRoot = join(studioRoot, "wallets");
    const file = join(walletsRoot, sessionFileName);
    const bytes = Buffer.from(input.bytes);
    try {
      privateDirectory(this.#workspaceRoot);
      privateDirectory(runtimeRoot);
      privateDirectory(studioRoot);
      privateDirectory(walletsRoot);
      if (bytes.byteLength === 0 || bytes.byteLength > 32 * 1024) throw new Error("Creator Studio session material is outside its bound.");
      let accepted = false;
      try {
        accepted = putNewFile(file, bytes);
      } catch {
        throw new Error("Creator Studio secret file could not be safely written.");
      }
      if (!accepted && !sameFile(file, bytes)) throw new Error("Creator Studio secret file conflicts with the existing session.");
      const reference = input.destination.reference;
      return {
        handoffId: `local:${createHash("sha256").update(reference).digest("hex").slice(0, 32)}`,
        destination: { provider: "studio-delegated-secret-channel", reference },
        sessionId: input.descriptor.sessionId,
        policyDigest: input.descriptor.policyDigest,
        acceptedAtUnix: this.#nowUnix(),
        consumed: true,
      };
    } finally {
      bytes.fill(0);
    }
  }
}
