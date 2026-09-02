import {
  assertStateTransition,
  erc8004IdentityKey,
  normalizeErc8004Identity,
  normalizeEvmAddress,
  type Erc8004Identity
} from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import {
  assertIdentityReadProvenance,
  identityReadReference,
  identityRecordReadReference
} from "./identity-provenance.js";
import {
  canonicalClaimProofDigest,
  normalizeClaimVerificationContext,
  normalizeClaimVerificationProof
} from "./normalize.js";
import type {
  AuthenticatedOperator,
  ClaimMutationActor,
  ClaimRecord,
  ClaimVerificationContext,
  ClaimVerificationProof,
  DirectIdentityState,
  IdentityRecord,
  IngestionRepository,
  VerifiedClaimProof
} from "./types.js";

/**
 * Signature verification must return the verified SIWE fields. A boolean is
 * deliberately not sufficient: the caller must be able to compare the
 * recovered address, identity, action, resources, URI, domain, chain, time,
 * nonce, and signature digest to the issued challenge.
 */
export interface OwnerProofVerifier {
  verify(input: {
    readonly identity: Erc8004Identity;
    readonly ownerAddress: string;
    readonly context: ClaimVerificationContext;
    readonly proof: ClaimVerificationProof;
  }): Promise<VerifiedClaimProof | null>;
}

export interface ClaimOperatorAuthorizer {
  /** Return the authenticated principal and scopes, or null on denial. */
  authorize(input: {
    readonly identity: Erc8004Identity;
    readonly action: "revoke";
    readonly operator: AuthenticatedOperator;
  }): Promise<AuthenticatedOperator | null>;
}

export interface ClaimIdentityReader {
  readIdentity(identity: Erc8004Identity): Promise<DirectIdentityState>;
}

export type ClaimServiceOptions = {
  readonly now?: () => Date;
  /** Authenticated internal principal used for reconciliation transitions. */
  readonly internalOperatorId?: string;
  /** Authorization boundary for explicit operator revocation. */
  readonly operatorAuthorizer?: ClaimOperatorAuthorizer;
};

/**
 * ERC-721 owner control is verified independently from the ERC-8004
 * `agentWallet`. A valid owner proof never changes the agentWallet field.
 * Claim and claim-event writes go through one repository CAS mutation.
 */
export class IdentityClaimService {
  public constructor(
    private readonly repository: IngestionRepository,
    private readonly reader: ClaimIdentityReader,
    private readonly proofVerifier: OwnerProofVerifier,
    private readonly options: ClaimServiceOptions = {}
  ) {}

