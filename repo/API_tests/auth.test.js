const { apiGet, apiPost, loginCached, loginCached: login, login: freshLogin } = require('./setup');

describe('Auth API — Login Contract', () => {
  test('valid credentials + trusted device returns 200 with token', async () => {
    const res = await apiPost('/api/auth/login', {
      username: 'admin', password: 'admin123', deviceFingerprint: 'BOOTSTRAP_INITIAL_DEVICE'
    });
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.token).toBeDefined();
    expect(res.data.data.user).toBeDefined();
    expect(res.data.data.user.role).toBe('platform_ops');
  });

  test('valid host credentials + trusted device returns 200', async () => {
    const res = await apiPost('/api/auth/login', {
      username: 'host1', password: 'host123', deviceFingerprint: 'TEST_DEVICE_host1'
    });
    expect(res.status).toBe(200);
    expect(res.data.data.user.role).toBe('host');
  });

  test('wrong password returns 401 INVALID_CREDENTIALS', async () => {
    const res = await apiPost('/api/auth/login', {
      username: 'admin', password: 'wrongpassword', deviceFingerprint: 'BOOTSTRAP_INITIAL_DEVICE'
    });
    expect(res.status).toBe(401);
    expect(res.data.success).toBe(false);
    expect(res.data.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('non-existent user returns 401 INVALID_CREDENTIALS', async () => {
    const res = await apiPost('/api/auth/login', {
      username: 'nobody_exists', password: 'x', deviceFingerprint: 'fp'
    });
    expect(res.status).toBe(401);
    expect(res.data.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('missing username/password returns 400 VALIDATION_ERROR', async () => {
    const res = await apiPost('/api/auth/login', { deviceFingerprint: 'fp' });
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });

  test('missing deviceFingerprint returns 400 VALIDATION_ERROR', async () => {
    const res = await apiPost('/api/auth/login', { username: 'admin', password: 'admin123' });
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Auth API — Session Management', () => {
  test('GET /api/auth/me with valid token returns 200 + profile', async () => {
    const token = await login('admin', 'admin123');
    expect(token).toBeTruthy();
    const res = await apiGet('/api/auth/me', token);
    expect(res.status).toBe(200);
    expect(res.data.data.username).toBe('admin');
    expect(res.data.data.role).toBe('platform_ops');
  });

  test('GET /api/auth/me without token returns 401', async () => {
    const res = await apiGet('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('GET /api/auth/me with invalid token returns 401', async () => {
    const res = await apiGet('/api/auth/me', 'completely-invalid-token');
    expect(res.status).toBe(401);
  });

  test('POST /api/auth/logout invalidates session', async () => {
    const tok = await freshLogin('admin', 'admin123');
    expect(tok).toBeTruthy();
    const logoutRes = await apiPost('/api/auth/logout', {}, tok);
    expect(logoutRes.status).toBe(200);
    const meRes = await apiGet('/api/auth/me', tok);
    expect(meRes.status).toBe(401);
  });

  test('POST /api/auth/logout without token returns 401', async () => {
    const res = await apiPost('/api/auth/logout', {});
    expect(res.status).toBe(401);
  });

  test('session auto-renewal via activity', async () => {
    const tok = await login('admin', 'admin123');
    const r1 = await apiGet('/api/auth/me', tok);
    expect(r1.status).toBe(200);
    const r2 = await apiGet('/api/auth/me', tok);
    expect(r2.status).toBe(200);
  });
});

describe('Auth API — Recovery Codes', () => {
  test('POST /api/auth/recovery-codes generates 10 codes', async () => {
    const tok = await freshLogin('admin', 'admin123');
    expect(tok).toBeTruthy();
    const res = await apiPost('/api/auth/recovery-codes', {}, tok);
    expect(res.status).toBe(200);
    expect(res.data.data.codes).toBeDefined();
    expect(res.data.data.codes.length).toBe(10);
  });
});

describe('Auth API — Device Verification Contract', () => {
  test('new device + has codes returns 403 DEVICE_VERIFICATION_REQUIRED', async () => {
    const adminTok = await login('admin', 'admin123');
    const username = 'devver_' + Date.now();
    await apiPost('/api/users', { username, password: 'DevVerPass1!', role: 'host' }, adminTok);

    // Get user ID and generate codes
    const users = await apiGet('/api/users', adminTok);
    const userList = users.data?.data?.results || [];
    const testUser = userList.find(u => u.username === username);
    expect(testUser).toBeTruthy();
    await apiPost(`/api/users/${testUser.id}/generate-codes`, {}, adminTok);

    // Login from unknown device — should require verification
    const loginRes = await apiPost('/api/auth/login', {
      username, password: 'DevVerPass1!', deviceFingerprint: 'unknown-device-' + Date.now()
    });
    expect(loginRes.status).toBe(403);
    expect(loginRes.data.error.code).toBe('DEVICE_VERIFICATION_REQUIRED');
    expect(loginRes.data.error.sessionToken).toBeDefined();
  });

  test('new device + codes from creation returns 403 DEVICE_VERIFICATION_REQUIRED', async () => {
    const adminTok = await login('admin', 'admin123');
    const username = 'enroll_' + Date.now();
    await apiPost('/api/users', { username, password: 'EnrollPass1!', role: 'host' }, adminTok);

    // Users now have recovery codes generated at creation time
    const loginRes = await apiPost('/api/auth/login', {
      username, password: 'EnrollPass1!', deviceFingerprint: 'unknown-' + Date.now()
    });
    expect(loginRes.status).toBe(403);
    expect(loginRes.data.error.code).toBe('DEVICE_VERIFICATION_REQUIRED');
  });

  test('verify-device requires sessionToken + code + deviceFingerprint', async () => {
    const r1 = await apiPost('/api/auth/verify-device', { code: 'X', deviceFingerprint: 'fp' });
    expect(r1.status).toBe(400);

    const r2 = await apiPost('/api/auth/verify-device', { sessionToken: 'X', deviceFingerprint: 'fp' });
    expect(r2.status).toBe(400);

    const r3 = await apiPost('/api/auth/verify-device', { sessionToken: 'X', code: 'Y' });
    expect(r3.status).toBe(400);
  });

  test('verify-device with invalid token returns 401', async () => {
    const res = await apiPost('/api/auth/verify-device', {
      sessionToken: 'nonexistent', code: 'TESTCODE', deviceFingerprint: 'fp'
    });
    expect(res.status).toBe(401);
    expect(res.data.error.code).toBe('VERIFICATION_FAILED');
  });
});
