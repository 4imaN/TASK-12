const { apiGet, apiPost, loginCached: login } = require('./setup');

describe('Stations API', () => {
  test('GET /api/stations returns all stations', async () => {
    const res = await apiGet('/api/stations');
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    const data = res.data.data?.results || res.data.data;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(5);
  });

  test('GET /api/stations?q=new fuzzy matches', async () => {
    const res = await apiGet('/api/stations?q=new');
    expect(res.status).toBe(200);
    const data = res.data.data?.results || res.data.data;
    expect(data.length).toBeGreaterThan(0);
    const names = data.map(s => s.name.toLowerCase());
    expect(names.some(n => n.includes('new'))).toBe(true);
  });

  test('GET /api/stations?q=NYC matches by code', async () => {
    const res = await apiGet('/api/stations?q=NYC');
    expect(res.status).toBe(200);
    const data = res.data.data?.results || res.data.data;
    expect(data.length).toBeGreaterThan(0);
  });

  test('GET /api/stations?q= alias match', async () => {
    // Use 'penn' which matches aliases present in base seed
    const res = await apiGet('/api/stations?q=penn');
    expect(res.status).toBe(200);
    const data = res.data.data?.results || res.data.data;
    expect(data.length).toBeGreaterThan(0);
  });

  test('GET /api/stations?q=zzzzz returns empty', async () => {
    const res = await apiGet('/api/stations?q=zzzzz');
    expect(res.status).toBe(200);
    const data = res.data.data?.results || res.data.data;
    expect(data).toHaveLength(0);
  });

  test('GET /api/stations/:id returns station detail', async () => {
    const list = await apiGet('/api/stations');
    const data = list.data.data?.results || list.data.data;
    if (data.length > 0) {
      const res = await apiGet(`/api/stations/${data[0].id}`);
      expect(res.status).toBe(200);
      expect(res.data.data.code).toBeDefined();
    }
  });

  test('POST /api/stations requires platform_ops', async () => {
    const adminToken = await login('admin', 'admin123');
    const code = 'T' + Date.now().toString(36).slice(-3).toUpperCase();
    const res = await apiPost('/api/stations', { code, name: 'Test Station ' + code, name_normalized: 'test station ' + code.toLowerCase(), region: 'Test' }, adminToken);
    expect([200, 201]).toContain(res.status);
  });

  test('POST /api/stations without auth returns 401', async () => {
    const res = await apiPost('/api/stations', { code: 'XX', name: 'X' });
    expect(res.status).toBe(401);
  });
});
