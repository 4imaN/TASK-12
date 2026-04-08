/**
 * Session cap enforcement regression tests.
 *
 * Validates:
 * - Login is DENIED (not evicted) when session cap is reached.
 * - Device verification is DENIED when session cap is reached.
 * - session_exceptions override raises the cap correctly.
 * - Admin session observability excludes non-active sessions.
 */
const crypto = require('crypto');
const { apiGet, apiPost, apiDelete, login, loginCached, clearTokenCache } = require('./setup');

// Helper: create a fresh user with codes generated, return { userId, username, password }
async function createUserWithCodes(adminToken, prefix) {
  const username = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const password = 'TestPass123!';
  const createRes = await apiPost('/api/users', { username, password, role: 'host' }, adminToken);
  expect([200, 201]).toContain(createRes.status);
  const userId = createRes.data?.data?.id;
  expect(userId).toBeTruthy();

  // Generate recovery codes so the user can go through device verification
  const codesRes = await apiPost(`/api/users/${userId}/generate-codes`, {}, adminToken);
  expect(codesRes.status).toBe(200);
  const codes = codesRes.data?.data?.codes;
  expect(codes).toBeDefined();
  expect(codes.length).toBe(10);

  // Trust the default test device so normal login works
  // We do this by logging in from the unknown device, verifying, which trusts it
  const fp = 'TEST_DEVICE_' + username;
  const loginRes = await apiPost('/api/auth/login', { username, password, deviceFingerprint: fp });
  if (loginRes.status === 403 && loginRes.data?.error?.code === 'DEVICE_VERIFICATION_REQUIRED') {
    const sessionToken = loginRes.data.error.sessionToken;
    const verifyRes = await apiPost('/api/auth/verify-device', {
      sessionToken, code: codes[0], deviceFingerprint: fp
    });
    expect(verifyRes.status).toBe(200);
    // Logout this session to start clean
    const tok = verifyRes.data?.data?.token;
    if (tok) await apiPost('/api/auth/logout', {}, tok);
  }

  return { userId, username, password, codes };
}

// Helper: login and return token
async function loginAs(username, password, fpSuffix) {
  const fp = fpSuffix || ('TEST_DEVICE_' + username);
  const res = await apiPost('/api/auth/login', { username, password, deviceFingerprint: fp });
  return res;
}

