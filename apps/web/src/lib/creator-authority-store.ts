import type { CreatorAuthorityDraftResolver, CreatorAuthorityRecord, CreatorAuthorityStore } from "@bnbera/altana";

/** Existing-table persistence seam.  Session id/digest live inside the public
 * calls_allowlist envelope; secret_reference remains the only secret field. */
export type CreatorAuthorityPool = { query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }> };
type Row = { id: string; draft_id: string; admin_wallet: string; calls_allowlist: unknown; spend_limits: unknown; expires_at: Date; keystore_registration_tx: string | null; secret_reference: string | null; status: "active" | "expired" | "revoked" | "unknown"; last_verified_block: string | null };

function decode(row: Row): CreatorAuthorityRecord | null {
  const meta = typeof row.calls_allowlist === "object" && row.calls_allowlist !== null ? row.calls_allowlist as Record<string, unknown> : null;
  if (meta === null || typeof meta.sessionId !== "string" || typeof meta.policyDigest !== "string" || row.secret_reference === null) return null;
  return { authorityId: row.id, draftId: row.draft_id, ownerAddress: row.admin_wallet, secretReference: row.secret_reference, descriptor: { sessionId: meta.sessionId, policyDigest: meta.policyDigest as `0x${string}`, grantTransactionHash: row.keystore_registration_tx as `0x${string}` | null, secretReference: row.secret_reference, grantedAtUnix: Math.floor(row.expires_at.getTime()/1000)-3600, policy: meta.policy as CreatorAuthorityRecord["descriptor"]["policy"] }, handoff: meta.handoff as CreatorAuthorityRecord["handoff"], observation: { sessionId: meta.sessionId, policyDigest: meta.policyDigest as `0x${string}`, status: row.status, observedAtUnix: Math.floor(Date.now()/1000), observedBlockNumber: row.last_verified_block === null ? null : BigInt(row.last_verified_block), source: "chain-read", reasonCode: null } };
}
export function createPostgresCreatorAuthorityStore(pool: CreatorAuthorityPool): CreatorAuthorityStore & CreatorAuthorityDraftResolver {
  return {
    async ownerAddressForDraft(draftId) { const r = await pool.query<{ wallet_address: string }>(`SELECT s.wallet_address FROM agent_drafts d JOIN auth_sessions s ON s.user_id=d.creator_user_id WHERE d.id=$1 AND s.revoked_at IS NULL AND s.expires_at>NOW() ORDER BY s.issued_at DESC LIMIT 1`, [draftId]); return r.rows[0]?.wallet_address ?? null; },
    async get(id) { const r=await pool.query<Row>(`SELECT * FROM agent_authorities WHERE id=$1 LIMIT 1`,[id]); return r.rows[0] === undefined ? null : decode(r.rows[0]); },
    async getByDraft(draftId) { const r=await pool.query<Row>(`SELECT * FROM agent_authorities WHERE draft_id=$1 ORDER BY "updatedAt" DESC LIMIT 1`,[draftId]); return r.rows[0] === undefined ? null : decode(r.rows[0]); },
    async put(record) { await pool.query(`INSERT INTO agent_authorities (id,draft_id,chain_id,wallet_provider,execution_wallet,altana_smart_wallet,admin_wallet,session_public_address,calls_allowlist,spend_limits,expires_at,keystore_registration_tx,last_verified_block,status,secret_reference) VALUES ($1,$2,$3,'altana',$4,$4,$5,$6,$7::jsonb,$8::jsonb,to_timestamp($9),$10,$11,$12,$13) ON CONFLICT (id) DO UPDATE SET calls_allowlist=EXCLUDED.calls_allowlist,spend_limits=EXCLUDED.spend_limits,status=EXCLUDED.status,last_verified_block=EXCLUDED.last_verified_block,secret_reference=EXCLUDED.secret_reference,"updatedAt"=NOW()`, [record.authorityId,record.draftId,record.descriptor.policy.chainId,record.descriptor.policy.walletAddress,record.ownerAddress,record.descriptor.policy.sessionPublicAddress,JSON.stringify({sessionId:record.descriptor.sessionId,policyDigest:record.descriptor.policyDigest,policy:record.descriptor.policy,handoff:record.handoff}),JSON.stringify(record.descriptor.policy.spend),record.descriptor.policy.expiresAtUnix,record.descriptor.grantTransactionHash,record.observation.observedBlockNumber?.toString()??null,record.observation.status,record.secretReference]); }
  };
}
