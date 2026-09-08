import type { GrantSessionOptions, Signer, Wallet } from "@altananetwork/sdk";
import { assertPolicyWithinBounds, authorityPolicyDigest, type ScopedPolicy } from "@bnbera/altana";
import { creatorTemplate } from "./creator-contract";

const signatures: Record<string, string> = {
  "0x0af28bd3": "setAgentURI(uint256,string)",
  "0x7ff36ab5": "swapExactETHForTokens(uint256,address[],address,uint256)",
};

/**
 * Server-owned construction of the sole Creator grant. Call/spend/expiry are
 * not browser or request parameters. The browser supplies only public wallet
 * identities and explicit SDK signers during its WebAuthn ceremony.
 */
export function creatorAuthorityGrant(input: {
  readonly adminAddress: `0x${string}`;
  readonly walletAddress: `0x${string}`;
  readonly sessionPublicAddress: `0x${string}`;
  readonly sessionPublicKey: `0x${string}`;
  readonly nowUnix: number;
}): { readonly policy: ScopedPolicy; readonly policyDigest: `0x${string}`; readonly sdk: GrantSessionOptions } {
  const source = creatorTemplate.contractSelectorAllowlist;
  const policy: ScopedPolicy = {
    chainId: 97,
    adminAddress: input.adminAddress,
    walletAddress: input.walletAddress,
    sessionPublicAddress: input.sessionPublicAddress,
    sessionPublicKey: input.sessionPublicKey,
    calls: source.calls.map((call) => ({ target: call.target as `0x${string}`, selectors: [...call.selectors] as `0x${string}`[], maxNativeValueWei: BigInt(call.maxNativeValueWei) })),
    spend: source.spend.map((spend) => ({ token: spend.token, limitAtomic: BigInt(spend.limitAtomic), period: spend.period })),
    expiresAtUnix: input.nowUnix + source.expirySeconds,
  };
  const bounded = assertPolicyWithinBounds(policy, { maxCallEntries: 2, maxSelectorsPerCall: 1, maxLifetimeSeconds: source.expirySeconds, maxSpendAtomic: 2_000_000_000_000_000n }, input.nowUnix);
  const permissions = {
    calls: bounded.calls.map((call) => ({ to: call.target, signature: signatures[call.selectors[0]!]! })),
    spend: bounded.spend.map((spend) => ({ ...(spend.token === "native" ? {} : { token: spend.token }), limit: spend.limitAtomic, period: spend.period })),
  } as GrantSessionOptions["permissions"];
  return { policy: bounded, policyDigest: authorityPolicyDigest(bounded), sdk: { permissions, expiry: bounded.expiresAtUnix, register: true } };
}

/** The explicit session signer is required; the grant helper never creates an admin or session secret. */
export function creatorSdkGrantRequest(input: { readonly wallet: Wallet; readonly adminSigner: Signer; readonly sessionSigner: Signer; readonly grant: ReturnType<typeof creatorAuthorityGrant> }) {
  return { wallet: input.wallet, signer: input.adminSigner, sessionSigner: input.sessionSigner, chainId: 97 as const, ...input.grant.sdk };
}
