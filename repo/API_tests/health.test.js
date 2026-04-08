const { apiGet } = require('./setup');

describe('Health & Infrastructure', () => {
  test('GET /api/health returns ok', async () => {
    const res = await apiGet('/api/health');
    expect(res.status).toBe(200);
    expect(res.data.data.status).toBe('ok');
    expect(res.data.data.database).toBe('connected');
  });

  test('GET /api/health includes uptime', async () => {
    const res = await apiGet('/api/health');
    expect(typeof res.data.data.uptime).toBe('number');
    expect(res.data.data.uptime).toBeGreaterThan(0);
  });

  test('unknown route returns 404', async () => {
    const res = await apiGet('/api/nonexistent');
    expect(res.status).toBe(404);
  });

  test('GET /api/trainsets requires auth — unauthenticated returns 401', async () => {
    const res = await apiGet('/api/trainsets');
    expect(res.status).toBe(401);
  });

  test('GET /api/trainsets returns list when authenticated', async () => {
    const { loginCached: doLogin } = require('./setup');
    const token = await doLogin('admin', 'admin123');
    const res = await apiGet('/api/trainsets', token);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
  });
});
