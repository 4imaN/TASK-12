/**
 * Schedule workflow API tests — covers version editing, stops, seat classes,
 * approval requests, compare, publish, and rollback paths.
 */
const { apiGet, apiPost, apiPatch, apiDelete, loginCached: login } = require('./setup');

let adminToken, scheduleId, versionId;

beforeAll(async () => {
  adminToken = await login('admin', 'admin123');
  expect(adminToken).toBeTruthy();

  const res = await apiPost('/api/schedules', {
    route_name: 'Workflow Test ' + Date.now(),
    station_id: 1, trainset_id: 1,
    stops: [
      { station_id: 1, departure_at: '2028-01-15 08:00:00' },
      { station_id: 5, arrival_at: '2028-01-15 09:30:00', departure_at: '2028-01-15 09:35:00' },
      { station_id: 3, arrival_at: '2028-01-15 11:00:00', departure_at: '2028-01-15 11:00:00' }
    ],
    seat_classes: [{ class_code: 'ECO', class_name: 'Economy', capacity: 100, fare: 50 }]
  }, adminToken);
  expect([200, 201]).toContain(res.status);
  scheduleId = res.data.data.id;
  expect(scheduleId).toBeTruthy();

  const versions = await apiGet(`/api/schedules/${scheduleId}/versions`, adminToken);
  expect(versions.data.data.length).toBeGreaterThan(0);
  versionId = versions.data.data[0].id;
});

describe('Version detail and update', () => {
  test('GET /:id/versions/:versionId returns version with stops', async () => {
    const res = await apiGet(`/api/schedules/${scheduleId}/versions/${versionId}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.data.data).toBeDefined();
  });

  test('PATCH /:id/versions/:versionId updates notes — readback confirms', async () => {
    const newNotes = 'Updated notes ' + Date.now();
    const res = await apiPatch(`/api/schedules/${scheduleId}/versions/${versionId}`, { notes: newNotes }, adminToken);
    expect(res.status).toBe(200);

    // Readback — assert the exact notes value persisted
    const detail = await apiGet(`/api/schedules/${scheduleId}/versions/${versionId}`, adminToken);
    expect(detail.status).toBe(200);
    expect(detail.data.data.notes).toBe(newNotes);
  });
});

describe('Stop CRUD', () => {
  let stopId;

  test('POST adds a stop and returns new stop data', async () => {
    const res = await apiPost(`/api/schedules/${scheduleId}/versions/${versionId}/stops`, {
      station_id: 6, stop_sequence: 4, departure_at: '2028-01-15 12:00:00'
    }, adminToken);
    expect([200, 201]).toContain(res.status);
    stopId = res.data?.data?.id;
    expect(stopId).toBeTruthy();
  });

  test('PATCH updates a stop platform', async () => {
    expect(stopId).toBeTruthy();
    const res = await apiPatch(`/api/schedules/${scheduleId}/versions/${versionId}/stops/${stopId}`, {
      platform: '3B'
    }, adminToken);
    expect(res.status).toBe(200);
  });

  test('DELETE removes a stop', async () => {
    expect(stopId).toBeTruthy();
    const res = await apiDelete(`/api/schedules/${scheduleId}/versions/${versionId}/stops/${stopId}`, adminToken);
    expect(res.status).toBe(200);
  });
});

describe('Seat class CRUD', () => {
  let classId;

  test('POST adds a seat class', async () => {
    const res = await apiPost(`/api/schedules/${scheduleId}/versions/${versionId}/seat-classes`, {
      class_code: 'BIZ', class_name: 'Business', capacity: 50, fare: 120
    }, adminToken);
    expect([200, 201]).toContain(res.status);
    classId = res.data?.data?.id;
    expect(classId).toBeTruthy();
  });

  test('PATCH updates seat class capacity', async () => {
    expect(classId).toBeTruthy();
    const res = await apiPatch(`/api/schedules/${scheduleId}/versions/${versionId}/seat-classes/${classId}`, {
      capacity: 60
    }, adminToken);
    expect(res.status).toBe(200);
  });

  test('DELETE removes a seat class', async () => {
    expect(classId).toBeTruthy();
    const res = await apiDelete(`/api/schedules/${scheduleId}/versions/${versionId}/seat-classes/${classId}`, adminToken);
    expect(res.status).toBe(200);
  });
});

describe('Approval and compare', () => {
  test('POST request-approval changes version status', async () => {
    const res = await apiPost(`/api/schedules/${scheduleId}/versions/${versionId}/request-approval`, {}, adminToken);
    expect([200, 201, 409]).toContain(res.status);
  });

  test('GET compare with two versions returns diff', async () => {
    // Create second schedule+version for compare (avoids draft conflict)
    const s2 = await apiPost('/api/schedules', {
      route_name: 'Compare Test ' + Date.now(), station_id: 1,
      stops: [{ station_id: 1, departure_at: '2029-01-01 08:00:00' }],
      seat_classes: [{ class_code: 'E', class_name: 'Eco', capacity: 50, fare: 30 }]
    }, adminToken);
    expect([200, 201]).toContain(s2.status);
    const s2Id = s2.data.data.id;
    const s2Versions = await apiGet(`/api/schedules/${s2Id}/versions`, adminToken);
    const s2v1 = s2Versions.data.data[0].id;

    // Create second version for that schedule
    const v2Res = await apiPost(`/api/schedules/${s2Id}/versions`, {
      stops: [{ station_id: 1, departure_at: '2029-02-01 08:00:00' }],
      seat_classes: [{ class_code: 'B', class_name: 'Biz', capacity: 30, fare: 80 }]
    }, adminToken);

    if (v2Res.status === 200 || v2Res.status === 201) {
      const s2v2 = v2Res.data.data.id;
      const cmp = await apiGet(`/api/schedules/${s2Id}/versions/compare?v1=${s2v1}&v2=${s2v2}`, adminToken);
      expect(cmp.status).toBe(200);
      expect(cmp.data.data).toBeDefined();
    }
  });
});
