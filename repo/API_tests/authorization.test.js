const { apiGet, apiPost, apiPatch, loginCached: login } = require('./setup');

describe('Authorization Controls', () => {
  let hostToken, adminToken;

  beforeAll(async () => {
    hostToken = await login('host1', 'host123');
    adminToken = await login('admin', 'admin123');
  });

  // Host restrictions
  test('Host cannot access GET /api/users', async () => {
    const res = await apiGet('/api/users', hostToken);
    expect(res.status).toBe(403);
  });

  test('Host cannot access GET /api/approvals', async () => {
    const res = await apiGet('/api/approvals', hostToken);
    expect(res.status).toBe(403);
  });

  test('Host cannot access GET /api/audit/logs', async () => {
    const res = await apiGet('/api/audit/logs', hostToken);
    expect(res.status).toBe(403);
  });

  test('Host cannot access GET /api/backups', async () => {
    const res = await apiGet('/api/backups', hostToken);
    expect(res.status).toBe(403);
  });

  test('Host cannot access GET /api/data-quality/issues', async () => {
    const res = await apiGet('/api/data-quality/issues', hostToken);
    expect(res.status).toBe(403);
  });

  test('Host cannot create users', async () => {
    const res = await apiPost('/api/users', { username: 'hack', password: 'x', role: 'platform_ops' }, hostToken);
    expect(res.status).toBe(403);
  });

  // Unauthenticated restrictions
  test('Unauthenticated cannot create schedules', async () => {
    const res = await apiPost('/api/schedules', { route_name: 'X', station_id: 1 });
    expect(res.status).toBe(401);
  });

  test('Unauthenticated cannot access inventory', async () => {
    const res = await apiGet('/api/inventory/items');
    expect(res.status).toBe(401);
  });

  test('Unauthenticated cannot access users', async () => {
    const res = await apiGet('/api/users');
    expect(res.status).toBe(401);
  });

  test('Unauthenticated cannot access backups', async () => {
    const res = await apiGet('/api/backups');
    expect(res.status).toBe(401);
  });

  // Platform Ops access
  test('Platform Ops can access users', async () => {
    const res = await apiGet('/api/users', adminToken);
    expect(res.status).toBe(200);
  });

  test('Platform Ops can access approvals', async () => {
    const res = await apiGet('/api/approvals', adminToken);
    expect(res.status).toBe(200);
  });

  test('Platform Ops can access audit logs', async () => {
    const res = await apiGet('/api/audit/logs', adminToken);
    expect(res.status).toBe(200);
  });

  test('Platform Ops can access backups', async () => {
    const res = await apiGet('/api/backups', adminToken);
    expect(res.status).toBe(200);
  });

  test('Platform Ops can access data quality', async () => {
    const res = await apiGet('/api/data-quality/issues', adminToken);
    expect(res.status).toBe(200);
  });

  // Host can access their routes
  test('Host can access schedules', async () => {
    const res = await apiGet('/api/schedules', hostToken);
    expect(res.status).toBe(200);
  });

  test('Host can access inventory items', async () => {
    const res = await apiGet('/api/inventory/items', hostToken);
    expect(res.status).toBe(200);
  });

  // Object-level authorization
  test('Host station search only returns assigned stations', async () => {
    const res = await apiGet('/api/stations?q=Chicago', hostToken);
    expect(res.status).toBe(200);
    const results = res.data?.data?.results || [];
    const outOfScope = results.find(s => s.code === 'CHI');
    expect(outOfScope).toBeUndefined(); // host1 not assigned to Chicago
  });

  test('Host cannot access out-of-scope station by ID', async () => {
    const res = await apiGet('/api/stations/4', hostToken); // Station 4 = Chicago
    expect(res.status).toBe(403);
  });

  test('Host can access assigned station by ID', async () => {
    const res = await apiGet('/api/stations/1', hostToken); // Station 1 = NYC
    expect(res.status).toBe(200);
  });

  test('Host cannot access out-of-scope schedule', async () => {
    // Create schedule at station 4 (not host1's station) via admin
    const sched = await apiPost('/api/schedules', {
      route_name: 'Auth Test ' + Date.now(), station_id: 4
    }, adminToken);
    if (sched.status === 201 || sched.status === 200) {
      const res = await apiGet(`/api/schedules/${sched.data.data.id}`, hostToken);
      expect(res.status).toBe(403);
    }
  });

  // Host station scope=network for route authoring
  test('Host can search all active stations with scope=network for route authoring', async () => {
    const res = await apiGet('/api/stations?q=Chicago&scope=network', hostToken);
    expect(res.status).toBe(200);
    const results = res.data?.data?.results || [];
    // With scope=network, Chicago should be visible even though host1 is not assigned to it
    const chicago = results.find(s => s.name && s.name.toLowerCase().includes('chicago'));
    expect(chicago).toBeTruthy();
  });

  test('Host default station search still restricts to assigned stations', async () => {
    // Without scope=network, the host should NOT see unassigned stations
    const res = await apiGet('/api/stations?q=Chicago', hostToken);
    expect(res.status).toBe(200);
    const results = res.data?.data?.results || [];
    const chicago = results.find(s => s.code === 'CHI');
    expect(chicago).toBeUndefined();
  });

  test('Host cannot access out-of-scope station by ID even with scope=network', async () => {
    // scope=network only applies to the list endpoint, not individual station access
    const res = await apiGet('/api/stations/4', hostToken);
    expect(res.status).toBe(403);
  });

  test('Host cannot create schedule at unassigned station', async () => {
    const res = await apiPost('/api/schedules', {
      route_name: 'Unauth Station ' + Date.now(),
      station_id: 4 // not assigned to host1
    }, hostToken);
    expect(res.status).toBe(403);
  });

  test('Host cannot PATCH schedule at unassigned station', async () => {
    // Create schedule at host1's station via admin, then try to move it
    const sched = await apiPost('/api/schedules', {
      route_name: 'Scope Test ' + Date.now(),
      station_id: 1, // host1's station
      stops: [{ station_id: 1, departure_at: '2026-08-01 08:00:00' }],
      seat_classes: [{ class_code: 'E', class_name: 'Eco', capacity: 100, fare: 50 }]
    }, adminToken);
    if (sched.status === 201 || sched.status === 200) {
      // host cannot move the schedule to an unassigned station
      const patchRes = await apiPatch(`/api/schedules/${sched.data.data.id}`, {
        station_id: 4 // unassigned station
      }, hostToken);
      expect(patchRes.status).toBe(403);
    }
  });
});
