import {
  assertStateTransition,
  erc8004IdentityKey,
  normalizeErc8004Identity,
  normalizeEvmAddress,
  type Erc8004Identity
} from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import type {
  ClaimRecord,
  ClaimVerificationProof,
  DirectIdentityState,
  IdentityRecord,
  IngestionRepository
} from "./types.js";

export interface OwnerProofVerifier {
  verify(input: {
    readonly identity: Erc8004Identity;
    readonly ownerAddress: string;
    readonly proof: ClaimVerificationProof;
  }): Promise<boolean>;
}

export interface ClaimIdentityReader {
  readIdentity(identity: Erc8004Identity): Promise<DirectIdentityState>;
}

export type ClaimServiceOptions = {
  readonly now?: () => Date;
};

/**
 * ERC-721 owner control is verified independently from the ERC-8004
 * `agentWallet`. A valid owner proof never changes the agentWallet field.
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
  }): Promise<IdentityRecord> {
    const identity = normalizeErc8004Identity(input.identity);
    const identityKey = erc8004IdentityKey(identity);
    const existing = await this.repository.findIdentity(identity);
    if (existing === null) {
      throw ingestionError("CLAIM_NOT_ACTIVE", "The identity must be discovered before it can be claimed.", "import_identity");
    }
    const current = await this.reader.readIdentity(identity);
    const ownerAddress = current.ownerAddress === null ? null : normalizeEvmAddress(current.ownerAddress);
    if (ownerAddress === null) {
      throw ingestionError("CLAIM_OWNER_MISMATCH", "The identity has no current ERC-721 owner.", "retry_owner_read");
    }
    const proofAddress = normalizeEvmAddress(input.proof.address);
    if (proofAddress !== ownerAddress || input.proof.chainId !== identity.chainId) {
      throw ingestionError(
        "CLAIM_OWNER_MISMATCH",
        "The connected wallet is not the current ERC-721 owner.",
        "connect_owner_wallet"
      );
    }
    this.assertProofTime(input.proof);
    let verified = false;
    try {
      verified = await this.proofVerifier.verify({ identity, ownerAddress, proof: input.proof });
    } catch (cause) {
      throw ingestionError("CLAIM_PROOF_INVALID", "The wallet proof could not be verified.", "sign_in_again", cause);
    }
    if (verified !== true) {
      throw ingestionError("CLAIM_PROOF_INVALID", "The wallet proof could not be verified.", "sign_in_again");
    }

    const canonical = await this.repository.applyCanonicalState({ identity, ...current });
    const now = this.now();
    const priorClaim = await this.repository.getClaim(identityKey);
    if (priorClaim?.status === "claimed" && priorClaim.claimantAddress !== ownerAddress) {
      throw ingestionError("CLAIM_NOT_ACTIVE", "Another active owner claim must be reconciled first.", "reconcile_claim");
    }
    if (priorClaim !== null && priorClaim.status !== "claimed") {
      assertStateTransition("claimStatus", priorClaim.status, "claimed");
    }
    const claim: ClaimRecord = {
      identityKey,
      status: "claimed",
      claimantAddress: ownerAddress,
      ownerAddressAtVerification: ownerAddress,
      agentWalletAtVerification: canonical.agentWallet,
      verifiedAt: now,
      staleAt: null,
      lastReason: "claimed"
    };
    await this.repository.saveClaim(claim);
    await this.repository.appendClaimEvent({
      identityKey,
      eventType: "claimed",
      claimantAddress: ownerAddress,
      observedOwnerAddress: canonical.ownerAddress,
      observedAgentWallet: canonical.agentWallet,
      proofDigest: input.proof.signatureDigest ?? null,
      reason: "Current ERC-721 owner proved control with SIWE.",
      occurredAt: now
    });
    return (await this.repository.findIdentity(identity)) ?? canonical;
  }

  async revalidate(identityInput: Erc8004Identity, reason = "reconciliation"): Promise<IdentityRecord> {
    const identity = normalizeErc8004Identity(identityInput);
    const existing = await this.repository.findIdentity(identity);
    if (existing === null) {
      throw ingestionError("CLAIM_NOT_ACTIVE", "The identity is not in the ingestion index.", "import_identity");
    }
    const current = await this.reader.readIdentity(identity);
    const currentOwner = current.ownerAddress === null ? null : normalizeEvmAddress(current.ownerAddress);
    const claim = await this.repository.getClaim(erc8004IdentityKey(identity));
    const record = await this.repository.applyCanonicalState({ identity, ...current });
    if (claim?.status === "claimed" && claim.claimantAddress !== currentOwner) {
      assertStateTransition("claimStatus", claim.status, "stale");
      const staleAt = this.now();
      await this.repository.saveClaim({
        ...claim,
        status: "stale",
        staleAt,
        lastReason: reason === "revoked" ? "revoked" : "reconciliation"
      });
      await this.repository.appendClaimEvent({
        identityKey: erc8004IdentityKey(identity),
        eventType: reason === "revoked" ? "revoked" : "stale",
        claimantAddress: claim.claimantAddress,
        observedOwnerAddress: currentOwner,
        observedAgentWallet: record.agentWallet,
        proofDigest: null,
        reason,
        occurredAt: staleAt
      });
    }
    return (await this.repository.findIdentity(identity)) ?? record;
  }

  async revoke(identityInput: Erc8004Identity, reason = "revoked"): Promise<IdentityRecord> {
    const identity = normalizeErc8004Identity(identityInput);
    const record = await this.repository.findIdentity(identity);
    if (record === null) {
      throw ingestionError("CLAIM_NOT_ACTIVE", "The identity is not in the ingestion index.", "import_identity");
    }
    const claim = await this.repository.getClaim(erc8004IdentityKey(identity));
    if (claim === null || claim.status !== "claimed") {
      return record;
    }
    assertStateTransition("claimStatus", claim.status, "stale");
    const now = this.now();
    await this.repository.saveClaim({ ...claim, status: "stale", staleAt: now, lastReason: "revoked" });
    await this.repository.appendClaimEvent({
      identityKey: erc8004IdentityKey(identity),
      eventType: "revoked",
      claimantAddress: claim.claimantAddress,
      observedOwnerAddress: record.ownerAddress,
      observedAgentWallet: record.agentWallet,
      proofDigest: null,
      reason,
      occurredAt: now
    });
    return (await this.repository.findIdentity(identity)) ?? record;
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

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
