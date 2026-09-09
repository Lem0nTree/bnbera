import { describe, expect, it } from 'vitest';
import { isDirectoryIdentifierQuery } from './directory-search';

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
