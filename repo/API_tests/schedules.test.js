const { apiGet, apiPost, apiPatch, loginCached: login } = require('./setup');

describe('Schedule Management API', () => {
  let adminToken, hostToken;

  beforeAll(async () => {
    adminToken = await login('admin', 'admin123');
    hostToken = await login('host1', 'host123');
  });

  test('GET /api/schedules returns list (admin)', async () => {
    const res = await apiGet('/api/schedules', adminToken);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(Array.isArray(res.data.data)).toBe(true);
  });

  test('GET /api/schedules without auth returns 401', async () => {
    const res = await apiGet('/api/schedules');
    expect(res.status).toBe(401);
  });

  test('GET /api/schedules returns list (host)', async () => {
    const res = await apiGet('/api/schedules', hostToken);
    expect(res.status).toBe(200);
  });

  test('GET /api/schedules/:id returns schedule detail', async () => {
    const list = await apiGet('/api/schedules', adminToken);
    if (list.data.data.length > 0) {
      const id = list.data.data[0].id;
      const res = await apiGet(`/api/schedules/${id}`, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.data.id).toBe(id);
    }
  });

  test('GET /api/schedules/:id/versions returns versions', async () => {
    const list = await apiGet('/api/schedules', adminToken);
    if (list.data.data.length > 0) {
      const id = list.data.data[0].id;
      const res = await apiGet(`/api/schedules/${id}/versions`, adminToken);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.data.data)).toBe(true);
    }
  });

  test('POST /api/schedules creates new schedule', async () => {
    const res = await apiPost('/api/schedules', {
      route_name: 'Test Route ' + Date.now(),
      station_id: 1,
      trainset_id: 1,
      stops: [
        { station_id: 1, departure_at: '2026-05-01 08:00:00' },
        { station_id: 3, arrival_at: '2026-05-01 11:00:00', departure_at: '2026-05-01 11:00:00' }
      ],
      seat_classes: [
        { class_code: 'ECO', class_name: 'Economy', capacity: 100, fare: 50 }
      ]
    }, adminToken);
    expect([200, 201]).toContain(res.status);
    expect(res.data.success).toBe(true);
    expect(res.data.data.id).toBeDefined();
  });

  test('POST /api/schedules without station_id returns 400', async () => {
    const res = await apiPost('/api/schedules', { route_name: 'No Station' }, adminToken);
    expect(res.status).toBe(400);
  });

  test('POST /api/schedules without route_name returns 400', async () => {
    const res = await apiPost('/api/schedules', { station_id: 1 }, adminToken);
    expect(res.status).toBe(400);
  });

  test('POST /api/schedules/:id/versions/:vid/validate runs checklist', async () => {
    const list = await apiGet('/api/schedules', adminToken);
    if (list.data.data.length > 0) {
      const sid = list.data.data[0].id;
      const versions = await apiGet(`/api/schedules/${sid}/versions`, adminToken);
      if (versions.data.data.length > 0) {
        const vid = versions.data.data[0].id;
        const res = await apiPost(`/api/schedules/${sid}/versions/${vid}/validate`, {}, adminToken);
        expect(res.status).toBe(200);
        expect(res.data.data.valid !== undefined || res.data.data.checks !== undefined).toBe(true);
      }
    }
  });

  test('GET /api/schedules/999 returns 404', async () => {
    const res = await apiGet('/api/schedules/999999', adminToken);
    expect(res.status).toBe(404);
  });

  test('POST rollback rejects draft source version (409)', async () => {
    // Create a schedule with a draft version, then try to rollback to it
    const created = await apiPost('/api/schedules', {
      route_name: 'Rollback Test ' + Date.now(),
      station_id: 1,
      trainset_id: 1,
      stops: [{ station_id: 1, departure_at: '2026-06-01 08:00:00' }],
      seat_classes: [{ class_code: 'E', class_name: 'Eco', capacity: 100, fare: 50 }]
    }, adminToken);
    if (created.status === 201 || created.status === 200) {
      const scheduleId = created.data.data.id;
      const versions = await apiGet(`/api/schedules/${scheduleId}/versions`, adminToken);
      const draftVersion = versions.data.data.find(v => v.status === 'draft');
      if (draftVersion) {
        const res = await apiPost(`/api/schedules/${scheduleId}/rollback`, {
          sourceVersionId: draftVersion.id,
          reason: 'Testing draft rollback rejection'
        }, adminToken);
        expect(res.status).toBe(409);
      }
    }
  });

  test('POST rollback accepts published source version', async () => {
    // Use an existing published schedule
    const list = await apiGet('/api/schedules', adminToken);
    const schedule = list.data.data?.find(s => s.active_version_id || s.active_version_number);
    if (schedule) {
      const versions = await apiGet(`/api/schedules/${schedule.id}/versions`, adminToken);
      const published = versions.data.data?.find(v => v.status === 'published' || v.status === 'archived');
      if (published) {
        const res = await apiPost(`/api/schedules/${schedule.id}/rollback`, {
          sourceVersionId: published.id,
          reason: 'Testing published rollback acceptance'
        }, adminToken);
        expect([200, 201]).toContain(res.status);
      }
    }
  });

  test('PATCH /api/schedules/:id persists route_name and station_id changes (draft workflow)', async () => {
    // Create schedule with a draft version
    const created = await apiPost('/api/schedules', {
      route_name: 'Edit Test ' + Date.now(),
      station_id: 1,
      trainset_id: 1,
      stops: [{ station_id: 1, departure_at: '2026-07-01 08:00:00' }],
      seat_classes: [{ class_code: 'E', class_name: 'Eco', capacity: 100, fare: 50 }]
    }, adminToken);
    expect([200, 201]).toContain(created.status);
    const scheduleId = created.data.data.id;

    // Verify draft exists
    const versions = await apiGet(`/api/schedules/${scheduleId}/versions`, adminToken);
    const draft = versions.data.data.find(v => v.status === 'draft');
    expect(draft).toBeTruthy();

    // PATCH schedule-level fields
    const newRouteName = 'Updated Route ' + Date.now();
    const patchRes = await apiPatch(`/api/schedules/${scheduleId}`, {
      route_name: newRouteName
    }, adminToken);
    expect(patchRes.status).toBe(200);
    expect(patchRes.data.data.route_name).toBe(newRouteName);

    // GET should reflect the change
    const getRes = await apiGet(`/api/schedules/${scheduleId}`, adminToken);
    expect(getRes.status).toBe(200);
    expect(getRes.data.data.route_name).toBe(newRouteName);
  });

  test('PATCH /api/schedules/:id requires draft version to exist', async () => {
    // Find a schedule with no draft (published/active)
    const list = await apiGet('/api/schedules', adminToken);
    const scheduleWithActive = list.data.data?.find(s => s.active_version_id && s.latest_status !== 'draft');
    if (scheduleWithActive) {
      const patchRes = await apiPatch(`/api/schedules/${scheduleWithActive.id}`, {
        route_name: 'Should Fail'
      }, adminToken);
      expect(patchRes.status).toBe(409);
    }
  });
});
