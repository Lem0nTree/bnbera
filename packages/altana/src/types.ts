/**
 * Public, non-secret types for the BNBEra Altana boundary.
 *
 * The package deliberately has no type for an administrator private key,
 * passkey export, serialized session, or credential value.  Adapters may
 * hold those values in memory while calling the official SDK, but they must
 * not cross this public domain boundary.
 */

export type Address = `0x${string}`;
export type HexString = `0x${string}`;
export type TransactionHash = HexString;
export type ChainId = 56 | 97;

export type PermissionPeriod = "call" | "hour" | "day" | "week" | "lifetime";

export interface CallPermission {
  /** Contract address, normalized to lower-case before persistence. */
  readonly target: Address;
  /** Four-byte selectors only. An empty selector list is not a wildcard. */
  readonly selectors: readonly HexString[];
  /** Maximum native value that one matching call may carry, in wei. */
  readonly maxNativeValueWei: bigint;
}

export interface SpendPermission {
  /** The ERC-20 token address, or `native` for native chain value. */
  readonly token: Address | "native";
  /** Atomic-unit limit for the selected period. */
  readonly limitAtomic: bigint;
  readonly period: PermissionPeriod;
}

export interface ScopedPolicy {
  readonly chainId: ChainId;
  /** User-controlled Altana administrator address. Public metadata only. */
  readonly adminAddress: Address;
  /** Altana smart-agent wallet from which the runtime acts. */
  readonly walletAddress: Address;
  /** Exact public address of the delegated runtime session key. */
  readonly sessionPublicAddress: Address;
  readonly calls: readonly CallPermission[];
  readonly spend: readonly SpendPermission[];
  /** Unix seconds; policy must always expire in the future at grant time. */
  readonly expiresAtUnix: number;
}

export interface RuntimeSessionDescriptor {
  /** Stable application correlation identifier, not a serialized session. */
  readonly sessionId: string;
  readonly policy: ScopedPolicy;
  readonly policyDigest: HexString | null;
  /** Public transaction reference, when the grant is registered onchain. */
  readonly grantTransactionHash: TransactionHash | null;
  /** Secret-manager reference only; never a secret value. */
  readonly secretReference: string | null;
  readonly grantedAtUnix: number;
}

export type SessionStatus = "unknown" | "active" | "expired" | "revoked";

export interface SessionStateObservation {
  readonly status: SessionStatus;
  readonly observedAtUnix: number;
  readonly observedBlockNumber: bigint | null;
  readonly source: "altana-sdk" | "keystore-read" | "chain-read" | "test";
  readonly reasonCode: string | null;
}

export interface ActionRequest {
  readonly target: Address;
  readonly selector: HexString;
  readonly valueWei: bigint;
}

export interface ActionObservation {
  readonly outcome: "confirmed" | "rejected" | "unknown";
  readonly observedAtUnix: number;
  readonly chainId: ChainId;
  readonly transactionHash: TransactionHash | null;
  readonly target: Address | null;
  readonly selector: HexString | null;
  readonly reasonCode: string | null;
}

export interface RevocationObservation {
  readonly outcome: "confirmed" | "rejected" | "unknown";
  readonly observedAtUnix: number;
  readonly transactionHash: TransactionHash | null;
  readonly sessionStatus: SessionStatus;
  readonly reasonCode: string | null;
}

export interface SecretReference {
  /** Provider name, never the provider credential. */
  readonly provider:
    | "studio-delegated-secret-channel"
    | "aws-secrets-manager"
    | "local-test-only";
  /** Secret name/ARN/reference. The referenced value is never included. */
  readonly reference: string;
}

export interface SessionHandoffReceipt {
  readonly handoffId: string;
  readonly destination: SecretReference;
  readonly acceptedAtUnix: number;
  /** The adapter must report that the one-time material was consumed. */
  readonly consumed: true;
}

