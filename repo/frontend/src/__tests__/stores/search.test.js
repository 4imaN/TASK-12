import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSearchStore } from '../../stores/search.js';

// Mock the api module
vi.mock('../../utils/api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn()
  }
}));

// Mock the cache module
vi.mock('../../utils/cache.js', () => ({
  getCachedSearch: vi.fn(() => Promise.resolve(null)),
  setCachedSearch: vi.fn(() => Promise.resolve()),
  normalizeSearchKey: vi.fn((params) => JSON.stringify(params))
}));

describe('search store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('has correct initial state', () => {
    const search = useSearchStore();
    expect(search.results).toEqual([]);
    expect(search.loading).toBe(false);
    expect(search.error).toBeNull();
    expect(search.hotSearches).toEqual([]);
    expect(search.nearbySuggestions).toEqual([]);
    expect(search.lastFilters).toEqual({});
  });

  it('searchTrips sets results on success', async () => {
    const { api } = await import('../../utils/api.js');
    api.get.mockResolvedValueOnce({
      data: {
        results: [
          { id: 1, origin: 'StationA', destination: 'StationB', departure: '08:00' },
          { id: 2, origin: 'StationA', destination: 'StationC', departure: '09:30' }
        ],
        nearbySuggestions: []
      }
    });

    const search = useSearchStore();
    await search.searchTrips({ origin: 'StationA', destination: 'StationB' });

    expect(search.results).toHaveLength(2);
    expect(search.results[0].origin).toBe('StationA');
    expect(search.loading).toBe(false);
    expect(search.error).toBeNull();
  });

  it('searchTrips handles API errors gracefully', async () => {
    const { api } = await import('../../utils/api.js');
    const err = new Error('Network error');
    err.data = { error: { message: 'Network error' } };
    api.get.mockRejectedValueOnce(err);

    const search = useSearchStore();
    await search.searchTrips({ origin: 'StationX' });

    expect(search.results).toEqual([]);
    expect(search.error).toBe('Network error');
    expect(search.loading).toBe(false);
  });

  it('searchTrips uses cached results when available', async () => {
    const { getCachedSearch } = await import('../../utils/cache.js');
    getCachedSearch.mockResolvedValueOnce({
      results: [{ id: 99, origin: 'Cached', destination: 'Data' }],
      nearbySuggestions: ['Nearby1']
    });

    const { api } = await import('../../utils/api.js');

    const search = useSearchStore();
    await search.searchTrips({ origin: 'Cached' });

    expect(search.results).toHaveLength(1);
    expect(search.results[0].origin).toBe('Cached');
    expect(search.nearbySuggestions).toEqual(['Nearby1']);
    // API should NOT have been called since cache hit
    expect(api.get).not.toHaveBeenCalled();
  });
});
