const crypto = require('crypto');
const db = require('../database/connection');

const SESSION_COOKIE = 'railops_session';

/**
 * Extract session token: HttpOnly cookie first, then Bearer header fallback.
 */
function extractToken(ctx) {
  // 1. Try HttpOnly session cookie (preferred, secure transport)
  const cookieToken = ctx.cookies.get(SESSION_COOKIE);
  if (cookieToken) return cookieToken;

  // 2. Fallback to Bearer Authorization header (API/migration compatibility)
  const header = ctx.headers.authorization;
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  const token = parts[1].trim();
  return token || null;
}

/**
 * Look up session by token (session.id = token), validate expiry, return user.
 */
async function resolveSession(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = await db('sessions')
    .where('id', tokenHash)
    .first();

  if (!session) return null;

  // SECURITY: Reject pending_verification sessions — they cannot access authenticated routes
  if (session.state === 'pending_verification') {
    return null;
  }

  const now = new Date();

  // Hard expiry: 30 days
  if (session.expires_at && new Date(session.expires_at) < now) {
    return null;
  }

  // Inactivity timeout: 8 hours
  const inactivityLimit = 8 * 60 * 60 * 1000;
  if (session.last_active_at && (now - new Date(session.last_active_at)) > inactivityLimit) {
    return null;
  }

  // Auto-renew last_active_at
  await db('sessions')
    .where('id', tokenHash)
    .update({ last_active_at: now });

  // Fetch user — role is ENUM directly on users table
  const user = await db('users')
    .where('id', session.user_id)
    .where('is_active', true)
    .select('id', 'username', 'display_name', 'phone_last4', 'role', 'is_active', 'max_sessions', 'created_at')
    .first();

  if (!user) return null;

  // Fetch assigned station IDs for host users
  let assignedStationIds = [];
  if (user.role === 'host') {
    const scopes = await db('user_station_scopes')
      .where('user_id', user.id)
      .select('station_id');
    assignedStationIds = scopes.map(s => s.station_id);
  }

  return {
    session,
    user: {
      ...user,
      assignedStationIds
    }
  };
}

/**
 * Required authentication middleware.
 */
function authenticate() {
  return async (ctx, next) => {
    const token = extractToken(ctx);
    if (!token) {
      ctx.status = 401;
      ctx.body = { success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required. Provide a Bearer token.' } };
      return;
    }

    const result = await resolveSession(token);
    if (!result) {
      ctx.status = 401;
      ctx.body = { success: false, error: { code: 'UNAUTHENTICATED', message: 'Session is invalid or expired.' } };
      return;
    }

    ctx.state.user = result.user;
    ctx.state.session = result.session;
    ctx.state.token = token;

    await next();
  };
}

/**
 * Optional authentication middleware.
 */
function optionalAuth() {
  return async (ctx, next) => {
    const token = extractToken(ctx);
    if (token) {
      const result = await resolveSession(token);
      if (result) {
        ctx.state.user = result.user;
        ctx.state.session = result.session;
        ctx.state.token = token;
      }
    }
    await next();
  };
}

/**
 * Role-based access control middleware.
 */
function requireRole(...roles) {
  return async (ctx, next) => {
    if (!ctx.state.user) {
      ctx.status = 401;
      ctx.body = { success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } };
      return;
    }
    if (!roles.includes(ctx.state.user.role)) {
      ctx.status = 403;
      ctx.body = { success: false, error: { code: 'FORBIDDEN', message: `Requires role: ${roles.join(', ')}.` } };
      return;
    }
    await next();
  };
}

module.exports = { authenticate, optionalAuth, requireRole, extractToken, resolveSession };
