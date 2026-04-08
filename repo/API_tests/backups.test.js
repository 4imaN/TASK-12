const { apiGet, apiPost, apiPatch, loginCached: login } = require('./setup');

describe('Backup & Data Quality API', () => {
  let adminToken;

  beforeAll(async () => {
    adminToken = await login('admin', 'admin123');
    expect(adminToken).toBeTruthy();
  });

  // Backups
  test('GET /api/backups returns list', async () => {
    const res = await apiGet('/api/backups', adminToken);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
  });

  test('GET /api/backups/config returns config', async () => {
    const res = await apiGet('/api/backups/config', adminToken);
    expect(res.status).toBe(200);
    expect(res.data.data).toBeDefined();
  });

  test('GET /api/restore-drills returns list', async () => {
    const res = await apiGet('/api/restore-drills', adminToken);
    expect(res.status).toBe(200);
  });

  // Data Quality
  test('GET /api/data-quality/issues returns list', async () => {
    const res = await apiGet('/api/data-quality/issues', adminToken);
    expect(res.status).toBe(200);
  });

  test('POST /api/data-quality/issues creates issue', async () => {
    const res = await apiPost('/api/data-quality/issues', {
      entity_type: 'schedule', check_type: 'completeness',
      severity: 'medium', description: 'API test issue'
    }, adminToken);
    expect([200, 201]).toContain(res.status);
  });

  test('GET /api/data-quality/reports returns list', async () => {
    const res = await apiGet('/api/data-quality/reports', adminToken);
    expect(res.status).toBe(200);
  });

  // Audit
  test('GET /api/audit/logs returns entries', async () => {
    const res = await apiGet('/api/audit/logs', adminToken);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
  });

  test('GET /api/audit/logs with action filter', async () => {
    const res = await apiGet('/api/audit/logs?action=login', adminToken);
    expect(res.status).toBe(200);
  });

  // Backup chain and incremental
  test('POST /api/backups/run with backup_type=full initiates backup', async () => {
    const res = await apiPost('/api/backups/run', { backup_type: 'full' }, adminToken);
    // 200 = completed sync, 202 = accepted async, 409 = already running
    expect([200, 202, 409]).toContain(res.status);
  });

  test('POST /api/backups/run with invalid backup_type returns 400', async () => {
    const res = await apiPost('/api/backups/run', { backup_type: 'snapshot' }, adminToken);
    expect(res.status).toBe(400);
  });

  test('backup list records contain required metadata fields', async () => {
    const res = await apiGet('/api/backups', adminToken);
    expect(res.status).toBe(200);
    const records = res.data?.data?.results || res.data?.data || [];
    // At least one backup should exist from prior test or seed
    expect(Array.isArray(records)).toBe(true);
    if (records.length > 0) {
      const b = records[0];
      expect(b).toHaveProperty('backup_type');
      expect(b).toHaveProperty('status');
      expect(b).toHaveProperty('started_at');
      expect(['full', 'incremental']).toContain(b.backup_type);
    }
  });

  test('restore drill list returns array', async () => {
    const res = await apiGet('/api/restore-drills', adminToken);
    expect(res.status).toBe(200);
    const drills = res.data?.data?.results || res.data?.data || [];
    expect(Array.isArray(drills)).toBe(true);
  });
});