  async claim(input: {
    readonly identity: Erc8004Identity;
    readonly proof: ClaimVerificationProof;
    /** Server-issued SIWE challenge context expected for this request. */
    readonly context: ClaimVerificationContext;
  }): Promise<IdentityRecord> {
    const identity = normalizeErc8004Identity(input.identity);
    const identityKey = erc8004IdentityKey(identity);
    const context = normalizeClaimVerificationContext(input.context);
    const proof = normalizeClaimVerificationProof(input.proof);
    this.assertProofBindsToChallenge(identity, proof, context);

    const existing = await this.repository.findIdentity(identity);
    if (existing === null) {
      throw ingestionError("CLAIM_NOT_ACTIVE", "The identity must be discovered before it can be claimed.", "import_identity");
    }
    const current = await this.reader.readIdentity(identity);
    assertIdentityReadProvenance(current, "claim owner read");
    const ownerAddress = current.ownerAddress === null ? null : normalizeEvmAddress(current.ownerAddress);
    if (ownerAddress === null) {
      throw ingestionError("CLAIM_OWNER_MISMATCH", "The identity has no current ERC-721 owner.", "retry_owner_read");
    }
    if (proof.address !== ownerAddress || proof.chainId !== identity.chainId) {
      throw ingestionError(
        "CLAIM_OWNER_MISMATCH",
        "The connected wallet is not the current ERC-721 owner.",
        "connect_owner_wallet"
      );
    }
    this.assertProofTime(proof);

    let verified: VerifiedClaimProof | null;
    try {
      verified = await this.proofVerifier.verify({ identity, ownerAddress, context, proof });
    } catch (cause) {
      throw ingestionError("CLAIM_PROOF_INVALID", "The wallet proof could not be verified.", "sign_in_again", cause);
    }
    if (verified === null) {
      throw ingestionError("CLAIM_PROOF_INVALID", "The wallet proof could not be verified.", "sign_in_again");
    }
    const normalizedVerified = this.normalizeVerifiedProof(verified);
    this.assertProofBindsToChallenge(identity, normalizedVerified, context);
    if (!sameProofFields(proof, normalizedVerified)) {
      throw ingestionError(
        "CLAIM_PROOF_INVALID",
        "The verified wallet proof does not match the issued SIWE challenge.",
        "sign_in_again"
      );
    }

    const proofDigest = canonicalClaimProofDigest(proof, context);
    return this.repository.withTransaction(async (unitOfWork) => {
      const priorClaim = await unitOfWork.getClaim(identityKey);
      const storedBefore = await unitOfWork.findIdentity(identity);
      if (storedBefore === null) {
        throw ingestionError("CLAIM_NOT_ACTIVE", "The identity must be discovered before it can be claimed.", "import_identity");
      }

      // The first owner read only gates signature verification. Re-read the
      // chain-backed state while inside the unit of work, immediately before
      // applying the canonical row and claim CAS. The repository then checks
      // the stored owner itself; the request cannot establish ownership by
      // supplying an expected owner value.
      const canonicalRead = await this.reader.readIdentity(identity);
      assertIdentityReadProvenance(canonicalRead, "claim canonical identity read");
      const canonicalReadRef = identityReadReference(canonicalRead);
      const canonicalOwner = canonicalRead.ownerAddress === null
        ? null
        : normalizeEvmAddress(canonicalRead.ownerAddress);
      if (canonicalOwner === null || canonicalOwner !== ownerAddress) {
        throw ingestionError(
          "CLAIM_OWNER_MISMATCH",
          "The ERC-721 owner changed before the claim was committed.",
          "reload_identity"
        );
      }
      if (storedBefore.ownerAddress !== null && storedBefore.ownerAddress !== canonicalOwner) {
        throw ingestionError(
          "CLAIM_OWNER_MISMATCH",
          "The canonical identity owner changed during claim verification.",
          "reload_identity"
        );
      }
      const canonical = await unitOfWork.applyCanonicalState({ identity, ...canonicalRead });
      const canonicalStored = await unitOfWork.findIdentity(identity);
      if (canonicalStored === null || canonicalStored.ownerAddress !== canonicalOwner) {
        throw ingestionError(
          "CLAIM_OWNER_MISMATCH",
          "The canonical identity owner could not be confirmed for the claim.",
          "reload_identity"
        );
      }
      assertIdentityRecordMatchesRead(canonicalStored, canonicalReadRef);
      if (priorClaim?.status === "claimed" && priorClaim.claimantAddress !== ownerAddress) {
        throw ingestionError("CLAIM_NOT_ACTIVE", "Another active owner claim must be reconciled first.", "reconcile_claim");
      }
      if (priorClaim !== null && priorClaim.status !== "claimed") {
        assertStateTransition("claimStatus", priorClaim.status, "claimed");
      }
      const now = this.now();
      const claim: ClaimRecord = {
        identityKey,
        version: (priorClaim?.version ?? 0) + 1,
        status: "claimed",
        claimantAddress: ownerAddress,
        ownerAddressAtVerification: ownerAddress,
        agentWalletAtVerification: canonical.agentWallet,
        verifiedAt: now,
        staleAt: null,
        lastReason: "claimed",
        verificationObservedBlock: canonicalRead.observedBlock,
        verificationObservedBlockHash: canonicalRead.observedBlockHash.toLowerCase(),
        verificationReadConsistency: canonicalRead.readConsistency
      };
      const actor: ClaimMutationActor = { type: "owner", walletAddress: ownerAddress, proofDigest };
      await unitOfWork.mutateClaim({
        identityKey,
        expectedVersion: priorClaim?.version ?? null,
        expectedStatus: priorClaim?.status ?? null,
        expectedOwnerAddress: ownerAddress,
        expectedCanonicalRead: canonicalReadRef,
        claim,
        actor,
        event: {
          identityKey,
          eventType: "claimed",
          claimantAddress: ownerAddress,
          observedOwnerAddress: canonical.ownerAddress,
          observedAgentWallet: canonical.agentWallet,
          proofDigest,
          actorType: "owner",
          actorId: ownerAddress,
          reason: "Current ERC-721 owner proved control with SIWE.",
          occurredAt: now
        }
      });
      return (await unitOfWork.findIdentity(identity)) ?? canonical;
    });
  }

