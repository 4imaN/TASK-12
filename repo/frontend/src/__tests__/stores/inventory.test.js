import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useInventoryStore } from '../../stores/inventory.js';

vi.mock('../../utils/api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  }
}));

describe('inventory store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('has correct initial state', () => {
    const store = useInventoryStore();
    expect(store.items).toEqual([]);
    expect(store.movements).toEqual([]);
    expect(store.stockCounts).toEqual([]);
    expect(store.alerts).toEqual([]);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('fetchItems populates items list', async () => {
    const { api } = await import('../../utils/api.js');
    const mockItems = [
      { id: 1, name: 'Brake Pad', sku: 'BP-001', quantity: 50 },
      { id: 2, name: 'Rail Spike', sku: 'RS-002', quantity: 200 }
    ];
    api.get.mockResolvedValueOnce({ data: mockItems });

    const store = useInventoryStore();
    await store.fetchItems();

    expect(api.get).toHaveBeenCalledWith('/inventory/items');
    expect(store.items).toEqual(mockItems);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('fetchAlerts populates alerts list', async () => {
    const { api } = await import('../../utils/api.js');
    const mockAlerts = [
      { id: 1, item_id: 1, type: 'low_stock', message: 'Brake Pad below threshold' }
    ];
    api.get.mockResolvedValueOnce({ data: mockAlerts });

    const store = useInventoryStore();
    await store.fetchAlerts();

    expect(api.get).toHaveBeenCalledWith('/inventory/alerts');
    expect(store.alerts).toEqual(mockAlerts);
  });

  it('fetchAlerts sets empty array on failure', async () => {
    const { api } = await import('../../utils/api.js');
    api.get.mockRejectedValueOnce(new Error('Server error'));

    const store = useInventoryStore();
    await store.fetchAlerts();

    expect(store.alerts).toEqual([]);
  });

  it('createMovement calls API and refreshes alerts', async () => {
    const { api } = await import('../../utils/api.js');
    const movementData = { item_id: 1, type: 'receiving', quantity: 10 };
    const mockResult = { id: 5, ...movementData };
    api.post.mockResolvedValueOnce({ data: mockResult });
    // fetchAlerts will be called after createMovement
    api.get.mockResolvedValueOnce({ data: [] });

    const store = useInventoryStore();
    const result = await store.createMovement(movementData);

    expect(api.post).toHaveBeenCalledWith('/inventory/movements', movementData);
    expect(result).toEqual(mockResult);
    // fetchAlerts should have been called
    expect(api.get).toHaveBeenCalledWith('/inventory/alerts');
  });

  it('fetchItems sets error on failure', async () => {
    const { api } = await import('../../utils/api.js');
    api.get.mockRejectedValueOnce(new Error('Connection refused'));

    const store = useInventoryStore();
    await store.fetchItems();

    expect(store.error).toBe('Connection refused');
    expect(store.items).toEqual([]);
    expect(store.loading).toBe(false);
  });

  it('fetchMovements populates movements list', async () => {
    const { api } = await import('../../utils/api.js');
    const mockMovements = [
      { id: 1, item_id: 1, type: 'receiving', quantity: 25 }
    ];
    api.get.mockResolvedValueOnce({ data: mockMovements });

    const store = useInventoryStore();
    await store.fetchMovements();

    expect(api.get).toHaveBeenCalledWith('/inventory/movements');
    expect(store.movements).toEqual(mockMovements);
    expect(store.loading).toBe(false);
  });

  it('fetchMovements sets error on failure', async () => {
    const { api } = await import('../../utils/api.js');
    api.get.mockRejectedValueOnce(new Error('Timeout'));

    const store = useInventoryStore();
    await store.fetchMovements();

    expect(store.error).toBe('Timeout');
    expect(store.movements).toEqual([]);
    expect(store.loading).toBe(false);
  });
});
