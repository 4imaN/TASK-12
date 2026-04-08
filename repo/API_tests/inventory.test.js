const { apiGet, apiPost, apiPatch, loginCached: login } = require('./setup');

describe('Inventory API', () => {
  let token;

  beforeAll(async () => {
    token = await login('admin', 'admin123');
  });

  test('GET /api/inventory/items returns list', async () => {
    const res = await apiGet('/api/inventory/items', token);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
  });

  test('inventory items have correct structure', async () => {
    const res = await apiGet('/api/inventory/items', token);
    const items = res.data.data?.items || res.data.data;
    if (Array.isArray(items) && items.length > 0) {
      const item = items[0];
      expect(item.sku).toBeDefined();
      expect(item.name).toBeDefined();
      expect(item.on_hand !== undefined).toBe(true);
    }
  });

  test('GET /api/inventory/items without auth returns 401', async () => {
    const res = await apiGet('/api/inventory/items');
    expect(res.status).toBe(401);
  });

  test('POST /api/inventory/items creates item', async () => {
    const sku = `TST-${Date.now()}`;
    const res = await apiPost('/api/inventory/items', {
      sku, name: 'Test Item', station_id: 1, unit: 'unit', unit_cost: 5.00, reorder_point: 10, tracking_mode: 'none'
    }, token);
    expect([200, 201]).toContain(res.status);
    expect(res.data.success).toBe(true);
  });

  test('POST /api/inventory/items without sku returns 400', async () => {
    const res = await apiPost('/api/inventory/items', { name: 'No SKU', station_id: 1 }, token);
    expect(res.status).toBe(400);
  });

  test('POST /api/inventory/items without station_id returns 400', async () => {
    const res = await apiPost('/api/inventory/items', { sku: 'X-' + Date.now(), name: 'No Station' }, token);
    expect(res.status).toBe(400);
  });

  test('POST /api/inventory/movements creates receiving movement', async () => {
    const items = await apiGet('/api/inventory/items', token);
    const itemList = items.data.data?.items || items.data.data;
    if (Array.isArray(itemList) && itemList.length > 0) {
      const item = itemList[0];
      const res = await apiPost('/api/inventory/movements', {
        item_id: item.id, station_id: item.station_id,
        movement_type: 'receiving', quantity: 5, notes: 'API test'
      }, token);
      expect([200, 201]).toContain(res.status);
    }
  });

  test('POST /api/inventory/movements with invalid type returns 400', async () => {
    const res = await apiPost('/api/inventory/movements', {
      item_id: 1, station_id: 1, movement_type: 'invalid_type', quantity: 1
    }, token);
    expect(res.status).toBe(400);
  });

  test('POST /api/inventory/movements with zero quantity returns 400', async () => {
    const res = await apiPost('/api/inventory/movements', {
      item_id: 1, station_id: 1, movement_type: 'receiving', quantity: 0
    }, token);
    expect(res.status).toBe(400);
  });

  test('GET /api/inventory/movements returns list', async () => {
    const res = await apiGet('/api/inventory/movements', token);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
  });

  test('GET /api/inventory/alerts returns array', async () => {
    const res = await apiGet('/api/inventory/alerts', token);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
  });

  test('GET /api/inventory/stock-counts returns list', async () => {
    const res = await apiGet('/api/inventory/stock-counts', token);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
  });

  test('POST /api/inventory/stock-counts creates count', async () => {
    const res = await apiPost('/api/inventory/stock-counts', { station_id: 1, notes: 'API test ' + Date.now() }, token);
    expect([200, 201, 409]).toContain(res.status);
    if (res.status !== 409) {
      expect(res.data.success).toBe(true);
    }
  });
});