  async revalidate(identityInput: Erc8004Identity, reason = "reconciliation"): Promise<IdentityRecord> {
    const identity = normalizeErc8004Identity(identityInput);
    const existing = await this.repository.findIdentity(identity);
    if (existing === null) {
      throw ingestionError("CLAIM_NOT_ACTIVE", "The identity is not in the ingestion index.", "import_identity");
    }
    const current = await this.reader.readIdentity(identity);
    assertIdentityReadProvenance(current, "claim reconciliation read");
    const currentOwner = current.ownerAddress === null ? null : normalizeEvmAddress(current.ownerAddress);
    return this.repository.withTransaction(async (unitOfWork) => {
      const claim = await unitOfWork.getClaim(erc8004IdentityKey(identity));
      const record = await unitOfWork.applyCanonicalState({ identity, ...current });
      assertIdentityRecordMatchesRead(record, identityReadReference(current));
      if (claim?.status === "claimed" && claim.claimantAddress !== currentOwner) {
        assertStateTransition("claimStatus", claim.status, "stale");
        const staleAt = this.now();
        const operator = this.internalOperator("reconciliation");
        await unitOfWork.mutateClaim({
          identityKey: erc8004IdentityKey(identity),
          expectedVersion: claim.version,
          expectedStatus: claim.status,
          expectedOwnerAddress: record.ownerAddress,
          expectedCanonicalRead: identityReadReference(current),
          claim: {
            ...claim,
            version: claim.version + 1,
            status: "stale",
            staleAt,
            lastReason: reason === "revoked" ? "revoked" : "reconciliation"
          },
          actor: operator,
          event: {
            identityKey: erc8004IdentityKey(identity),
            eventType: reason === "revoked" ? "revoked" : "stale",
            claimantAddress: claim.claimantAddress,
            observedOwnerAddress: currentOwner,
            observedAgentWallet: record.agentWallet,
            proofDigest: null,
            actorType: "operator",
            actorId: operator.operatorId,
            reason,
            occurredAt: staleAt
          }
        });
      }
      return (await unitOfWork.findIdentity(identity)) ?? record;
    });
  }

  /**
   * Revoke requires a caller-provided authenticated operator context and a
   * server-side authorizer. There is intentionally no unauthenticated
   * convenience overload.
   */
  async revoke(
    identityInput: Erc8004Identity,
    reason: string,
    operator: AuthenticatedOperator
  ): Promise<IdentityRecord> {
    const identity = normalizeErc8004Identity(identityInput);
    const record = await this.repository.findIdentity(identity);
    if (record === null) {
      throw ingestionError("CLAIM_NOT_ACTIVE", "The identity is not in the ingestion index.", "import_identity");
    }
    const authorizer = this.options.operatorAuthorizer;
    if (authorizer === undefined) {
      throw ingestionError(
        "CLAIM_AUTHORIZATION_REQUIRED",
        "An authenticated operator session is required to revoke a claim.",
        "authenticate_operator"
      );
    }
    const authorized = await authorizer.authorize({ identity, action: "revoke", operator });
    if (
      authorized === null ||
      authorized.operatorId.trim().length === 0 ||
      !authorized.scopes.includes("identity.claim.revoke")
    ) {
      throw ingestionError(
        "CLAIM_AUTHORIZATION_REQUIRED",
        "The operator is not authorized to revoke this claim.",
        "authenticate_operator"
      );
    }
    const claim = await this.repository.getClaim(erc8004IdentityKey(identity));
    if (claim === null || claim.status !== "claimed") {
      return record;
    }
    assertStateTransition("claimStatus", claim.status, "stale");
    const now = this.now();
    const actor: ClaimMutationActor = {
      type: "operator",
      operatorId: authorized.operatorId,
      scope: "identity.claim.revoke"
    };
    await this.repository.withTransaction(async (unitOfWork) => {
      const canonical = await unitOfWork.findIdentity(identity);
      if (canonical === null) {
        throw ingestionError("CLAIM_NOT_ACTIVE", "The identity is not in the ingestion index.", "import_identity");
      }
      const canonicalRead = identityRecordReadReference(canonical);
      if (canonicalRead === null) {
        throw ingestionError(
          "REPOSITORY_FAILURE",
          "The canonical identity is missing a block-bound read reference.",
          "repair_repository_mapping"
        );
      }
      await unitOfWork.mutateClaim({
        identityKey: erc8004IdentityKey(identity),
        expectedVersion: claim.version,
        expectedStatus: claim.status,
        expectedOwnerAddress: canonical.ownerAddress,
        expectedCanonicalRead: canonicalRead,
        claim: {
          ...claim,
          version: claim.version + 1,
          status: "stale",
          staleAt: now,
          lastReason: "revoked"
        },
        actor,
        event: {
          identityKey: erc8004IdentityKey(identity),
          eventType: "revoked",
          claimantAddress: claim.claimantAddress,
          observedOwnerAddress: canonical.ownerAddress,
          observedAgentWallet: canonical.agentWallet,
          proofDigest: null,
          actorType: "operator",
          actorId: authorized.operatorId,
          reason,
          occurredAt: now
        }
      });
    });
    return (await this.repository.findIdentity(identity)) ?? record;
  }

