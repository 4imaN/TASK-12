/**
 * Session lifecycle unit tests.
 * Tests the auth middleware's expiry and renewal logic.
 */

jest.mock('../backend/src/database/connection', () => {
  const mockDb = jest.fn();
  mockDb.raw = jest.fn();
  return mockDb;
});

const { resolveSession } = require('../backend/src/middleware/auth');
const db = require('../backend/src/database/connection');

// Helper to create a mock session
function mockSession(overrides = {}) {
  const now = new Date();
  return {
    id: 'hashed-token-abc',
    user_id: 1,
    expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days
    last_active_at: new Date(now.getTime() - 1000), // 1 second ago
    device_fingerprint: 'test-fp',
    ...overrides
  };
}

function mockUser() {
  return { id: 1, username: 'admin', display_name: 'Admin', phone_last4: null, role: 'platform_ops', is_active: true, max_sessions: 2, created_at: new Date() };
}

describe('Session lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects session that exceeded 30-day hard expiry', async () => {
    const expired = mockSession({
      expires_at: new Date(Date.now() - 1000) // expired 1 second ago
    });

    // Mock: sessions query returns expired session
    const mockFirst = jest.fn().mockResolvedValue(expired);
    const mockWhere = jest.fn().mockReturnValue({ first: mockFirst });
    db.mockReturnValue({ where: mockWhere });

    const result = await resolveSession('raw-token');
    expect(result).toBeNull();
  });

  test('rejects session with 8+ hours of inactivity', async () => {
    const stale = mockSession({
      last_active_at: new Date(Date.now() - 9 * 60 * 60 * 1000) // 9 hours ago
    });

    const mockFirst = jest.fn().mockResolvedValue(stale);
    const mockWhere = jest.fn().mockReturnValue({ first: mockFirst });
    db.mockReturnValue({ where: mockWhere });

    const result = await resolveSession('raw-token');
    expect(result).toBeNull();
  });

  test('accepts session within inactivity window', async () => {
    const active = mockSession({
      last_active_at: new Date(Date.now() - 60 * 1000) // 1 minute ago
    });

    // Mock chain: sessions.where().first() -> session
    // then sessions.where().update() for renewal
    // then users.where().where().select().first() -> user
    // then user_station_scopes.where().select() -> []

    const mockFirst1 = jest.fn().mockResolvedValue(active);
    const mockWhere1 = jest.fn().mockReturnValue({ first: mockFirst1 });

    const mockUpdate = jest.fn().mockResolvedValue(1);
    const mockWhere2 = jest.fn().mockReturnValue({ update: mockUpdate });

    const mockUserFirst = jest.fn().mockResolvedValue(mockUser());
    const mockUserSelect = jest.fn().mockReturnValue({ first: mockUserFirst });
    const mockUserWhere2 = jest.fn().mockReturnValue({ select: mockUserSelect });
    const mockUserWhere1 = jest.fn().mockReturnValue({ where: mockUserWhere2 });

    let callCount = 0;
    db.mockImplementation((table) => {
      if (table === 'sessions') {
        callCount++;
        if (callCount === 1) return { where: mockWhere1 };
        return { where: mockWhere2 };
      }
      if (table === 'users') return { where: mockUserWhere1 };
      if (table === 'user_station_scopes') {
        return { where: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([]) }) };
      }
      return { where: jest.fn().mockReturnValue({ first: jest.fn().mockResolvedValue(null) }) };
    });

    const result = await resolveSession('raw-token');
    expect(result).not.toBeNull();
    expect(result.user.username).toBe('admin');
    // Verify last_active_at was updated
    expect(mockUpdate).toHaveBeenCalled();
  });

  test('rejects when session not found in DB', async () => {
    const mockFirst = jest.fn().mockResolvedValue(null);
    const mockWhere = jest.fn().mockReturnValue({ first: mockFirst });
    db.mockReturnValue({ where: mockWhere });

    const result = await resolveSession('nonexistent-token');
    expect(result).toBeNull();
  });

  test('session exactly at 8-hour boundary is accepted', async () => {
    const borderline = mockSession({
      last_active_at: new Date(Date.now() - 7.99 * 60 * 60 * 1000) // Just under 8 hours
    });

    const mockFirst1 = jest.fn().mockResolvedValue(borderline);
    const mockWhere1 = jest.fn().mockReturnValue({ first: mockFirst1 });
    const mockUpdate = jest.fn().mockResolvedValue(1);
    const mockWhere2 = jest.fn().mockReturnValue({ update: mockUpdate });
    const mockUserFirst = jest.fn().mockResolvedValue(mockUser());

    let callCount = 0;
    db.mockImplementation((table) => {
      if (table === 'sessions') {
        callCount++;
        if (callCount === 1) return { where: mockWhere1 };
        return { where: mockWhere2 };
      }
      if (table === 'users') return { where: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ first: mockUserFirst }) }) }) };
      if (table === 'user_station_scopes') return { where: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([]) }) };
      return {};
    });

    const result = await resolveSession('raw-token');
    expect(result).not.toBeNull();
  });
});
