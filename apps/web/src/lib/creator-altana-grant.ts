import { erc8004RegisterPermissions, erc8183SubmitPermissions, type ClientGrantSessionOptions, type GrantSessionOptions, type Signer, type Wallet } from "@altananetwork/sdk";
import { toFunctionSelector } from "viem";
import { assertPolicyWithinBounds, authorityPolicyDigest, type ScopedPolicy } from "@bnbera/altana";
import { creatorCommerceAction, creatorLifecycleAction, creatorSwapAction, creatorTemplate } from "./creator-contract";

const CHAIN_ID = 97 as const;
const SET_AGENT_URI_SIGNATURE = "setAgentURI(uint256,string)" as const;
const PANCAKESWAP_SIGNATURE = "swapExactETHForTokens(uint256,address[],address,uint256)" as const;
const SUBMIT_SIGNATURE = "submit(uint256,bytes32,bytes)" as const;
const REQUIRED_CALL_ENTRIES = 3;
type SdkCallPermission = NonNullable<GrantSessionOptions["permissions"]["calls"]>[number];
type SdkTargetedCallPermission = Extract<SdkCallPermission, { readonly to: `0x${string}`; readonly signature: string }>;

function isTargetedCallPermission(permission: SdkCallPermission): permission is SdkTargetedCallPermission {
  return "to" in permission && "signature" in permission;
}

/**
 * These two entries are supplied by the pinned SDK rather than re-creating
 * its supported permission helpers. A changed SDK deployment or signature
 * fails closed before a browser can request a grant.
 */
const sdkSetAgentUriPermission = erc8004RegisterPermissions(CHAIN_ID).find((permission): permission is SdkTargetedCallPermission => isTargetedCallPermission(permission) && permission.signature === SET_AGENT_URI_SIGNATURE && permission.to.toLowerCase() === creatorLifecycleAction.target);
const sdkSubmitPermission = erc8183SubmitPermissions(CHAIN_ID).find((permission): permission is SdkTargetedCallPermission => isTargetedCallPermission(permission) && permission.signature === SUBMIT_SIGNATURE && permission.to.toLowerCase() === creatorCommerceAction.target);
if (sdkSetAgentUriPermission === undefined || sdkSubmitPermission === undefined || toFunctionSelector(sdkSetAgentUriPermission.signature).toLowerCase() !== creatorLifecycleAction.selector || toFunctionSelector(sdkSubmitPermission.signature).toLowerCase() !== creatorCommerceAction.selector) {
  throw new Error("CREATOR_SDK_PERMISSION_PIN_MISMATCH");
}
const pinnedSetAgentUriPermission = sdkSetAgentUriPermission;
const pinnedSubmitPermission = sdkSubmitPermission;
const requiredActions = [creatorLifecycleAction, creatorSwapAction, creatorCommerceAction] as const;

function permissionForCall(call: ScopedPolicy["calls"][number]): SdkCallPermission {
  if (call.selectors.length !== 1) throw new Error("CREATOR_POLICY_SELECTOR_COUNT_MISMATCH");
  const selector = call.selectors[0]!.toLowerCase();
  const target = call.target.toLowerCase();
  if (target === creatorLifecycleAction.target && selector === creatorLifecycleAction.selector) return { to: call.target, signature: pinnedSetAgentUriPermission.signature };
  if (target === creatorSwapAction.target && selector === creatorSwapAction.selector && toFunctionSelector(PANCAKESWAP_SIGNATURE).toLowerCase() === selector) return { to: call.target, signature: PANCAKESWAP_SIGNATURE };
  if (target === creatorCommerceAction.target && selector === creatorCommerceAction.selector) return { to: call.target, signature: pinnedSubmitPermission.signature };
  throw new Error("CREATOR_POLICY_CALL_PIN_MISMATCH");
}

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
    chainId: CHAIN_ID,
    adminAddress: input.adminAddress,
    walletAddress: input.walletAddress,
    sessionPublicAddress: input.sessionPublicAddress,
    sessionPublicKey: input.sessionPublicKey,
    calls: source.calls.map((call) => ({ target: call.target as `0x${string}`, selectors: [...call.selectors] as `0x${string}`[], maxNativeValueWei: BigInt(call.maxNativeValueWei) })),
    spend: source.spend.map((spend) => ({ token: spend.token, limitAtomic: BigInt(spend.limitAtomic), period: spend.period })),
    expiresAtUnix: input.nowUnix + source.expirySeconds,
  };
  const bounded = assertPolicyWithinBounds(policy, { maxCallEntries: REQUIRED_CALL_ENTRIES, maxSelectorsPerCall: 1, maxLifetimeSeconds: source.expirySeconds, maxSpendAtomic: 2_000_000_000_000_000n }, input.nowUnix);
  const requiredKeys = new Set(requiredActions.map((action) => `${action.target}:${action.selector}`));
  const actualKeys = new Set(bounded.calls.map((call) => `${call.target}:${call.selectors[0] ?? ""}`));
  if (bounded.calls.length !== REQUIRED_CALL_ENTRIES || actualKeys.size !== requiredKeys.size || [...actualKeys].some((key) => !requiredKeys.has(key)) || bounded.calls.some((call) => {
    const expected = requiredActions.find((action) => action.target === call.target && action.selector === call.selectors[0]);
    return expected === undefined || expected.valueWei !== call.maxNativeValueWei;
  })) throw new Error("CREATOR_POLICY_CALL_PIN_MISMATCH");
  const permissions = {
    calls: bounded.calls.map(permissionForCall),
    spend: bounded.spend.map((spend) => ({ ...(spend.token === "native" ? {} : { token: spend.token }), limit: spend.limitAtomic, period: spend.period })),
  } as GrantSessionOptions["permissions"];
  return { policy: bounded, policyDigest: authorityPolicyDigest(bounded), sdk: { permissions, expiry: bounded.expiresAtUnix, register: true } };
}

/** The explicit session signer is required; the grant helper never creates an admin or session secret. */
export function creatorSdkGrantRequest(input: { readonly wallet: Wallet; readonly adminSigner: Signer; readonly sessionSigner: Signer; readonly grant: ReturnType<typeof creatorAuthorityGrant> }): ClientGrantSessionOptions {
  // This is the exact object accepted by `client.grantSession(...)` in the
  // installed SDK. It intentionally does not call the unsupported top-level
  // overload or invent a browser-specific grant transport.
  return { wallet: input.wallet, signer: input.adminSigner, sessionSigner: input.sessionSigner, chainId: CHAIN_ID, ...input.grant.sdk };
}
