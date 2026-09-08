import { createHash } from "node:crypto";
import type { CreatorHandoffOutcome, CreatorLifecycleHandoffs } from "./creator-worker";

type Pool = { query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }> };
export type CreatorIdentityBinding = { readonly namespace: "eip155"; readonly chainId: 97; readonly identityRegistry: string; readonly agentId: string; readonly agentVersionId: string; readonly endpoint: string; readonly ownerAddress: string; readonly agentWallet: string };
const pending = (stage: string, deploymentId: string): CreatorHandoffOutcome => ({ status: "pending", operationId: `creator:${stage}:${createHash("sha256").update(deploymentId).digest("hex").slice(0, 24)}` });
function asBinding(value: unknown): CreatorIdentityBinding | null { const v = typeof value === "object" && value !== null ? value as Record<string, unknown> : null; return v !== null && v.namespace === "eip155" && v.chainId === 97 && ["identityRegistry", "agentId", "agentVersionId", "endpoint", "ownerAddress", "agentWallet"].every((key) => typeof v[key] === "string") ? v as CreatorIdentityBinding : null; }
async function persistedBinding(pool: Pool, deploymentId: string): Promise<CreatorIdentityBinding | null> { const result = await pool.query<{ binding: unknown }>(`SELECT external_resource_references->'erc8004Identity' AS binding FROM deployment_events WHERE deployment_id=$1 AND status_message='CREATOR_ERC8004_BROWSER_OPERATION' ORDER BY created_at DESC LIMIT 1`, [deploymentId]); return asBinding(result.rows[0]?.binding); }

/** Reconciles only a browser-persisted full identity tuple; it never selects a
 * latest identity or infers ownership from an execution wallet. */
export function createCreatorLifecycleHandoffs(pool: Pool, resolveBinding: (deploymentId: string) => Promise<CreatorIdentityBinding | null> = (id) => persistedBinding(pool, id)): CreatorLifecycleHandoffs {
  const bound = async (id: string, endpoint?: string) => { const value = await resolveBinding(id); return value === null || (endpoint !== undefined && value.endpoint !== endpoint) ? null : value; };
  const identity = (b: CreatorIdentityBinding) => [b.namespace, b.chainId, b.identityRegistry, b.agentId, b.agentVersionId];
  return {
    async registerAndVerify({ deploymentId, endpoint }) {
      const b = await bound(deploymentId, endpoint); if (b === null) return pending("erc8004-browser-signature-required", deploymentId);
      const result = await pool.query<{ owner_address: string | null; agent_wallet: string | null; admin_wallet: string | null; url: string | null }>(`SELECT i.owner_address,i.agent_wallet,au.admin_wallet,s.url FROM agent_deployments d JOIN agent_authorities au ON au.draft_id=d.draft_id AND au.status='active' JOIN erc8004_identities i ON i.namespace=$2 AND i.chain_id=$3 AND lower(i.identity_registry)=lower($4) AND i.agent_id=$5 JOIN agents a ON a.identity_id=i.id JOIN agent_versions av ON av.id=a.current_version_id AND av.id=$6 LEFT JOIN agent_services s ON s.agent_version_id=av.id AND s.url=$7 WHERE d.id=$1 LIMIT 1`, [deploymentId, ...identity(b), b.endpoint]);
      const row = result.rows[0];
      return row !== undefined && row.owner_address?.toLowerCase() === b.ownerAddress.toLowerCase() && row.admin_wallet?.toLowerCase() === b.ownerAddress.toLowerCase() && row.agent_wallet?.toLowerCase() === b.agentWallet.toLowerCase() && row.url === b.endpoint ? { status: "confirmed", operationId: `creator:erc8004-verified:${deploymentId}` } : pending("erc8004-browser-signature-required", deploymentId);
    },
    async publishMarketplace({ deploymentId }) {
      const b = await bound(deploymentId); if (b === null) return pending("g1-publication-reconcile", deploymentId);
      const result = await pool.query<{ listing_status: string; verification_status: string; runtime_status: string }>(`SELECT a.listing_status,a.verification_status,a.runtime_status FROM erc8004_identities i JOIN agents a ON a.identity_id=i.id JOIN agent_versions av ON av.id=a.current_version_id AND av.id=$5 WHERE i.namespace=$1 AND i.chain_id=$2 AND lower(i.identity_registry)=lower($3) AND i.agent_id=$4 LIMIT 1`, identity(b)); const row = result.rows[0];
      return row?.listing_status === "published" && row.verification_status === "verified" && row.runtime_status === "live" ? { status: "confirmed", operationId: `creator:g1-publication:${deploymentId}` } : pending("g1-publication-reconcile", deploymentId);
    },
    async verifyFundedJob({ deploymentId, endpoint }) {
      const b = await bound(deploymentId, endpoint); if (b === null) return pending("g2-funded-job-reconcile", deploymentId);
      const result = await pool.query<{ id: string }>(`SELECT j.id FROM erc8004_identities i JOIN agents a ON a.identity_id=i.id JOIN agent_versions av ON av.id=a.current_version_id AND av.id=$5 JOIN agent_services s ON s.agent_version_id=av.id AND s.url=$6 JOIN commerce_jobs j ON j.agent_version_id=av.id WHERE i.namespace=$1 AND i.chain_id=$2 AND lower(i.identity_registry)=lower($3) AND i.agent_id=$4 AND j.status IN ('funded','submitted','completed','settled') LIMIT 1`, [...identity(b), b.endpoint]);
      return result.rows[0] === undefined ? pending("g2-funded-job-reconcile", deploymentId) : { status: "confirmed", operationId: `creator:g2-funded:${result.rows[0].id}` };
    },
    async activateCommerce({ deploymentId }) {
      const b = await bound(deploymentId); if (b === null) return pending("g2-activation-offer-reconcile", deploymentId);
      const result = await pool.query<{ public_metadata: unknown }>(`SELECT av.public_metadata FROM erc8004_identities i JOIN agents a ON a.identity_id=i.id JOIN agent_versions av ON av.id=a.current_version_id AND av.id=$5 WHERE i.namespace=$1 AND i.chain_id=$2 AND lower(i.identity_registry)=lower($3) AND i.agent_id=$4 LIMIT 1`, identity(b)); const metadata = result.rows[0]?.public_metadata as Record<string, unknown> | undefined;
      return metadata?.activationOffer !== undefined ? { status: "confirmed", operationId: `creator:g2-activation:${deploymentId}` } : pending("g2-activation-offer-reconcile", deploymentId);
    }
  };
}
