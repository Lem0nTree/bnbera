import { createHash } from "node:crypto";
import type { CreatorHandoffOutcome, CreatorLifecycleHandoffs } from "./creator-worker";

type Pool = { query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<{ rows: readonly T[] }> };
const pending = (stage: string, deploymentId: string): CreatorHandoffOutcome => ({ status: "pending", operationId: `creator:${stage}:${createHash("sha256").update(deploymentId).digest("hex").slice(0, 24)}` });

/**
 * Reconciliation-only bridge to the existing G1/G2 projections. It never
 * owns an EOA, session, registration write, or payment. Until a browser has
 * submitted the canonical ERC-8004 operation and ingestion has finalized it,
 * registration stays pending. This deliberately keeps Creator deploy gated.
 */
export function createCreatorLifecycleHandoffs(pool: Pool): CreatorLifecycleHandoffs {
  return {
    async registerAndVerify({ deploymentId }) {
      const result = await pool.query<{ owner_address: string | null; agent_wallet: string | null; execution_wallet: string | null; admin_wallet: string | null; read_consistency: string | null }>(`SELECT i.owner_address,i.agent_wallet,a.execution_wallet,a.admin_wallet,i.read_consistency FROM agent_deployments d JOIN agent_drafts draft ON draft.id=d.draft_id JOIN agent_authorities a ON a.draft_id=draft.id AND a.status='active' JOIN erc8004_identities i ON i.chain_id=97 WHERE d.id=$1 AND i.owner_address IS NOT NULL AND i.agent_wallet IS NOT NULL ORDER BY i.observed_block DESC NULLS LAST LIMIT 1`, [deploymentId]);
      const row = result.rows[0];
      if (row === undefined || row.owner_address === null || row.agent_wallet === null || row.execution_wallet === null || row.admin_wallet === null || row.read_consistency !== "finalized" || row.owner_address.toLowerCase() !== row.admin_wallet.toLowerCase() || row.agent_wallet.toLowerCase() !== row.execution_wallet.toLowerCase()) return pending("erc8004-registration-browser-signature-required", deploymentId);
      // Owner is deliberately not conflated with agentWallet. The finalized
      // owner equals the intended T6 admin, while the independent wallet
      // equals the selected execution wallet.
      return { status: "confirmed", operationId: `creator:erc8004-verified:${deploymentId}` };
    },
    async publishMarketplace({ deploymentId }) {
      const result = await pool.query<{ listing_status: string; verification_status: string; runtime_status: string }>(`SELECT a.listing_status,a.verification_status,a.runtime_status FROM agent_deployments d JOIN agent_drafts draft ON draft.id=d.draft_id JOIN agent_authorities au ON au.draft_id=draft.id JOIN erc8004_identities i ON i.chain_id=97 AND lower(i.agent_wallet)=lower(au.execution_wallet) JOIN agents a ON a.identity_id=i.id WHERE d.id=$1 LIMIT 1`, [deploymentId]);
      const row = result.rows[0];
      return row?.listing_status === "published" && row.verification_status === "verified" && row.runtime_status === "live" ? { status: "confirmed", operationId: `creator:g1-publication:${deploymentId}` } : pending("g1-publication-reconcile", deploymentId);
    },
    async verifyFundedJob({ deploymentId }) {
      const result = await pool.query<{ id: string }>(`SELECT j.id FROM agent_deployments d JOIN agent_drafts draft ON draft.id=d.draft_id JOIN agent_authorities au ON au.draft_id=draft.id JOIN erc8004_identities i ON i.chain_id=97 AND lower(i.agent_wallet)=lower(au.execution_wallet) JOIN agents a ON a.identity_id=i.id JOIN commerce_jobs j ON j.agent_version_id=a.current_version_id WHERE d.id=$1 AND j.status IN ('funded','submitted','completed','settled') LIMIT 1`, [deploymentId]);
      return result.rows[0] === undefined ? pending("g2-funded-job-reconcile", deploymentId) : { status: "confirmed", operationId: `creator:g2-funded:${result.rows[0].id}` };
    },
    async activateCommerce({ deploymentId }) {
      // G2 activation is a listing projection, not a server-side payment or
      // provider key action. The existing read model must expose the offer.
      const result = await pool.query<{ public_metadata: unknown }>(`SELECT av.public_metadata FROM agent_deployments d JOIN agent_drafts draft ON draft.id=d.draft_id JOIN agent_authorities au ON au.draft_id=draft.id JOIN erc8004_identities i ON i.chain_id=97 AND lower(i.agent_wallet)=lower(au.execution_wallet) JOIN agents a ON a.identity_id=i.id JOIN agent_versions av ON av.id=a.current_version_id WHERE d.id=$1 LIMIT 1`, [deploymentId]);
      const metadata = result.rows[0]?.public_metadata as Record<string, unknown> | undefined;
      return metadata?.activationOffer !== undefined ? { status: "confirmed", operationId: `creator:g2-activation:${deploymentId}` } : pending("g2-activation-offer-reconcile", deploymentId);
    }
  };
}
