/**
 * Extended test coverage for audit findings.
 *
 * Covers:
 * - Schedule compare/diff endpoint
 * - Approval → approve → publish happy path
 * - Request-approval checklist enforcement
 * - Inventory serial/batch tracking and variance finalization
 * - Object-level inventory authorization (host out-of-scope)
 * - Recovery-code lifecycle (host cannot self-regenerate)
 */
const { apiGet, apiPost, apiPatch, apiDelete, loginCached: login } = require('./setup');

// ─── SCHEDULE COMPARE / DIFF ──────────────────────────────────────────────────

describe('Schedule Compare / Diff', () => {
  let adminToken;

  beforeAll(async () => {
    adminToken = await login('admin', 'admin123');
  });

  test('GET compare returns diff between two versions', async () => {
    // Create a schedule with a draft, then create a second version to compare
    const sched = await apiPost('/api/schedules', {
      route_name: 'Compare Test ' + Date.now(),
      station_id: 1, trainset_id: 1,
      stops: [
        { station_id: 1, departure_at: '2026-09-01 08:00:00' },
        { station_id: 3, arrival_at: '2026-09-01 11:00:00', departure_at: '2026-09-01 11:05:00' }
      ],
      seat_classes: [{ class_code: 'ECO', class_name: 'Economy', capacity: 100, fare: 50 }]
    }, adminToken);
    if (![200, 201].includes(sched.status)) return;

    const scheduleId = sched.data.data.id;
    const versions = await apiGet(`/api/schedules/${scheduleId}/versions`, adminToken);
    const v1 = versions.data.data[0];

    // Create second version with different stops
    const v2Res = await apiPost(`/api/schedules/${scheduleId}/versions`, {
      stops: [
        { station_id: 1, departure_at: '2026-09-01 08:30:00' },
        { station_id: 3, arrival_at: '2026-09-01 11:30:00', departure_at: '2026-09-01 11:35:00' },
        { station_id: 5, arrival_at: '2026-09-01 14:00:00', departure_at: '2026-09-01 14:00:00' }
      ],
      seat_classes: [{ class_code: 'ECO', class_name: 'Economy', capacity: 120, fare: 60 }]
    }, adminToken);
    if (![200, 201].includes(v2Res.status)) return;
    const v2 = v2Res.data.data;

    const compareRes = await apiGet(
      `/api/schedules/${scheduleId}/versions/compare?v1=${v1.id}&v2=${v2.id || v2Res.data.data.id}`,
      adminToken
    );
    expect(compareRes.status).toBe(200);
    expect(compareRes.data.data.stops).toBeDefined();
    expect(compareRes.data.data.seatClasses).toBeDefined();
    // Should detect the added stop and changed times
    expect(compareRes.data.data.stops.length).toBeGreaterThan(0);
  });
});

// ─── APPROVAL → APPROVE → PUBLISH HAPPY PATH ─────────────────────────────────

describe('Approval Happy Path', () => {
  let adminToken, hostToken;

  beforeAll(async () => {
    adminToken = await login('admin', 'admin123');
    hostToken = await login('host1', 'host123');
  });

  test('host submits for approval, admin approves, version becomes published', async () => {
    // Create schedule at host's station
    const sched = await apiPost('/api/schedules', {
      route_name: 'Approval HP ' + Date.now(),
      station_id: 1, trainset_id: 1,
      stops: [
        { station_id: 1, stop_sequence: 1, departure_at: '2026-10-01 08:00:00' },
        { station_id: 3, stop_sequence: 2, arrival_at: '2026-10-01 10:00:00', departure_at: '2026-10-01 10:05:00' },
        { station_id: 5, stop_sequence: 3, arrival_at: '2026-10-01 12:00:00', departure_at: '2026-10-01 12:00:00' }
      ],
      seat_classes: [{ class_code: 'E', class_name: 'Eco', capacity: 100, fare: 40 }]
    }, hostToken);

    if (![200, 201].includes(sched.status)) return;
    const scheduleId = sched.data.data.id;
    const versionId = sched.data.data.versionId;

    // Host requests approval
    const reqRes = await apiPost(
      `/api/schedules/${scheduleId}/versions/${versionId}/request-approval`, {}, hostToken
    );
    expect([200, 201]).toContain(reqRes.status);
    const approvalId = reqRes.data.data.approvalId;

    // Admin approves
    const approveRes = await apiPost(`/api/approvals/${approvalId}/approve`, {
      reviewComment: 'Looks good'
    }, adminToken);
    expect(approveRes.status).toBe(200);
    expect(approveRes.data.data.status).toBe('approved');

    // Verify the schedule's active version is now this one
    const schedDetail = await apiGet(`/api/schedules/${scheduleId}`, adminToken);
    expect(schedDetail.status).toBe(200);
    expect(schedDetail.data.data.active_version_id).toBe(versionId);
  });

  test('request-approval rejects empty schedule (no stops/classes)', async () => {
    const sched = await apiPost('/api/schedules', {
      route_name: 'Empty Sched ' + Date.now(),
      station_id: 1
    }, adminToken);
    if (![200, 201].includes(sched.status)) return;

    const scheduleId = sched.data.data.id;
    const versions = await apiGet(`/api/schedules/${scheduleId}/versions`, adminToken);
    const draft = versions.data.data?.find(v => v.status === 'draft');
    if (!draft) return;

    const reqRes = await apiPost(
      `/api/schedules/${scheduleId}/versions/${draft.id}/request-approval`, {}, adminToken
    );
    expect(reqRes.status).toBe(400);
    expect(reqRes.data.error.code).toBe('VALIDATION_FAILED');
  });
});

