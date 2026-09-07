/**
 * Browser-only state and reconciliation boundary for a newly created Altana
 * passkey wallet.
 *
 * A createPasskeyWallet result is counterfactual: its first admin execute is
 * what causes the SDK to prepend initialRegisterKey. This module deliberately
 * keeps that one write outside the server and persists only public relay
 * evidence so a reload cannot submit the same first action twice.
 */

export const PASSKEY_BOOTSTRAP_CHAIN_ID = 97 as const;
export const PASSKEY_BOOTSTRAP_STORAGE_KEY = `bnbera:commerce:passkey-bootstrap:${PASSKEY_BOOTSTRAP_CHAIN_ID}`;

const HASH_PATTERN = /^0x[0-9a-f]{64}$/iu;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/iu;

export type PasskeyBootstrapHash = `0x${string}`;
export type PasskeyBootstrapStatus = "unregistered" | "pending" | "confirmed" | "failed" | "unknown";
export type PasskeyBootstrapWalletState = "new_unregistered" | "already_registered";

export type PasskeyBootstrapRecord = {
  readonly version: 1;
  readonly chainId: typeof PASSKEY_BOOTSTRAP_CHAIN_ID;
  readonly walletAddress: string;
  readonly callsId: PasskeyBootstrapHash | null;
  readonly transactionHash: PasskeyBootstrapHash | null;
  readonly status: PasskeyBootstrapStatus;
  readonly statusCode: number | null;
  readonly updatedAt: number;
};

export type PasskeyBootstrapExecuteResult = {
  readonly callsId: PasskeyBootstrapHash;
  readonly status: "PENDING" | "CONFIRMED" | "FAILED";
  readonly statusCode?: number;
  readonly transactionHash?: PasskeyBootstrapHash;
};

export type PasskeyBootstrapRelayStatus = {
  readonly status: "PENDING" | "CONFIRMED" | "FAILED";
  readonly statusCode: number | null;
  readonly transactionHash: PasskeyBootstrapHash | null;
};

export type PasskeyBootstrapOutcome = {
  readonly status: PasskeyBootstrapStatus | "already_registered";
  readonly record: PasskeyBootstrapRecord;
  readonly shouldAuthenticate: boolean;
  readonly message?: string;
};

export type PasskeyBootstrapExecutionError = Error & {
  readonly callsId?: unknown;
  readonly relayCallsId?: unknown;
};

export function isPasskeyBootstrapHash(value: unknown): value is PasskeyBootstrapHash {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function isAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

function statusCode(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function updatedAt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizedHash(value: unknown): PasskeyBootstrapHash | null {
  return isPasskeyBootstrapHash(value) ? value.toLowerCase() as PasskeyBootstrapHash : null;
}

function recordStatus(value: unknown): PasskeyBootstrapStatus | null {
  return value === "unregistered" || value === "pending" || value === "confirmed" || value === "failed" || value === "unknown"
    ? value
    : null;
}

export function createUnregisteredPasskeyBootstrapRecord(walletAddress: string, now = Date.now()): PasskeyBootstrapRecord {
  if (!isAddress(walletAddress)) throw new Error("The passkey wallet address is invalid.");
  return {
    version: 1,
    chainId: PASSKEY_BOOTSTRAP_CHAIN_ID,
    walletAddress: walletAddress.toLowerCase(),
    callsId: null,
    transactionHash: null,
    status: "unregistered",
    statusCode: null,
    updatedAt: now
  };
}

export function serializePasskeyBootstrapRecord(record: PasskeyBootstrapRecord): string {
  return JSON.stringify(record);
}

/** Parse only the public, versioned record we own; credentials and signers are never accepted. */
export function parsePasskeyBootstrapRecord(value: string | null): PasskeyBootstrapRecord | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const status = recordStatus(parsed.status);
    const timestamp = updatedAt(parsed.updatedAt);
    if (parsed.version !== 1 || parsed.chainId !== PASSKEY_BOOTSTRAP_CHAIN_ID || !isAddress(parsed.walletAddress) || status === null || timestamp === null) return null;
    if (parsed.callsId !== null && !isPasskeyBootstrapHash(parsed.callsId)) return null;
    if (parsed.transactionHash !== null && !isPasskeyBootstrapHash(parsed.transactionHash)) return null;
    if (parsed.status === "unregistered" && parsed.callsId !== null) return null;
    return {
      version: 1,
      chainId: PASSKEY_BOOTSTRAP_CHAIN_ID,
      walletAddress: parsed.walletAddress.toLowerCase(),
      callsId: normalizedHash(parsed.callsId),
      transactionHash: normalizedHash(parsed.transactionHash),
      status,
      statusCode: statusCode(parsed.statusCode),
      updatedAt: timestamp
    };
  } catch {
    return null;
  }
}

