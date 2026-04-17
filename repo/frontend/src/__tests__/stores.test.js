/**
 * Pinia store tests — tests store reactive state, computed properties,
 * and action signatures. Uses real Pinia, no API mocks.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Import stores — they import api.js which uses fetch, but we don't call
// actions that make network requests. We test state management logic only.

describe('Auth store — state management', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('starts with null user and unauthenticated', async () => {
    const { useAuthStore } = await import('../stores/auth.js');
    const store = useAuthStore();
    expect(store.user).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(store.role).toBe('guest');
  });

  it('isHost is false for guest', async () => {
    const { useAuthStore } = await import('../stores/auth.js');
    const store = useAuthStore();
    expect(store.isHost).toBe(false);
    expect(store.isPlatformOps).toBe(false);
  });

  it('computed role reflects user.role', async () => {
    const { useAuthStore } = await import('../stores/auth.js');
    const store = useAuthStore();
    store.user = { id: 1, role: 'host', username: 'test' };
    expect(store.role).toBe('host');
    expect(store.isHost).toBe(true);
    expect(store.isPlatformOps).toBe(false);
  });

  it('platform_ops satisfies both isHost and isPlatformOps', async () => {
    const { useAuthStore } = await import('../stores/auth.js');
    const store = useAuthStore();
    store.user = { id: 1, role: 'platform_ops', username: 'admin' };
    expect(store.isPlatformOps).toBe(true);
    expect(store.isHost).toBe(true);
  });

  it('setting user to null resets authentication', async () => {
    const { useAuthStore } = await import('../stores/auth.js');
    const store = useAuthStore();
    store.user = { id: 1, role: 'host', username: 'test' };
    expect(store.isAuthenticated).toBe(true);
    store.user = null;
    expect(store.isAuthenticated).toBe(false);
  });
});

describe('Schedule store — state management', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('starts with empty schedules array', async () => {
    const { useScheduleStore } = await import('../stores/schedules.js');
    const store = useScheduleStore();
    expect(store.schedules).toEqual([]);
    expect(store.currentSchedule).toBeNull();
    expect(store.loading).toBe(false);
  });

  it('exposes action functions', async () => {
    const { useScheduleStore } = await import('../stores/schedules.js');
    const store = useScheduleStore();
    expect(typeof store.fetchSchedules).toBe('function');
    expect(typeof store.createSchedule).toBe('function');
    expect(typeof store.validateVersion).toBe('function');
    expect(typeof store.publishVersion).toBe('function');
    expect(typeof store.rollback).toBe('function');
  });
});

describe('Inventory store — state management', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('starts with empty items and alerts', async () => {
    const { useInventoryStore } = await import('../stores/inventory.js');
    const store = useInventoryStore();
    expect(store.items).toEqual([]);
    expect(store.movements).toEqual([]);
    expect(store.stockCounts).toEqual([]);
    expect(store.alerts).toEqual([]);
  });

  it('exposes action functions', async () => {
    const { useInventoryStore } = await import('../stores/inventory.js');
    const store = useInventoryStore();
    expect(typeof store.fetchItems).toBe('function');
    expect(typeof store.createItem).toBe('function');
    expect(typeof store.createMovement).toBe('function');
    expect(typeof store.finalizeStockCount).toBe('function');
  });
});

describe('Search store — state management', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('starts with empty results', async () => {
    const { useSearchStore } = await import('../stores/search.js');
    const store = useSearchStore();
    expect(store.results).toEqual([]);
    expect(store.loading).toBe(false);
    expect(store.hotSearches).toEqual([]);
  });

  it('exposes search and hot-search actions', async () => {
    const { useSearchStore } = await import('../stores/search.js');
    const store = useSearchStore();
    expect(typeof store.searchTrips).toBe('function');
    expect(typeof store.fetchHotSearches).toBe('function');
  });
});
