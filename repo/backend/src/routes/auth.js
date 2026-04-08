const Router = require('koa-router');
const authService = require('../services/authService');
const { authenticate, requireRole } = require('../middleware/auth');
const { rateLimiter } = require('../middleware/rateLimiter');
const { logAudit } = require('../services/auditService');
const db = require('../database/connection');

const router = new Router({ prefix: '/api/auth' });

const SESSION_COOKIE = 'railops_session';
const IS_SECURE = process.env.SECURITY_MODE !== 'test' && process.env.NODE_ENV !== 'test';

function setSessionCookie(ctx, token) {
  ctx.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: IS_SECURE,
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/'
  });
}

function clearSessionCookie(ctx) {
  ctx.cookies.set(SESSION_COOKIE, '', { maxAge: 0, path: '/' });
}

// POST /api/auth/login
// Route-level DDoS shield (configurable via LOGIN_RATE_LIMIT env, default 10).
// Actual 5-fail/10-min brute-force lockout is enforced by authService via login_attempts table.
const LOGIN_RATE_LIMIT = parseInt(process.env.LOGIN_RATE_LIMIT, 10) || 10;
router.post('/login', rateLimiter({ windowMs: 10 * 60 * 1000, max: LOGIN_RATE_LIMIT }), async (ctx) => {
  const { username, password, deviceFingerprint } = ctx.request.body || {};

  if (!username || !password) {
    ctx.status = 400;
    ctx.body = { success: false, error: { code: 'VALIDATION_ERROR', message: 'Username and password are required.' } };
    return;
  }

  if (!deviceFingerprint || typeof deviceFingerprint !== 'string' || deviceFingerprint.trim().length === 0) {
    ctx.status = 400;
    ctx.body = { success: false, error: { code: 'VALIDATION_ERROR', message: 'Device fingerprint is required.' } };
    return;
  }

  const result = await authService.login({ username, password, deviceFingerprint, ipAddress: ctx.ip });

  // Map authService result to correct HTTP status codes
  if (result.locked) {
    ctx.status = 423;
    ctx.body = { success: false, error: { code: 'ACCOUNT_LOCKED', message: result.error } };
    return;
  }

  if (result.sessionCapExceeded) {
    ctx.status = 409;
    ctx.body = { success: false, error: { code: 'SESSION_CAP_EXCEEDED', message: result.error, sessionCapExceeded: true } };
    return;
  }

  if (result.enrollmentRequired) {
    ctx.status = 401;
    ctx.body = { success: false, error: { code: 'ENROLLMENT_REQUIRED', message: result.error, enrollmentRequired: true } };
    return;
  }

  if (result.requireDeviceVerification) {
    ctx.status = 403;
    ctx.body = {
      success: false,
      error: {
        code: 'DEVICE_VERIFICATION_REQUIRED',
        message: 'New device detected. Recovery code required.',
        sessionToken: result.sessionToken
      }
    };
    return;
  }

  if (!result.success) {
    ctx.status = 401;
    ctx.body = { success: false, error: { code: 'INVALID_CREDENTIALS', message: result.error } };
    return;
  }

  // Success — set cookie + return token
  setSessionCookie(ctx, result.token);
  ctx.status = 200;
  ctx.body = { success: true, data: result };
});

// POST /api/auth/logout
router.post('/logout', authenticate(), async (ctx) => {
  await db('sessions').where('id', ctx.state.session.id).del();
  clearSessionCookie(ctx);
  await logAudit(ctx.state.user.id, ctx.state.user.username, 'logout', 'session', null, null, ctx.ip);
  ctx.body = { success: true, data: { message: 'Session invalidated.' } };
});

// POST /api/auth/verify-device
router.post('/verify-device', async (ctx) => {
  const { code, sessionToken, deviceFingerprint } = ctx.request.body || {};

  if (!code || !sessionToken) {
    ctx.status = 400;
    ctx.body = { success: false, error: { code: 'VALIDATION_ERROR', message: 'Recovery code and session token required.' } };
    return;
  }

  if (!deviceFingerprint || typeof deviceFingerprint !== 'string' || deviceFingerprint.trim().length === 0) {
    ctx.status = 400;
    ctx.body = { success: false, error: { code: 'VALIDATION_ERROR', message: 'Device fingerprint is required for verification.' } };
    return;
  }

  const crypto = require('crypto');
  const sessionTokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
  const pendingSession = await db('sessions')
    .where('id', sessionTokenHash)
    .where('state', 'pending_verification')
    .where('device_fingerprint', 'PENDING_VERIFICATION')
    .where('expires_at', '>', new Date())
    .first();

  if (!pendingSession) {
    ctx.status = 401;
    ctx.body = { success: false, error: { code: 'VERIFICATION_FAILED', message: 'Invalid or expired verification session.' } };
    return;
  }

  const userId = pendingSession.user_id;
  const result = await authService.verifyDevice(userId, code, deviceFingerprint);

  if (result.sessionCapExceeded) {
    ctx.status = 409;
    ctx.body = { success: false, error: { code: 'SESSION_CAP_EXCEEDED', message: result.error, sessionCapExceeded: true } };
    return;
  }

  if (!result.success) {
    ctx.status = 401;
    ctx.body = { success: false, error: { code: 'VERIFICATION_FAILED', message: 'Invalid recovery code.' } };
    return;
  }

  // Clean up pending session
  await db('sessions').where('id', sessionTokenHash).del();

  // Set cookie for the new session
  setSessionCookie(ctx, result.token);
  ctx.body = { success: true, data: result };
});

// GET /api/auth/me
router.get('/me', authenticate(), async (ctx) => {
  const user = ctx.state.user;
  ctx.body = {
    success: true,
    data: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      phone_last4: user.phone_last4,
      assignedStationIds: user.assignedStationIds || [],
      max_sessions: user.max_sessions
    }
  };
});

// POST /api/auth/recovery-codes
// Restricted to Platform Operations only. Users cannot self-service regenerate their
// own recovery codes — this preserves the enrollment-controlled lifecycle where
// codes are issued by an administrator and used once for device verification.
// Platform Ops can also generate codes for other users via POST /api/users/:id/generate-codes.
router.post('/recovery-codes', authenticate(), requireRole('platform_ops'), async (ctx) => {
  const targetUserId = ctx.request.body?.userId || ctx.state.user.id;
  const targetUser = await db('users').where('id', targetUserId).first();
  if (!targetUser) {
    ctx.status = 404;
    ctx.body = { success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } };
    return;
  }
  const codes = await authService.generateRecoveryCodes(targetUserId);
  await logAudit(ctx.state.user.id, ctx.state.user.username, 'recovery_codes_generated', 'recovery_codes', null, {
    count: codes.length, targetUserId, targetUsername: targetUser.username
  }, ctx.ip);
  ctx.body = {
    success: true,
    data: { codes, warning: 'Store these codes securely. They will not be shown again.' }
  };
});

module.exports = router;