describe('Session Cap Enforcement — Denial Mode', () => {
  let adminToken;

  beforeAll(async () => {
    adminToken = await loginCached('admin', 'admin123');
  });

  test('login is DENIED when session cap (2) is reached — no eviction', async () => {
    const { userId, username, password } = await createUserWithCodes(adminToken, 'cap_deny');
    const fp = 'TEST_DEVICE_' + username;

    // Create 2 active sessions (the cap default)
    const res1 = await loginAs(username, password, fp);
    expect(res1.status).toBe(200);
    const tok1 = res1.data?.data?.token;

    const res2 = await loginAs(username, password, fp);
    expect(res2.status).toBe(200);
    const tok2 = res2.data?.data?.token;

    // 3rd login should be DENIED with 409
    const res3 = await loginAs(username, password, fp);
    expect(res3.status).toBe(409);
    expect(res3.data.error.code).toBe('SESSION_CAP_EXCEEDED');
    expect(res3.data.error.sessionCapExceeded).toBe(true);
    expect(res3.data.error.message).toContain('Session limit reached');

    // Both original sessions should STILL be valid (no eviction)
    const check1 = await apiGet('/api/auth/me', tok1);
    expect(check1.status).toBe(200);
    const check2 = await apiGet('/api/auth/me', tok2);
    expect(check2.status).toBe(200);
  });

  test('verify-device is DENIED when session cap is reached — no eviction', async () => {
    const { userId, username, password, codes } = await createUserWithCodes(adminToken, 'cap_vdeny');
    const fp = 'TEST_DEVICE_' + username;

    // Create 2 active sessions (the cap default)
    const res1 = await loginAs(username, password, fp);
    expect(res1.status).toBe(200);
    const tok1 = res1.data?.data?.token;

    const res2 = await loginAs(username, password, fp);
    expect(res2.status).toBe(200);
    const tok2 = res2.data?.data?.token;

    // Trigger device verification from a new device
    const newFp = 'NEW_DEVICE_' + Date.now();
    const pendingRes = await apiPost('/api/auth/login', {
      username, password, deviceFingerprint: newFp
    });
    expect(pendingRes.status).toBe(403);
    const sessionToken = pendingRes.data.error.sessionToken;

    // Complete verification — should be DENIED because cap is full
    const verifyRes = await apiPost('/api/auth/verify-device', {
      sessionToken, code: codes[1], deviceFingerprint: newFp
    });
    expect(verifyRes.status).toBe(409);
    expect(verifyRes.data.error.code).toBe('SESSION_CAP_EXCEEDED');

    // Both original sessions should still be valid
    const check1 = await apiGet('/api/auth/me', tok1);
    expect(check1.status).toBe(200);
    const check2 = await apiGet('/api/auth/me', tok2);
    expect(check2.status).toBe(200);
  });

  test('session_exception allows login beyond default cap', async () => {
    const { userId, username, password } = await createUserWithCodes(adminToken, 'cap_exc');
    const fp = 'TEST_DEVICE_' + username;

    // Grant exception: max_sessions = 4
    const excRes = await apiPost(`/api/users/${userId}/session-exception`, {
      max_sessions: 4, reason: 'Regression test'
    }, adminToken);
    expect([200, 201]).toContain(excRes.status);

    // Clean any residual sessions from setup
    const sessionsRes = await apiGet(`/api/users/${userId}/sessions`, adminToken);
    const existingSessions = sessionsRes.data?.data?.sessions || [];
    for (const s of existingSessions) {
      await apiDelete(`/api/users/${userId}/sessions/${s.id}`, adminToken);
    }

    // Create 4 sessions — all should succeed (cap is 4 with exception)
    const tokens = [];
    for (let i = 0; i < 4; i++) {
      const res = await loginAs(username, password, fp);
      expect(res.status).toBe(200);
      tokens.push(res.data?.data?.token);
    }

    // All 4 tokens should be valid
    for (const tok of tokens) {
      const check = await apiGet('/api/auth/me', tok);
      expect(check.status).toBe(200);
    }

    // 5th login should be DENIED (cap is 4)
    const res5 = await loginAs(username, password, fp);
    expect(res5.status).toBe(409);
    expect(res5.data.error.code).toBe('SESSION_CAP_EXCEEDED');

    // All 4 original tokens should still be valid (no eviction)
    for (const tok of tokens) {
      const check = await apiGet('/api/auth/me', tok);
      expect(check.status).toBe(200);
    }
  });

  test('login succeeds after user logs out an existing session', async () => {
    const { userId, username, password } = await createUserWithCodes(adminToken, 'cap_logout');
    const fp = 'TEST_DEVICE_' + username;

    // Fill the cap
    const res1 = await loginAs(username, password, fp);
    expect(res1.status).toBe(200);
    const tok1 = res1.data?.data?.token;

    const res2 = await loginAs(username, password, fp);
    expect(res2.status).toBe(200);

    // Denied
    const res3 = await loginAs(username, password, fp);
    expect(res3.status).toBe(409);

    // Logout one session
    await apiPost('/api/auth/logout', {}, tok1);

    // Now login should succeed
    const res4 = await loginAs(username, password, fp);
    expect(res4.status).toBe(200);
    expect(res4.data?.data?.token).toBeTruthy();
  });
});

describe('Admin Session Observability', () => {
  let adminToken;

  beforeAll(async () => {
    adminToken = await loginCached('admin', 'admin123');
  });

  test('GET /api/users/:id/sessions excludes pending_verification sessions', async () => {
    const { userId, username, password, codes } = await createUserWithCodes(adminToken, 'obs_pending');
    const fp = 'TEST_DEVICE_' + username;

    // Create one active session
    const res1 = await loginAs(username, password, fp);
    expect(res1.status).toBe(200);

    // Create a pending_verification session
    const unknownFp = 'UNKNOWN_DEVICE_' + Date.now();
    const pendingRes = await apiPost('/api/auth/login', {
      username, password, deviceFingerprint: unknownFp
    });
    expect(pendingRes.status).toBe(403);
    expect(pendingRes.data.error.code).toBe('DEVICE_VERIFICATION_REQUIRED');

    // Admin session list should show only 1 (the active one, not the pending)
    const sessionsRes = await apiGet(`/api/users/${userId}/sessions`, adminToken);
    expect(sessionsRes.status).toBe(200);
    const sessions = sessionsRes.data?.data?.sessions || [];
    expect(sessions.length).toBe(1);
  });

  test('GET /api/users active_sessions count excludes non-active sessions', async () => {
    const { userId, username, password, codes } = await createUserWithCodes(adminToken, 'obs_count');
    const fp = 'TEST_DEVICE_' + username;

    // Create one active session
    const res1 = await loginAs(username, password, fp);
    expect(res1.status).toBe(200);

    // Create a pending_verification session
    const unknownFp = 'UNKNOWN_DEVICE_' + Date.now();
    const pendingRes = await apiPost('/api/auth/login', {
      username, password, deviceFingerprint: unknownFp
    });
    expect(pendingRes.status).toBe(403);

    // Check user list — active_sessions should be 1, not 2
    const usersRes = await apiGet('/api/users', adminToken);
    expect(usersRes.status).toBe(200);
    const users = usersRes.data?.data?.results || [];
    const testUser = users.find(u => u.id === userId);
    expect(testUser).toBeTruthy();
    expect(testUser.active_sessions).toBe(1);
  });
});
