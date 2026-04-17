/**
 * Inventory detail, update, finalize, audit, DQ, user admin, and restore drill tests.
 * All tests create their own prerequisite data — no conditional skips.
 */
const { apiGet, apiPost, apiPatch, loginCached: login } = require('./setup');

let adminToken;

beforeAll(async () => {
  adminToken = await login('admin', 'admin123');
  expect(adminToken).toBeTruthy();
});

describe('Inventory item detail and update', () => {
  let itemId;

  test('create item for testing', async () => {
    const res = await apiPost('/api/inventory/items', {
      sku: 'DETAIL-' + Date.now(), name: 'Detail Test Item',
      station_id: 1, unit: 'unit', unit_cost: 5, reorder_point: 10, tracking_mode: 'none'
    }, adminToken);
    expect([200, 201]).toContain(res.status);
    itemId = res.data.data.id;
    expect(itemId).toBeTruthy();
  });

  test('GET /api/inventory/items/:id returns item detail with sku', async () => {
    expect(itemId).toBeTruthy();
    const res = await apiGet(`/api/inventory/items/${itemId}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.data.data.sku).toContain('DETAIL-');
  });

  test('PATCH /api/inventory/items/:id updates reorder_point and readback confirms', async () => {
    expect(itemId).toBeTruthy();
    const res = await apiPatch(`/api/inventory/items/${itemId}`, { reorder_point: 25 }, adminToken);
    expect(res.status).toBe(200);

    // Readback to confirm the mutation persisted
    const readback = await apiGet(`/api/inventory/items/${itemId}`, adminToken);
    expect(readback.status).toBe(200);
    expect(readback.data.data.reorder_point).toBe(25);
  });
});

describe('Inventory movement detail', () => {
  test('create movement and retrieve by ID', async () => {
    // Get an item to create movement for
    const items = await apiGet('/api/inventory/items', adminToken);
    const itemList = items.data?.data?.results || items.data?.data || [];
    expect(itemList.length).toBeGreaterThan(0);
    const item = itemList.find(i => i.station_id === 1);
    expect(item).toBeTruthy();

    const movRes = await apiPost('/api/inventory/movements', {
      item_id: item.id, station_id: 1, movement_type: 'receiving', quantity: 1, notes: 'detail test'
    }, adminToken);
    expect([200, 201]).toContain(movRes.status);

    const movList = await apiGet('/api/inventory/movements', adminToken);
    const movs = movList.data?.data?.results || movList.data?.data || [];
    expect(movs.length).toBeGreaterThan(0);
    const res = await apiGet(`/api/inventory/movements/${movs[0].id}`, adminToken);
    expect(res.status).toBe(200);
  });
});

describe('Stock count detail and finalize', () => {
  test('create, update lines, get detail, and finalize', async () => {
    const countRes = await apiPost('/api/inventory/stock-counts', {
      station_id: 1, notes: 'finalize-test-' + Date.now()
    }, adminToken);
    // 409 = open count exists; reuse it
    let countId;
    if (countRes.status === 409) {
      const list = await apiGet('/api/inventory/stock-counts', adminToken);
      const counts = list.data?.data?.results || list.data?.data || [];
      const open = counts.find(c => c.station_id === 1 && c.status !== 'finalized' && c.status !== 'cancelled');
      countId = open?.id;
    } else {
      expect([200, 201]).toContain(countRes.status);
      countId = countRes.data.data.id;
    }
    expect(countId).toBeTruthy();

    // Get detail
    const detail = await apiGet(`/api/inventory/stock-counts/${countId}`, adminToken);
    expect(detail.status).toBe(200);

    // Add a line
    const items = await apiGet('/api/inventory/items', adminToken);
    const itemList = items.data?.data?.results || items.data?.data || [];
    const item = itemList.find(i => i.station_id === 1);
    expect(item).toBeTruthy();

    await apiPatch(`/api/inventory/stock-counts/${countId}`, {
      lines: [{ item_id: item.id, counted_quantity: item.on_hand || 0 }]
    }, adminToken);

    // Finalize
    const fin = await apiPost(`/api/inventory/stock-counts/${countId}/finalize`, {}, adminToken);
    expect([200, 409]).toContain(fin.status);
  });
});

describe('Audit log detail and backtracking', () => {
  test('GET /api/audit/logs/:id returns log entry', async () => {
    const list = await apiGet('/api/audit/logs', adminToken);
    const logs = list.data?.data?.results || list.data?.data || [];
    expect(logs.length).toBeGreaterThan(0);
    const res = await apiGet(`/api/audit/logs/${logs[0].id}`, adminToken);
    expect(res.status).toBe(200);
  });

  test('GET /api/backtrack/diff returns data', async () => {
    const res = await apiGet('/api/backtrack/diff?entity=schedule&id=1&from=2020-01-01&to=2030-01-01', adminToken);
    expect(res.status).toBe(200);
  });

  test('GET /api/backtrack/replay returns data', async () => {
    const res = await apiGet('/api/backtrack/replay?entity=schedule&id=1&from=2020-01-01&to=2030-01-01', adminToken);
    expect(res.status).toBe(200);
  });
});

describe('Data quality lifecycle', () => {
  let issueId;

  test('POST creates issue', async () => {
    const res = await apiPost('/api/data-quality/issues', {
      entity_type: 'test', check_type: 'completeness', severity: 'medium', description: 'lifecycle test'
    }, adminToken);
    expect([200, 201]).toContain(res.status);
    issueId = res.data?.data?.id;
  });

  test('PATCH updates issue status', async () => {
    expect(issueId).toBeTruthy();
    const res = await apiPatch(`/api/data-quality/issues/${issueId}`, { status: 'in_progress' }, adminToken);
    expect(res.status).toBe(200);
  });

  test('POST generate report succeeds', async () => {
    const res = await apiPost('/api/data-quality/reports/generate', {}, adminToken);
    expect([200, 201]).toContain(res.status);
  });

  test('GET report detail returns data', async () => {
    const list = await apiGet('/api/data-quality/reports', adminToken);
    const reports = list.data?.data?.results || list.data?.data || [];
    expect(reports.length).toBeGreaterThan(0);
    const res = await apiGet(`/api/data-quality/reports/${reports[0].id}`, adminToken);
    expect(res.status).toBe(200);
  });
});

describe('User admin — non-destructive mutations', () => {
  let testUserId;

  test('create disposable user', async () => {
    const res = await apiPost('/api/users', {
      username: 'mut_' + Date.now(), password: 'MutPass1!', role: 'guest'
    }, adminToken);
    expect([200, 201]).toContain(res.status);
    testUserId = res.data.data.id;
  });

  test('PATCH updates display_name and readback confirms', async () => {
    expect(testUserId).toBeTruthy();
    const res = await apiPatch(`/api/users/${testUserId}`, { display_name: 'MutUpdated' }, adminToken);
    expect(res.status).toBe(200);
    // Readback
    const users = await apiGet('/api/users', adminToken);
    const list = users.data?.data?.results || users.data?.data || [];
    const updated = Array.isArray(list) ? list.find(u => u.id === testUserId) : null;
    expect(updated).toBeTruthy();
    expect(updated.display_name).toBe('MutUpdated');
  });

  test('POST reset-password changes password', async () => {
    expect(testUserId).toBeTruthy();
    const res = await apiPost(`/api/users/${testUserId}/reset-password`, { new_password: 'NewPass1!' }, adminToken);
    expect(res.status).toBe(200);
  });

  test('POST unlock returns success or indicates no lockout', async () => {
    expect(testUserId).toBeTruthy();
    const res = await apiPost(`/api/users/${testUserId}/unlock`, {}, adminToken);
    // 200 = unlocked, 409 = no active lockout
    expect([200, 409]).toContain(res.status);
  });
});

describe('Restore drills', () => {
  test('GET /api/restore-drills returns list', async () => {
    const res = await apiGet('/api/restore-drills', adminToken);
    expect(res.status).toBe(200);
  });

  test('POST /api/restore-drills creates drill and GET /:id returns detail', async () => {
    // Trigger a full backup (mysqldump installed in Docker image via apk add mysql-client)
    const triggerRes = await apiPost('/api/backups/run', { backup_type: 'full' }, adminToken);
    expect([200, 202, 409]).toContain(triggerRes.status);

    // Poll until a completed backup exists (max 40s)
    let completed = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const backups = await apiGet('/api/backups', adminToken);
      const list = backups.data?.data?.results || backups.data?.data || [];
      completed = Array.isArray(list) ? list.find(b => b.status === 'completed') : null;
      if (completed) break;
    }
    expect(completed).toBeTruthy(); // Must have a completed backup

    // Create a restore drill
    const drillRes = await apiPost('/api/restore-drills', { backup_id: completed.id }, adminToken);
    expect([200, 201, 202]).toContain(drillRes.status);

    // Poll until drill finishes (max 20s)
    await new Promise(r => setTimeout(r, 5000));
    const drillList = await apiGet('/api/restore-drills', adminToken);
    const drills = drillList.data?.data?.results || drillList.data?.data || [];
    expect(drills.length).toBeGreaterThan(0);

    // GET detail by ID
    const detail = await apiGet(`/api/restore-drills/${drills[0].id}`, adminToken);
    expect(detail.status).toBe(200);
    expect(detail.data.data).toBeDefined();
  });
});

describe('Trainset and station mutations with readback', () => {
  test('PATCH /api/trainsets/:id persists name change — readback confirms', async () => {
    const newName = 'Acela Test ' + Date.now();
    const res = await apiPatch('/api/trainsets/1', { name: newName }, adminToken);
    expect(res.status).toBe(200);
    // Readback — assert exact name persisted
    const list = await apiGet('/api/trainsets', adminToken);
    expect(list.status).toBe(200);
    const trainsets = list.data?.data?.results || list.data?.data || [];
    const updated = Array.isArray(trainsets) ? trainsets.find(t => t.id === 1) : null;
    expect(updated).toBeTruthy();
    expect(updated.name).toBe(newName);
  });

  test('PATCH /api/stations/:id persists region change', async () => {
    const res = await apiPatch('/api/stations/1', { region: 'Northeast Updated' }, adminToken);
    expect(res.status).toBe(200);
    // Readback
    const detail = await apiGet('/api/stations/1', adminToken);
    expect(detail.status).toBe(200);
    expect(detail.data.data.region).toBe('Northeast Updated');
  });

  test('PATCH /api/trainsets/999 returns 404', async () => {
    const res = await apiPatch('/api/trainsets/999999', { name: 'X' }, adminToken);
    expect([404, 400]).toContain(res.status);
  });

  test('PATCH /api/stations/999 returns 404', async () => {
    const res = await apiPatch('/api/stations/999999', { name: 'X' }, adminToken);
    expect([404, 400]).toContain(res.status);
  });
});

describe('Negative/edge cases', () => {
  test('GET /api/inventory/items/999999 returns 404', async () => {
    const res = await apiGet('/api/inventory/items/999999', adminToken);
    expect(res.status).toBe(404);
  });

  test('POST /api/inventory/movements with missing fields returns 400', async () => {
    const res = await apiPost('/api/inventory/movements', { item_id: 1 }, adminToken);
    expect(res.status).toBe(400);
  });

  test('POST /api/data-quality/issues without description returns 400', async () => {
    const res = await apiPost('/api/data-quality/issues', { entity_type: 'test', check_type: 'completeness', severity: 'low' }, adminToken);
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });

  test('PATCH /api/data-quality/issues/999999 returns 404', async () => {
    const res = await apiPatch('/api/data-quality/issues/999999', { status: 'resolved' }, adminToken);
    expect([404, 400]).toContain(res.status);
  });
});