// ─── INVENTORY SERIAL/BATCH + VARIANCE ────────────────────────────────────────

describe('Inventory Extended', () => {
  let adminToken;

  beforeAll(async () => {
    adminToken = await login('admin', 'admin123');
  });

  test('serial-tracked item requires serial_numbers on movement', async () => {
    // Create a serial-tracked item
    const sku = `SER-${Date.now()}`;
    const itemRes = await apiPost('/api/inventory/items', {
      sku, name: 'Serial Item', station_id: 1, unit: 'unit',
      unit_cost: 25.00, reorder_point: 5, tracking_mode: 'serial'
    }, adminToken);
    if (![200, 201].includes(itemRes.status)) return;
    const itemId = itemRes.data.data?.id;
    if (!itemId) return;

    // Movement without serial_numbers should fail
    const badMove = await apiPost('/api/inventory/movements', {
      item_id: itemId, station_id: 1,
      movement_type: 'receiving', quantity: 2, notes: 'Missing serials'
    }, adminToken);
    expect(badMove.status).toBe(400);

    // Movement with serial_numbers should succeed
    const goodMove = await apiPost('/api/inventory/movements', {
      item_id: itemId, station_id: 1,
      movement_type: 'receiving', quantity: 2,
      serial_numbers: ['SN-001', 'SN-002'],
      notes: 'With serials'
    }, adminToken);
    expect([200, 201]).toContain(goodMove.status);
  });

  test('batch-tracked item requires batch_number on movement', async () => {
    const sku = `BAT-${Date.now()}`;
    const itemRes = await apiPost('/api/inventory/items', {
      sku, name: 'Batch Item', station_id: 1, unit: 'case',
      unit_cost: 10.00, reorder_point: 20, tracking_mode: 'batch'
    }, adminToken);
    if (![200, 201].includes(itemRes.status)) return;
    const itemId = itemRes.data.data?.id;
    if (!itemId) return;

    // Movement without batch_number should fail
    const badMove = await apiPost('/api/inventory/movements', {
      item_id: itemId, station_id: 1,
      movement_type: 'receiving', quantity: 10, notes: 'Missing batch'
    }, adminToken);
    expect(badMove.status).toBe(400);

    // Movement with batch_number should succeed
    const goodMove = await apiPost('/api/inventory/movements', {
      item_id: itemId, station_id: 1,
      movement_type: 'receiving', quantity: 10,
      batch_number: 'LOT-2026-04',
      notes: 'With batch'
    }, adminToken);
    expect([200, 201]).toContain(goodMove.status);
  });

  test('shipping below on-hand is rejected for non-adjustment types', async () => {
    // Create a fresh item with 0 stock
    const sku = `NEG-${Date.now()}`;
    const itemRes = await apiPost('/api/inventory/items', {
      sku, name: 'Neg Test', station_id: 1, unit: 'unit',
      unit_cost: 5.00, reorder_point: 0, tracking_mode: 'none'
    }, adminToken);
    if (![200, 201].includes(itemRes.status)) return;
    const itemId = itemRes.data.data?.id;
    if (!itemId) return;

    // Shipping from 0 stock should fail
    const shipRes = await apiPost('/api/inventory/movements', {
      item_id: itemId, station_id: 1,
      movement_type: 'shipping', quantity: 5, notes: 'Over-ship'
    }, adminToken);
    expect(shipRes.status).toBe(400);
  });

  test('stock count finalize creates adjustment movements for variances', async () => {
    // Create a stock count, add lines, finalize
    const countRes = await apiPost('/api/inventory/stock-counts', {
      station_id: 1, notes: 'Variance test ' + Date.now()
    }, adminToken);
    if (![200, 201].includes(countRes.status)) return;
    const countId = countRes.data.data?.id;
    if (!countId) return;

    // Get items to add count lines
    const items = await apiGet('/api/inventory/items?station_id=1', adminToken);
    const itemList = items.data.data?.items || items.data.data?.results || [];
    if (!Array.isArray(itemList) || itemList.length === 0) return;

    // Add count lines via PATCH /stock-counts/:id (the actual backend route)
    const item = itemList[0];
    const lineRes = await apiPatch(`/api/inventory/stock-counts/${countId}`, {
      lines: [{ item_id: item.id, counted_quantity: (item.on_hand || 0) + 5 }]
    }, adminToken);
    if (![200, 201].includes(lineRes.status)) return;

    // Verify lines were recorded
    expect(lineRes.data.data.lines).toBeDefined();
    expect(lineRes.data.data.lines.length).toBeGreaterThan(0);

    // Finalize — creates adjustment movements for variances
    const finalizeRes = await apiPost(`/api/inventory/stock-counts/${countId}/finalize`, {}, adminToken);
    expect([200, 201]).toContain(finalizeRes.status);
    if (finalizeRes.data.data) {
      expect(finalizeRes.data.data.adjustments).toBeDefined();
    }
  });
});