function withRecord(
  record: PasskeyBootstrapRecord,
  values: Partial<Pick<PasskeyBootstrapRecord, "callsId" | "transactionHash" | "status" | "statusCode">>,
  now: number
): PasskeyBootstrapRecord {
  return {
    ...record,
    ...values,
    walletAddress: record.walletAddress.toLowerCase(),
    updatedAt: now
  };
}

function executionRecord(record: PasskeyBootstrapRecord, result: PasskeyBootstrapExecuteResult, now: number): PasskeyBootstrapRecord {
  const callsId = normalizedHash(result.callsId);
  if (callsId === null) throw new Error("The passkey activation returned an invalid relay calls ID.");
  const transactionHash = result.transactionHash === undefined ? null : normalizedHash(result.transactionHash);
  if (result.transactionHash !== undefined && transactionHash === null) throw new Error("The passkey activation returned an invalid transaction hash.");
  return withRecord(record, {
    callsId,
    transactionHash,
    status: result.status === "CONFIRMED" ? "confirmed" : result.status === "FAILED" ? "failed" : "pending",
    statusCode: result.statusCode ?? null
  }, now);
}

function relayRecord(record: PasskeyBootstrapRecord, result: PasskeyBootstrapRelayStatus, now: number): PasskeyBootstrapRecord {
  return withRecord(record, {
    // A failed relay response with a receipt still has an on-chain outcome;
    // keep it unknown until a human/reconciler inspects that receipt rather
    // than risking a duplicate first action.
    status: result.status === "CONFIRMED" ? "confirmed" : result.status === "FAILED" ? result.transactionHash === null ? "failed" : "unknown" : "pending",
    transactionHash: result.transactionHash ?? record.transactionHash,
    statusCode: result.statusCode
  }, now);
}

function errorCallsId(cause: unknown): PasskeyBootstrapHash | null {
  if (typeof cause !== "object" || cause === null) return null;
  const record = cause as PasskeyBootstrapExecutionError;
  return normalizedHash(record.callsId) ?? normalizedHash(record.relayCallsId);
}

function isInsufficientGas(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  return /insufficient|underfunded|out of gas|gas required|fee.+balance|balance.+fee/iu.test(message);
}

function failureMessage(cause: unknown): string {
  if (isInsufficientGas(cause)) return "Wallet activation needs more BNB testnet gas. No server sign-in was attempted.";
  return "Wallet activation failed before confirmation. No server sign-in was attempted.";
}

function pendingMessage(): string {
  return "Wallet activation is still pending. The saved relay calls ID will be reconciled; no second activation will be submitted.";
}

function unknownMessage(): string {
  return "Wallet activation has an unknown outcome. Reconcile the saved relay calls ID before retrying; no second activation was submitted.";
}

function failedMessage(): string {
  return "Wallet activation was rejected by the relay. It is safe to retry only after this failed outcome is confirmed.";
}

function outcome(record: PasskeyBootstrapRecord, shouldAuthenticate: boolean, message?: string): PasskeyBootstrapOutcome {
  return {
    status: record.status,
    record,
    shouldAuthenticate,
    ...(message === undefined ? {} : { message })
  };
}

