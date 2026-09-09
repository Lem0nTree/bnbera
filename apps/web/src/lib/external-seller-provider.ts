import { randomUUID } from "node:crypto";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { CommerceError, ExternalErc8183SellerAdapter, type ExternalSellerBinding, type ExternalSellerQuote, type EnabledErc8183DeploymentPin } from "@bnbera/agent-commerce";
import { erc8004IdentityKey } from "@bnbera/domain";
import { BoundedMetadataResolver } from "@bnbera/agent-ingestion";
import { mainnetSellerProfile, mainnetSellerTask } from "./mainnet-seller-catalog";
import { createExternalSellerTransport } from "./external-seller-transport";
import type { CommerceProviderReadinessInput, CommerceProviderReadinessResolver } from "./commerce-reservations";

const registryAbi = parseAbi(["function getAgentWallet(uint256) view returns(address)", "function ownerOf(uint256) view returns(address)", "function tokenURI(uint256) view returns(string)"]);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function fail(message: string): never { throw new CommerceError({ code: "COMMERCE_DISABLED", message, nextAction: "refresh_seller_offer" }); }

/** Provider identity is public registry state, not an operator-held signing key.
 * This resolver only makes read-only card/identity/negotiation requests. */
export function createExternalSellerReadinessResolver(input: {
  pin: EnabledErc8183DeploymentPin; routerContract: string; policyContract: string; rpcUrl: string;
}): CommerceProviderReadinessResolver {
  if (input.pin.chainId !== 56) fail("External seller readiness requires the reviewed BSC mainnet deployment.");
  const transport = createExternalSellerTransport();
  const client = createPublicClient({ transport: http(input.rpcUrl, { timeout: 12000, retryCount: 1 }) });
  const cache = new Map<string, { at: number; binding: ExternalSellerBinding }>();
  async function readIdentity(binding: ExternalSellerBinding) {
    if (await client.getChainId() !== 56) fail("The seller identity RPC returned the wrong network.");
    const block = await client.getBlock({ blockTag: "finalized" });
    const address = binding.identity.identityRegistry as Address; const args = [BigInt(binding.identity.agentId)] as const;
    const [agentWallet, owner, uri] = await Promise.all([client.readContract({ address, abi: registryAbi, functionName: "getAgentWallet", args, blockNumber: block.number }), client.readContract({ address, abi: registryAbi, functionName: "ownerOf", args, blockNumber: block.number }), client.readContract({ address, abi: registryAbi, functionName: "tokenURI", args, blockNumber: block.number })]);
    if (agentWallet.toLowerCase() !== binding.providerAddress.toLowerCase()) fail("The external seller wallet changed in the finalized registry.");
    const profile = mainnetSellerProfile(binding.identity);
    const metadata = record((await new BoundedMetadataResolver({ timeoutMs: 8000, maxBytes: 1048576 }).resolve(uri, null)).document);
    if (!profile || !Array.isArray(metadata.services) || !metadata.services.some(service => {
      const value = record(service); return String(value.name).toLowerCase() === "a2a" && (value.endpoint ?? value.url) === profile.card;
    })) fail("The finalized registration no longer publishes the reviewed seller card.");
    return { agentWallet, owner, finalizedBlock: String(block.number) };
  }
  async function binding(listing: CommerceProviderReadinessInput): Promise<ExternalSellerBinding> {
    const profile = mainnetSellerProfile(listing.identity);
    if (!profile || listing.providerAddress.toLowerCase() !== profile.wallet.toLowerCase() || listing.service.url !== profile.card) fail("This listing has no reviewed live negotiation and delivery integration.");
    if (listing.identity.chainId !== 56 || listing.identity.identityRegistry.toLowerCase() !== "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432" || listing.authorityStatus !== "none" || listing.commerceContract.toLowerCase() !== input.pin.commerceContract.toLowerCase() || listing.paymentToken.toLowerCase() !== input.pin.paymentToken.toLowerCase() || listing.paymentDecimals !== 18 || BigInt(listing.priceAtomic) > BigInt(input.pin.maxBudgetAtomic)) fail("The external listing does not match the exact mainnet identity, token and budget boundary.");
    const key = `${erc8004IdentityKey(listing.identity)}:${listing.providerAddress}:${listing.service.url}`;
    const previous = cache.get(key);
    if (previous && Date.now() - previous.at < 15000) return previous.binding;
    const card = record((await transport.get(listing.service.url)).body);
    const skills = Array.isArray(card.skills) ? card.skills.map(skill => record(skill).id) : [];
    if (!skills.includes("negotiate") || !skills.includes("notify_funded") || typeof card.url !== "string") fail("The verified seller card must expose both signed negotiation and funded-job delivery.");
    const endpoint = new URL(card.url);
    if (endpoint.toString() !== profile.endpoint) fail("The seller endpoint changed from its reviewed negotiation and delivery binding.");
    if (endpoint.origin !== new URL(listing.service.url).origin || endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) fail("The seller must expose a credential-free same-origin A2A endpoint.");
    const resultBaseUrl = new URL(endpoint.origin);
    const value: ExternalSellerBinding = { identity: listing.identity, providerAddress: listing.providerAddress, endpoint: endpoint.toString(), resultBaseUrl: resultBaseUrl.toString().replace(/\/$/u, ""), commerceContract: input.pin.commerceContract, routerContract: input.routerContract, policyContract: input.policyContract, paymentToken: input.pin.paymentToken, maxPriceAtomic: input.pin.maxBudgetAtomic };
    await readIdentity(value); cache.set(key, { at: Date.now(), binding: value }); return value;
  }
  const adapter = (value: ExternalSellerBinding) => new ExternalErc8183SellerAdapter(value, { transport, randomId: randomUUID, readIdentity, readJob: async () => fail("This readiness adapter does not accept funded-job actions.") });
  return {
    async resolve(listing) { await binding(listing); return { status: "ready", identity: listing.identity, providerAddress: listing.providerAddress, endpoint: listing.service.url, verificationMode: "external-signed-offer", observedAt: new Date().toISOString() }; },
    async negotiate(listing, task) {
      const profile = mainnetSellerProfile(listing.identity);
      if (!profile) fail("The seller has no reviewed task contract.");
      let requested;
      try { requested = mainnetSellerTask(profile, task); } catch (cause) { throw new CommerceError({ code: "INVALID_QUOTE", message: cause instanceof Error ? cause.message : "Invalid seller task.", nextAction: "correct_seller_task" }); }
      return adapter(await binding(listing)).negotiate(requested);
    },
    async verifySavedOffer(listing, quote: ExternalSellerQuote) { const value = await binding(listing); await readIdentity(value); await adapter(value).assertQuote(quote); }
  };
}