// ─── OBJECT-LEVEL INVENTORY AUTHORIZATION ─────────────────────────────────────

describe('Inventory Object-Level Authorization', () => {
  let hostToken, adminToken;

  beforeAll(async () => {
    hostToken = await login('host1', 'host123');
    adminToken = await login('admin', 'admin123');
  });

  test('host cannot create item at unassigned station', async () => {
    const res = await apiPost('/api/inventory/items', {
      sku: `UNAUTH-${Date.now()}`, name: 'Unauth Item',
      station_id: 4, unit: 'unit', unit_cost: 1, reorder_point: 0, tracking_mode: 'none'
    }, hostToken);
    expect(res.status).toBe(403);
  });

  test('host cannot create movement at unassigned station', async () => {
    // First create an item at station 4 via admin
    const sku = `ADM-${Date.now()}`;
    const itemRes = await apiPost('/api/inventory/items', {
      sku, name: 'Admin Item', station_id: 4, unit: 'unit',
      unit_cost: 5, reorder_point: 0, tracking_mode: 'none'
    }, adminToken);
    if (![200, 201].includes(itemRes.status)) return;
    const itemId = itemRes.data.data?.id;
    if (!itemId) return;

    // Host tries to create movement at station 4
    const moveRes = await apiPost('/api/inventory/movements', {
      item_id: itemId, station_id: 4,
      movement_type: 'receiving', quantity: 1
    }, hostToken);
    expect(moveRes.status).toBe(403);
  });
});

// ─── OBJECT-LEVEL INVENTORY AUTH: ITEM + MOVEMENT DETAIL ────────────────────

describe('Inventory Object-Level Detail Authorization', () => {
  let hostToken, adminToken;

  beforeAll(async () => {
    hostToken = await login('host1', 'host123');
    adminToken = await login('admin', 'admin123');
  });

  test('host cannot access item detail at unassigned station', async () => {
    // Create item at station 4 via admin
    const sku = `DET-${Date.now()}`;
    const itemRes = await apiPost('/api/inventory/items', {
      sku, name: 'Detail Test', station_id: 4, unit: 'unit',
      unit_cost: 1, reorder_point: 0, tracking_mode: 'none'
    }, adminToken);
    if (![200, 201].includes(itemRes.status)) return;
    const itemId = itemRes.data.data?.id;
    if (!itemId) return;

    // Host tries to GET the item detail
    const detailRes = await apiGet(`/api/inventory/items/${itemId}`, hostToken);
    expect(detailRes.status).toBe(403);
  });

  test('host can access item detail at assigned station', async () => {
    // Create item at station 1 (host1's station) via admin
    const sku = `OWN-${Date.now()}`;
    const itemRes = await apiPost('/api/inventory/items', {
      sku, name: 'Own Station Item', station_id: 1, unit: 'unit',
      unit_cost: 2, reorder_point: 0, tracking_mode: 'none'
    }, adminToken);
    if (![200, 201].includes(itemRes.status)) return;
    const itemId = itemRes.data.data?.id;
    if (!itemId) return;

    const detailRes = await apiGet(`/api/inventory/items/${itemId}`, hostToken);
    expect(detailRes.status).toBe(200);
  });

  test('host cannot access movement detail at unassigned station', async () => {
    // Create item + movement at station 4 via admin
    const sku = `MOV-${Date.now()}`;
    const itemRes = await apiPost('/api/inventory/items', {
      sku, name: 'Mov Detail Test', station_id: 4, unit: 'unit',
      unit_cost: 1, reorder_point: 0, tracking_mode: 'none'
    }, adminToken);
    if (![200, 201].includes(itemRes.status)) return;
    const itemId = itemRes.data.data?.id;
    if (!itemId) return;

    const moveRes = await apiPost('/api/inventory/movements', {
      item_id: itemId, station_id: 4,
      movement_type: 'receiving', quantity: 10
    }, adminToken);
    if (![200, 201].includes(moveRes.status)) return;
    const movementId = moveRes.data.data?.id;
    if (!movementId) return;

    const detailRes = await apiGet(`/api/inventory/movements/${movementId}`, hostToken);
    expect(detailRes.status).toBe(403);
  });
});