/**
 * Activate one newly-created wallet. Existing calls are reconciled first;
 * only a confirmed relay failure may reach execute again. `execute` must be
 * the installed SDK's explicit empty-call admin action.
 */
export async function activateFreshPasskeyWallet(input: {
  readonly walletAddress: string;
  readonly walletState: PasskeyBootstrapWalletState;
  readonly record: PasskeyBootstrapRecord | null;
  readonly execute: () => Promise<PasskeyBootstrapExecuteResult>;
  readonly readStatus: (callsId: PasskeyBootstrapHash) => Promise<PasskeyBootstrapRelayStatus>;
  readonly persist: (record: PasskeyBootstrapRecord) => void;
  readonly now?: () => number;
}): Promise<PasskeyBootstrapOutcome> {
  const now = input.now ?? Date.now;
  const walletAddress = input.walletAddress.toLowerCase();
  if (!isAddress(walletAddress)) throw new Error("The passkey wallet address is invalid.");
  if (input.record !== null && input.record.walletAddress.toLowerCase() !== walletAddress) {
    const blocked = createUnregisteredPasskeyBootstrapRecord(walletAddress, now());
    const unknown = withRecord(blocked, { status: "unknown" }, now());
    input.persist(unknown);
    return outcome(unknown, false, "A different passkey wallet has a saved activation outcome. Reconcile it before creating another wallet.");
  }

  if (input.walletState === "already_registered") {
    const registered = input.record?.status === "confirmed"
      ? input.record
      : withRecord(input.record ?? createUnregisteredPasskeyBootstrapRecord(walletAddress, now()), { status: "confirmed" }, now());
    input.persist(registered);
    return { status: "already_registered", record: registered, shouldAuthenticate: true };
  }

  let current = input.record ?? createUnregisteredPasskeyBootstrapRecord(walletAddress, now());
  if (current.status === "confirmed") return outcome(current, true);
  if (current.status === "unknown" && current.callsId === null) return outcome(current, false, unknownMessage());

  // A calls ID is durable public evidence. Always read it before considering
  // another execute, including records previously marked failed/unknown.
  if (current.callsId !== null) {
    try {
      current = relayRecord(current, await input.readStatus(current.callsId), now());
      input.persist(current);
    } catch {
      current = withRecord(current, { status: "unknown" }, now());
      input.persist(current);
      return outcome(current, false, unknownMessage());
    }
    if (current.status === "confirmed") return outcome(current, true);
    if (current.status === "pending") return outcome(current, false, pendingMessage());
    if (current.status === "unknown") return outcome(current, false, unknownMessage());
    // A confirmed FAILED relay outcome is the only existing-call state that
    // permits an explicit user retry. It cannot have committed the action.
  }

  // Mark the intent before crossing into the SDK writer. If the browser loses
  // the response before a calls ID is returned, a reload sees this durable
  // unknown marker and can only perform read-only recovery; it must not send a
  // second first action.
  current = withRecord(current, {
    callsId: null,
    transactionHash: null,
    status: "unknown",
    statusCode: null
  }, now());
  input.persist(current);

  try {
    const result = await input.execute();
    current = executionRecord(current, result, now());
    input.persist(current);
    if (current.status === "confirmed") return outcome(current, true);
    if (current.status === "failed") return outcome(current, false, failedMessage());
    // Read once immediately so a fast confirmation authenticates without a
    // second click. Pending remains durable and is never resubmitted.
    try {
      current = relayRecord(current, await input.readStatus(current.callsId as PasskeyBootstrapHash), now());
      input.persist(current);
      if (current.status === "confirmed") return outcome(current, true);
      if (current.status === "failed") return outcome(current, false, failedMessage());
      if (current.status === "unknown") return outcome(current, false, unknownMessage());
      return outcome(current, false, pendingMessage());
    } catch {
      current = withRecord(current, { status: "unknown" }, now());
      input.persist(current);
      return outcome(current, false, unknownMessage());
    }
  } catch (cause) {
    const callsId = errorCallsId(cause);
    const knownFailure = callsId === null && isInsufficientGas(cause);
    current = withRecord(current, {
      callsId,
      transactionHash: null,
      status: knownFailure ? "failed" : "unknown",
      statusCode: null
    }, now());
    input.persist(current);
    return outcome(current, false, knownFailure ? failureMessage(cause) : unknownMessage());
  }
}

