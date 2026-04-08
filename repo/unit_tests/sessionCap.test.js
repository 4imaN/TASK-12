/**
 * Session cap denial unit tests.
 *
 * Tests that the session cap logic DENIES new sessions (instead of evicting)
 * when the limit is reached, unless a session_exception grants a higher cap.
 */

jest.mock('../backend/src/database/connection', () => {
  const mockDb = jest.fn();
  mockDb.raw = jest.fn();
  return mockDb;
});

jest.mock('../backend/src/services/auditService', () => ({
  logAudit: jest.fn()
}));

// Mock bcrypt so we don't need real hashes
jest.mock('bcrypt', () => ({
  compare: jest.fn(() => Promise.resolve(true)),
  hash: jest.fn(() => Promise.resolve('$2b$12$mockhash'))
}));

const db = require('../backend/src/database/connection');

// Chainable mock: every property returns a function that returns another chainable.
// Terminal calls (.first(), .count(), .insert(), await) resolve to `finalValue`.
function chainable(finalValue) {
  const self = {};
  const make = () => {
    const fn = function(...args) {
      // Execute callback args (knex .where(function() { ... }))
      for (const a of args) {
        if (typeof a === 'function') {
          try { a({ whereNull: () => self, orWhere: () => self }); } catch {}
        }
      }
      return self;
    };
    return fn;
  };
  // All chainable methods
  for (const m of ['where', 'whereNull', 'whereIn', 'whereNot', 'orWhere',
    'orderBy', 'count', 'max', 'select', 'limit', 'offset', 'update',
    'del', 'delete', 'increment', 'decrement', 'groupBy', 'join', 'leftJoin',
    'catch']) {
    self[m] = make();
  }
  self.first = jest.fn(() => Promise.resolve(finalValue));
  self.insert = jest.fn(() => Promise.resolve([1]));
  self.then = (resolve) => Promise.resolve(finalValue).then(resolve);
  return self;
}

describe('Session cap denial (login path)', () => {
  let login;

  beforeAll(() => {
    login = require('../backend/src/services/authService').login;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-mock bcrypt.compare to always return true
    require('bcrypt').compare.mockResolvedValue(true);
  });

  function setupLoginMocks({ activeSessionCount, maxSessions, exceptionMaxSessions }) {
    const mockUser = {
      id: 10, username: 'testuser', password_hash: '$2b$12$fakehash',
      display_name: 'Test', role: 'host', is_active: true,
      max_sessions: maxSessions || 2, phone_last4: null
    };

    let sessionQueryCount = 0;

    db.mockImplementation((table) => {
      if (table === 'lockouts') {
        return chainable(null); // no lockout
      }
      if (table === 'users') {
        return chainable(mockUser);
      }
      if (table === 'trusted_devices') {
        return chainable({ id: 1, device_fingerprint: 'test-fp' });
      }
      if (table === 'sessions') {
        sessionQueryCount++;
        if (sessionQueryCount === 1) {
          return chainable({ count: activeSessionCount });
        }
        return chainable([1]);
      }
      if (table === 'session_exceptions') {
        return chainable(
          exceptionMaxSessions ? { max_sessions: exceptionMaxSessions } : null
        );
      }
      if (table === 'login_attempts') {
        return chainable({ count: 0 });
      }
      return chainable(null);
    });
  }

  test('DENIES login when active sessions >= max (default cap=2)', async () => {
    setupLoginMocks({ activeSessionCount: 2 });

    const result = await login({
      username: 'testuser', password: 'testpass',
      deviceFingerprint: 'test-fp', ipAddress: '127.0.0.1'
    });

    expect(result.success).toBe(false);
    expect(result.sessionCapExceeded).toBe(true);
    expect(result.error).toContain('Session limit reached');
    expect(result.error).toContain('2');
  });

  test('ALLOWS login when active sessions < max', async () => {
    setupLoginMocks({ activeSessionCount: 1 });

    const result = await login({
      username: 'testuser', password: 'testpass',
      deviceFingerprint: 'test-fp', ipAddress: '127.0.0.1'
    });

    expect(result.success).toBe(true);
    expect(result.token).toBeTruthy();
  });

  test('ALLOWS login when session_exception raises cap above current count', async () => {
    setupLoginMocks({ activeSessionCount: 2, exceptionMaxSessions: 5 });

    const result = await login({
      username: 'testuser', password: 'testpass',
      deviceFingerprint: 'test-fp', ipAddress: '127.0.0.1'
    });

    expect(result.success).toBe(true);
    expect(result.token).toBeTruthy();
  });

  test('DENIES login when session_exception cap is also reached', async () => {
    setupLoginMocks({ activeSessionCount: 5, exceptionMaxSessions: 5 });

    const result = await login({
      username: 'testuser', password: 'testpass',
      deviceFingerprint: 'test-fp', ipAddress: '127.0.0.1'
    });

    expect(result.success).toBe(false);
    expect(result.sessionCapExceeded).toBe(true);
    expect(result.error).toContain('5');
  });

  test('error message includes maxSessions count', async () => {
    setupLoginMocks({ activeSessionCount: 3, maxSessions: 3 });

    const result = await login({
      username: 'testuser', password: 'testpass',
      deviceFingerprint: 'test-fp', ipAddress: '127.0.0.1'
    });

    expect(result.sessionCapExceeded).toBe(true);
    expect(result.error).toContain('3 active');
  });
});
