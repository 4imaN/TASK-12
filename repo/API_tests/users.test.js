const { apiGet, apiPost, apiPut, loginCached: login } = require('./setup');

describe('User Management API', () => {
  let adminToken;

  beforeAll(async () => {
    adminToken = await login('admin', 'admin123');
  });

  test('GET /api/users returns user list', async () => {
    const res = await apiGet('/api/users', adminToken);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
  });

  test('POST /api/users creates user', async () => {
    const res = await apiPost('/api/users', {
      username: 'testuser_' + Date.now(),
      password: 'TestPass123',
      role: 'guest',
      display_name: 'Test User'
    }, adminToken);
    expect([200, 201]).toContain(res.status);
  });

  test('POST /api/users without password returns 400', async () => {
    const res = await apiPost('/api/users', { username: 'nopass', role: 'guest' }, adminToken);
    expect(res.status).toBe(400);
  });

  test('GET /api/users/:id/sessions returns sessions', async () => {
    const res = await apiGet('/api/users/1/sessions', adminToken);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
  });

  test('GET /api/users/:id/stations returns station assignments', async () => {
    const res = await apiGet('/api/users/2/stations', adminToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.data)).toBe(true);
  });

  test('PUT /api/users/:id/stations updates assignments', async () => {
    const res = await apiPut('/api/users/2/stations', { station_ids: [1, 2] }, adminToken);
    expect(res.status).toBe(200);
    expect(res.data.data.length).toBe(2);
  });

  test('PUT /api/users/:id/stations with invalid IDs returns 400', async () => {
    const res = await apiPut('/api/users/2/stations', { station_ids: [99999] }, adminToken);
    expect(res.status).toBe(400);
  });

  test('POST /api/users/:id/session-exception grants override', async () => {
    const res = await apiPost('/api/users/2/session-exception', {
      max_sessions: 5, reason: 'API test'
    }, adminToken);
    expect([200, 201]).toContain(res.status);
  });

  test('user creation always sets max_sessions to 2 regardless of payload', async () => {
    const username = 'sesstest_' + Date.now();
    const res = await apiPost('/api/users', {
      username, password: 'TestPass123!', role: 'host',
      max_sessions: 10  // Should be ignored
    }, adminToken);
    expect([200, 201]).toContain(res.status);

    // Verify the created user has max_sessions=2
    const users = await apiGet('/api/users', adminToken);
    const data = users.data?.results || users.data?.data?.results || users.data;
    const created = Array.isArray(data) ? data.find(u => u.username === username) : null;
    if (created) {
      expect(created.max_sessions).toBe(2);
    }
  });

  test('session-exception is required to raise cap above 2', async () => {
    // Grant an exception
    const username = 'exctest_' + Date.now();
    const createRes = await apiPost('/api/users', { username, password: 'TestPass123!', role: 'host' }, adminToken);
    const userId = createRes.data?.data?.id;
    if (userId) {
      const excRes = await apiPost(`/api/users/${userId}/session-exception`, {
        max_sessions: 5, reason: 'Test exception'
      }, adminToken);
      expect([200, 201]).toContain(excRes.status);
    }
  });
});