/** Reconcile an already persisted bootstrap without a signer or any write. */
export async function reconcilePasskeyBootstrapRecord(input: {
  readonly record: PasskeyBootstrapRecord;
  readonly readStatus: (callsId: PasskeyBootstrapHash) => Promise<PasskeyBootstrapRelayStatus>;
  readonly persist: (record: PasskeyBootstrapRecord) => void;
  readonly now?: () => number;
}): Promise<PasskeyBootstrapOutcome> {
  if (input.record.callsId === null) {
    return outcome(input.record, input.record.status === "confirmed", input.record.status === "unknown" ? unknownMessage() : undefined);
  }
  try {
    const current = relayRecord(input.record, await input.readStatus(input.record.callsId), (input.now ?? Date.now)());
    input.persist(current);
    if (current.status === "confirmed") return outcome(current, true);
    if (current.status === "pending") return outcome(current, false, pendingMessage());
    if (current.status === "unknown") return outcome(current, false, unknownMessage());
    return outcome(current, false, failedMessage());
  } catch {
    const current = withRecord(input.record, { status: "unknown" }, (input.now ?? Date.now)());
    input.persist(current);
    return outcome(current, false, unknownMessage());
  }
}

function relayStatusCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (/^0x[0-9a-f]+$/iu.test(normalized)) {
    const parsed = Number.parseInt(normalized.slice(2), 16);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  if (/^[0-9]+$/u.test(normalized)) {
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function relayStatus(value: unknown): "PENDING" | "CONFIRMED" | "FAILED" {
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    if (normalized === "CONFIRMED" || normalized === "SUCCESS") return "CONFIRMED";
    if (normalized === "FAILED" || normalized === "REVERTED") return "FAILED";
    if (normalized === "PENDING" || normalized === "SUBMITTED") return "PENDING";
  }
  const code = relayStatusCode(value);
  if (code !== null) {
    if (code >= 200 && code < 300) return "CONFIRMED";
    if (code >= 300 && code <= 699) return "FAILED";
  }
  return "PENDING";
}

/**
 * The installed SDK uses wallet_getCallsStatus internally. Keep this reader
 * read-only and pin its URL from BNB_TESTNET; it never constructs a writer.
 */
export function createPasskeyBootstrapRelayStatusReader(
  relayUrl: string,
  fetcher: typeof fetch = fetch
): (callsId: PasskeyBootstrapHash) => Promise<PasskeyBootstrapRelayStatus> {
  if (relayUrl.trim() === "") throw new Error("The standards-locked Altana relay URL is unavailable.");
  return async (callsId) => {
    const response = await fetcher(relayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "wallet_getCallsStatus", params: [callsId] })
    });
    if (!response.ok) throw new Error("The Altana relay status could not be read.");
    const body = await response.json() as { readonly result?: unknown; readonly error?: unknown };
    if (body.error !== undefined || typeof body.result !== "object" || body.result === null || Array.isArray(body.result)) throw new Error("The Altana relay status response was invalid.");
    const result = body.result as Record<string, unknown>;
    const receipts = Array.isArray(result.receipts) ? result.receipts : [];
    const receipt = receipts[0];
    const transactionHash = typeof receipt === "object" && receipt !== null && !Array.isArray(receipt)
      ? normalizedHash((receipt as Record<string, unknown>).transactionHash)
      : null;
    return {
      status: relayStatus(result.status),
      statusCode: relayStatusCode(result.status),
      transactionHash
    };
  };
}
