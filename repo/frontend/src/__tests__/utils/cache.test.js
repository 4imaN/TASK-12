import { describe, it, expect } from 'vitest';
import { normalizeSearchKey } from '../../utils/cache.js';

// We only test the pure synchronous normalizeSearchKey function here.
// The async IndexedDB-backed functions (getCachedSearch, setCachedSearch, etc.)
// require a real or fake IndexedDB and are better covered in integration tests.

describe('normalizeSearchKey', () => {
  it('produces a consistent JSON key from params', () => {
    const key = normalizeSearchKey({ origin: 'Boston', destination: 'NYC' });
    const parsed = JSON.parse(key);
    expect(parsed).toEqual({ destination: 'nyc', origin: 'boston' });
  });

  it('produces the same key regardless of property order', () => {
    const key1 = normalizeSearchKey({ origin: 'Boston', destination: 'NYC', date: '2025-06-01' });
    const key2 = normalizeSearchKey({ date: '2025-06-01', destination: 'NYC', origin: 'Boston' });
    expect(key1).toBe(key2);
  });

  it('omits empty, null, and undefined values', () => {
    const key = normalizeSearchKey({ origin: 'Boston', destination: '', extra: null, undef: undefined });
    const parsed = JSON.parse(key);
    expect(parsed).toEqual({ origin: 'boston' });
  });

  it('lowercases and trims values', () => {
    const key = normalizeSearchKey({ origin: '  BOSTON  ', destination: ' nyc ' });
    const parsed = JSON.parse(key);
    expect(parsed).toEqual({ destination: 'nyc', origin: 'boston' });
  });

  it('converts non-string values to strings', () => {
    const key = normalizeSearchKey({ page: 1, limit: 20 });
    const parsed = JSON.parse(key);
    expect(parsed).toEqual({ limit: '20', page: '1' });
  });
});