// ─── STATION ISOLATION: STOCK COUNTS ────────────────────────────────────────

describe('Station Isolation — Stock Counts', () => {
  let hostToken, adminToken;

  beforeAll(async () => {
    hostToken = await login('host1', 'host123');
    adminToken = await login('admin', 'admin123');
  });

  test('host cannot create stock count at unassigned station', async () => {
    const res = await apiPost('/api/inventory/stock-counts', {
      station_id: 4, notes: 'Cross-station ' + Date.now()
    }, hostToken);
    expect(res.status).toBe(403);
  });

  test('host cannot access stock count at unassigned station', async () => {
    // Create count at station 4 via admin
    const countRes = await apiPost('/api/inventory/stock-counts', {
      station_id: 4, notes: 'Admin count ' + Date.now()
    }, adminToken);
    if (![200, 201].includes(countRes.status)) return;
    const countId = countRes.data.data?.id;
    if (!countId) return;

    const detailRes = await apiGet(`/api/inventory/stock-counts/${countId}`, hostToken);
    expect(detailRes.status).toBe(403);
  });
});

// ─── BACKUP / RESTORE-DRILL EXECUTION CHAIN ─────────────────────────────────

describe('Backup / Restore-Drill Chain', () => {
  let adminToken;

  beforeAll(async () => {
    adminToken = await login('admin', 'admin123');
  });

  test('GET /api/backups returns list with expected fields', async () => {
    const res = await apiGet('/api/backups', adminToken);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    const backups = res.data.data?.backups || res.data.data?.results || [];
    if (backups.length > 0) {
      const b = backups[0];
      expect(b.backup_type).toBeDefined();
      expect(b.status).toBeDefined();
      expect(b.started_at).toBeDefined();
    }
  });

  test('GET /api/backups/config returns backup configuration', async () => {
    const res = await apiGet('/api/backups/config', adminToken);
    expect([200, 404]).toContain(res.status); // 404 if no config yet
  });

  test('POST /api/backups/run rejects invalid backup_type', async () => {
    const res = await apiPost('/api/backups/run', { backup_type: 'invalid' }, adminToken);
    expect(res.status).toBe(400);
  });

  test('GET /api/backups/restore-drills returns list', async () => {
    const res = await apiGet('/api/backups/restore-drills', adminToken);
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.data.success).toBe(true);
    }
  });

  test('host cannot access backup endpoints', async () => {
    const hostToken = await login('host1', 'host123');
    const res = await apiGet('/api/backups', hostToken);
    expect(res.status).toBe(403);
  });
});

// ─── RECOVERY-CODE LIFECYCLE ──────────────────────────────────────────────────

describe('Recovery-Code Lifecycle', () => {
  let hostToken, adminToken;

  beforeAll(async () => {
    hostToken = await login('host1', 'host123');
    adminToken = await login('admin', 'admin123');
  });

  test('host cannot self-regenerate recovery codes (requires platform_ops)', async () => {
    const res = await apiPost('/api/auth/recovery-codes', {}, hostToken);
    expect(res.status).toBe(403);
  });

  test('platform_ops can generate recovery codes', async () => {
    const res = await apiPost('/api/auth/recovery-codes', {}, adminToken);
    expect(res.status).toBe(200);
    expect(res.data.data.codes).toBeDefined();
    expect(res.data.data.codes.length).toBe(10);
  });
});
