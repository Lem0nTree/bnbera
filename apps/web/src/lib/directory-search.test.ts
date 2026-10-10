import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { isDirectoryIdentifierQuery, searchDirectoryCatalog } from './directory-search';

describe('directory query intent', () => {
  it('keeps token IDs, addresses and numbered slugs as keyword lookups', () => {
    for (const query of ['341565', '0x' + 'a'.repeat(40), 'agent-56-341565', 'zzzz-no-such-agent-918273']) {
      expect(isDirectoryIdentifierQuery(query)).toBe(true);
    }
  });
  it('allows semantic expansion for capability and protocol searches', () => {
    for (const query of ['prevent loan liquidation', 'concentrated liquidity range management', 'lending', 'erc8004', 'yield-farming']) {
      expect(isDirectoryIdentifierQuery(query)).toBe(false);
    }
  });
});


describe('directory catalog resource bounds', () => {
  const result = {total: 1, ids: ['identity'], registered: 1, mainnet: 1, testnet: 0, vector_matches: 0};
  const input = {limit: 20, sort: 'relevance' as const};
  it('coalesces identical concurrent reads and isolates filters', async () => {
    const query = vi.fn(async (_sql: string, _values: unknown[]) => ({rows: [result]}));
    const pool = {query} as unknown as pg.Pool;
    await Promise.all([searchDirectoryCatalog(pool, input), searchDirectoryCatalog(pool, {...input})]);
    expect(query).toHaveBeenCalledTimes(1);
    await searchDirectoryCatalog(pool, {...input, chainId: 97});
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('retries failed reads instead of caching an unavailable result', async () => {
    const query = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue({rows: [result]});
    const pool = {query} as unknown as pg.Pool;
    await expect(searchDirectoryCatalog(pool, input)).rejects.toThrow('unavailable');
    expect(await searchDirectoryCatalog(pool, input)).toEqual(result);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('uses cached metadata with current registry and listing eligibility', async () => {
    vi.stubEnv('BNBERA_DIRECTORY_CATALOG_CACHE_ENABLED', 'true');
    try {
      const query = vi.fn(async (_sql: string, _values: unknown[]) => ({rows: [result]}));
      await searchDirectoryCatalog({query} as unknown as pg.Pool, input);
      expect(query.mock.calls[0]?.[0]).toContain('from bnbera_directory_catalog_cache c join erc8004_identities');
      expect(query.mock.calls[0]?.[0]).toContain("a.listing_status not in('delisted','suspended')");
      expect(query.mock.calls[0]?.[0]).toContain("i.read_consistency='finalized'");
    } finally { vi.unstubAllEnvs(); }
  });
  it('keeps large registration bodies out of browse sorts but retains keyword evidence', async () => {
    const query = vi.fn(async (_sql: string, _values: unknown[]) => ({rows: [result]}));
    const pool = {query} as unknown as pg.Pool;
    await searchDirectoryCatalog(pool, input);
    expect(query.mock.calls[0]?.[0]).not.toContain('eo.normalized_payload as profile');
    await searchDirectoryCatalog(pool, {...input, query: '341565'});
    expect(query.mock.calls[1]?.[0]).toContain('eo.normalized_payload as profile');
  });
});
