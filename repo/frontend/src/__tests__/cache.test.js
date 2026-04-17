/**
 * Cache utility tests — pure logic, no API mocks.
 * Tests normalizeSearchKey which is a pure function.
 */
import { describe, it, expect } from 'vitest';
import { normalizeSearchKey } from '../utils/cache.js';

describe('normalizeSearchKey', () => {
  it('produces consistent key from params', () => {
    const key = normalizeSearchKey({ origin: 'NYC', destination: 'WAS' });
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('produces same key regardless of property order', () => {
    const k1 = normalizeSearchKey({ origin: 'NYC', destination: 'WAS' });
    const k2 = normalizeSearchKey({ destination: 'WAS', origin: 'NYC' });
    expect(k1).toBe(k2);
  });

  it('omits empty/null/undefined values', () => {
    const k1 = normalizeSearchKey({ origin: 'NYC', date: '' });
    const k2 = normalizeSearchKey({ origin: 'NYC' });
    expect(k1).toBe(k2);
  });

  it('lowercases and trims values', () => {
    const k1 = normalizeSearchKey({ origin: 'NYC' });
    const k2 = normalizeSearchKey({ origin: '  nyc  ' });
    expect(k1).toBe(k2);
  });

  it('converts non-string values to strings', () => {
    const key = normalizeSearchKey({ page: 1, limit: 25 });
    expect(key).toContain('1');
    expect(key).toContain('25');
  });
});
