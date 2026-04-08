// Auth middleware tests (mock-based)
// We test the middleware logic by simulating Koa context objects

const path = require('path');

// We need to mock the database module before importing auth middleware
jest.mock('../backend/src/database/connection', () => {
  const mockDb = jest.fn();
  mockDb.raw = jest.fn();
  return mockDb;
});

const { authenticate, requireRole } = require('../backend/src/middleware/auth');

function createMockCtx(headers = {}) {
  return {
    headers: headers,
    get: function(name) { return this.headers[name.toLowerCase()] || ''; },
    cookies: { get: function() { return null; } },
    state: {},
    status: 200,
    body: null,
    throw: function(status, message) {
      const err = new Error(message);
      err.status = status;
      throw err;
    }
  };
}

describe('authenticate middleware', () => {
  test('missing Authorization header and no cookie returns 401', async () => {
    const ctx = createMockCtx();
    const next = jest.fn();
    await authenticate()(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.status).toBe(401);
  });

  test('empty Bearer token returns 401', async () => {
    const ctx = createMockCtx({ authorization: 'Bearer ' });
    const next = jest.fn();
    await authenticate()(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.status).toBe(401);
  });

  test('invalid Authorization format returns 401', async () => {
    const ctx = createMockCtx({ authorization: 'Basic abc123' });
    const next = jest.fn();
    await authenticate()(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.status).toBe(401);
  });
});

describe('requireRole middleware', () => {
  test('allows matching role', async () => {
    const ctx = createMockCtx();
    ctx.state.user = { id: 1, role: 'platform_ops' };
    const next = jest.fn();

    await requireRole('platform_ops')(ctx, next);
    expect(next).toHaveBeenCalled();
  });

  test('allows when user has one of multiple accepted roles', async () => {
    const ctx = createMockCtx();
    ctx.state.user = { id: 1, role: 'host' };
    const next = jest.fn();

    await requireRole('host', 'platform_ops')(ctx, next);
    expect(next).toHaveBeenCalled();
  });

  test('blocks non-matching role', async () => {
    const ctx = createMockCtx();
    ctx.state.user = { id: 1, role: 'guest' };
    const next = jest.fn();
    await requireRole('platform_ops')(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.status).toBe(403);
  });

  test('blocks when user is missing', async () => {
    const ctx = createMockCtx();
    ctx.state = {};
    const next = jest.fn();
    await requireRole('host')(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.status).toBe(401);
  });
});