  private normalizeVerifiedProof(proof: VerifiedClaimProof): VerifiedClaimProof {
    const normalized = normalizeClaimVerificationProof(proof);
    if (!(proof.verifiedAt instanceof Date) || !Number.isFinite(proof.verifiedAt.getTime())) {
      throw ingestionError("CLAIM_PROOF_INVALID", "The wallet verifier returned incomplete proof fields.", "sign_in_again");
    }
    return { ...normalized, verifiedAt: proof.verifiedAt };
  }

  private assertProofBindsToChallenge(
    identity: Erc8004Identity,
    proof: ClaimVerificationProof,
    context: ClaimVerificationContext
  ): void {
    const normalizedContext = normalizeClaimVerificationContext(context);
    if (
      erc8004IdentityKey(proof.identity) !== erc8004IdentityKey(identity) ||
      proof.chainId !== identity.chainId ||
      proof.chainId !== normalizedContext.chainId ||
      proof.domain !== normalizedContext.domain ||
      proof.uri !== normalizedContext.uri ||
      proof.action !== normalizedContext.action ||
      proof.resources.length !== normalizedContext.resources.length ||
      proof.resources.some((resource, index) => resource !== normalizedContext.resources[index])
    ) {
      throw ingestionError(
        "CLAIM_PROOF_INVALID",
        "The wallet proof is not bound to this identity or SIWE challenge.",
        "sign_in_again"
      );
    }
  }

  private assertProofTime(proof: ClaimVerificationProof): void {
    const nowMs = this.now().getTime();
    const issuedAtMs = proof.issuedAt.getTime();
    const expirationMs = proof.expirationTime.getTime();
    if (
      !Number.isFinite(issuedAtMs) ||
      !Number.isFinite(expirationMs) ||
      proof.nonce.trim().length < 8 ||
      issuedAtMs > nowMs + 30_000 ||
      issuedAtMs < nowMs - 5 * 60_000 ||
      expirationMs <= nowMs ||
      expirationMs <= issuedAtMs ||
      expirationMs - issuedAtMs > 15 * 60_000
    ) {
      throw ingestionError("CLAIM_PROOF_INVALID", "The wallet proof is expired or outside the allowed time window.", "sign_in_again");
    }
  }

  private internalOperator(scope: "reconciliation"): Extract<ClaimMutationActor, { type: "operator" }> {
    const operatorId = this.options.internalOperatorId?.trim();
    if (operatorId === undefined || operatorId.length === 0) {
      throw ingestionError(
        "CLAIM_AUTHORIZATION_REQUIRED",
        "An authenticated internal operator is required for claim reconciliation.",
        "configure_identity_indexer"
      );
    }
    return {
      type: "operator",
      operatorId,
      scope: scope === "reconciliation" ? "identity.claim.reconcile" : "identity.claim.revoke"
    };
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

function sameProofFields(a: ClaimVerificationProof, b: ClaimVerificationProof): boolean {
  return (
    erc8004IdentityKey(a.identity) === erc8004IdentityKey(b.identity) &&
    a.address === b.address &&
    a.chainId === b.chainId &&
    a.domain === b.domain &&
    a.uri === b.uri &&
    a.action === b.action &&
    a.resources.length === b.resources.length &&
    a.resources.every((resource, index) => resource === b.resources[index]) &&
    a.issuedAt.getTime() === b.issuedAt.getTime() &&
    a.expirationTime.getTime() === b.expirationTime.getTime() &&
    a.nonce === b.nonce &&
    a.signatureDigest === b.signatureDigest
  );
}

function assertIdentityRecordMatchesRead(
  record: IdentityRecord,
  expected: ReturnType<typeof identityReadReference>
): void {
  const actual = identityRecordReadReference(record);
  if (
    actual === null ||
    actual.observedBlock !== expected.observedBlock ||
    actual.observedBlockHash !== expected.observedBlockHash ||
    actual.readConsistency !== expected.readConsistency
  ) {
    throw ingestionError(
      "REPOSITORY_FAILURE",
      "The persisted identity does not match the canonical read used for this mutation.",
      "repair_repository_mapping"
    );
  }
}
