const Router = require('koa-router');
const bcrypt = require('bcrypt');
const db = require('../database/connection');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { logAudit } = require('../services/auditService');
const { maskPhone } = require('../utils/masks');
const { encrypt, decrypt } = require('../utils/crypto');

const BCRYPT_COST = 12;

const router = new Router({ prefix: '/api/users' });

// All user management routes require authentication + platform_ops role.
router.use(authenticate(), requireRole('platform_ops'));

/**
 * GET /api/users
 * List all users with masked phone and active session count.
 */
router.get('/', async (ctx) => {
  const { page = 1, pageSize = 25, role, q } = ctx.query;
  const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  let query = db('users').select(
    'users.id',
    'users.username',
    'users.display_name',
    'users.phone_encrypted',
    'users.phone_last4',
    'users.role',
    'users.is_active',
    'users.max_sessions',
    'users.created_at',
    'users.updated_at'
  );

  let countQuery = db('users');

  if (role) {
    query = query.where('users.role', role);
    countQuery = countQuery.where('users.role', role);
  }

  if (q) {
    const search = `%${q}%`;
    query = query.where(function () {
      this.where('users.username', 'like', search)
        .orWhere('users.display_name', 'like', search);
    });
    countQuery = countQuery.where(function () {
      this.where('users.username', 'like', search)
        .orWhere('users.display_name', 'like', search);
    });
  }

  const totalResult = await countQuery.count('users.id as count').first();
  const total = totalResult ? totalResult.count : 0;

  const users = await query.orderBy('users.created_at', 'desc').limit(limit).offset(offset);

  // Batch-fetch active session counts for listed users
  const userIds = users.map((u) => u.id);
  const now = new Date();

  let sessionCounts = {};
  if (userIds.length > 0) {
    const rows = await db('sessions')
      .select('user_id')
      .count('id as cnt')
      .whereIn('user_id', userIds)
      .where('state', 'active')
      .where('expires_at', '>', now)
      .groupBy('user_id');
    for (const row of rows) {
      sessionCounts[row.user_id] = parseInt(row.cnt, 10);
    }
  }

  // Batch-fetch lockout status for listed users
  let lockedUserIds = new Set();
  if (userIds.length > 0) {
    const lockRows = await db('lockouts')
      .select('username')
      .whereIn('username', users.map(u => u.username))
      .whereNull('unlocked_at');
    const lockedUsernames = new Set(lockRows.map(r => r.username));
    for (const u of users) {
      if (lockedUsernames.has(u.username)) lockedUserIds.add(u.id);
    }
  }

  const callerRole = ctx.state.user.role;
  const results = users.map((user) => {
    const entry = {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      is_active: !!user.is_active,
      max_sessions: user.max_sessions,
      active_sessions: sessionCounts[user.id] || 0,
      is_locked: lockedUserIds.has(user.id),
      created_at: user.created_at,
      updated_at: user.updated_at
    };
    // Platform Ops sees the full phone number (decrypted); others see a masked version.
    if (callerRole === 'platform_ops') {
      entry.phone_full = decrypt(user.phone_encrypted) || null;
    } else {
      entry.phone_masked = maskPhone(user.phone_last4, callerRole);
    }
    return entry;
  });

  ctx.body = {
    success: true,
    data: {
      results,
      total,
      page: parseInt(page, 10) || 1,
      pageSize: limit
    }
  };
});

/**
 * POST /api/users
 * Create a new user account.
 * Required fields: username, password, role.
 */
router.post('/', async (ctx) => {
  const { username, password, role, display_name, phone } = ctx.request.body || {};

  // --- Validation ---
  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    throw createError(400, 'VALIDATION_ERROR', 'username is required.');
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    throw createError(400, 'VALIDATION_ERROR', 'password is required and must be at least 8 characters.');
  }
  if (!role || !['guest', 'host', 'platform_ops'].includes(role)) {
    throw createError(400, 'VALIDATION_ERROR', 'role is required and must be one of: guest, host, platform_ops.');
  }

  // Check uniqueness (case-insensitive)
  const existing = await db('users')
    .whereRaw('LOWER(username) = ?', [username.toLowerCase()])
    .first();
  if (existing) {
    throw createError(409, 'CONFLICT', 'Username already exists.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const now = new Date();

  // Derive phone_last4 if phone is provided
  const phoneLast4 = phone && phone.length >= 4 ? phone.slice(-4) : null;

  const [userId] = await db('users').insert({
    username,
    password_hash: passwordHash,
    display_name: display_name || null,
    phone_encrypted: encrypt(phone) || null,
    phone_last4: phoneLast4,
    role,
    is_active: true,
    max_sessions: 2,  // Always 2. Use /session-exception to raise.
    created_at: now,
    updated_at: now
  });

  // Generate recovery codes at enrollment time (10 codes, stored as bcrypt hashes)
  const authService = require('../services/authService');
  const recoveryCodes = await authService.generateRecoveryCodes(userId);

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'user.create',
    'users',
    userId,
    { username, role },
    ctx.ip
  );

  ctx.status = 201;
  ctx.body = {
    success: true,
    data: {
      id: userId,
      username,
      displayName: display_name || null,
      role,
      isActive: true,
      createdAt: now,
      recoveryCodes: recoveryCodes,
      recoveryCodeWarning: 'Store these codes securely. They will not be shown again.'
    }
  };
});

/**
 * PATCH /api/users/:id
 * Update a user (display_name, role, is_active, phone).
 */
router.patch('/:id', async (ctx) => {
  const { id } = ctx.params;
  const { display_name, role, is_active, phone } = ctx.request.body || {};

  const user = await db('users').where('id', id).first();
  if (!user) {
    throw createError(404, 'NOT_FOUND', 'User not found.');
  }

  const updates = { updated_at: new Date() };
  const changedFields = {};

  if (display_name !== undefined) {
    updates.display_name = display_name;
    changedFields.display_name = display_name;
  }

  if (role !== undefined) {
    if (!['guest', 'host', 'platform_ops'].includes(role)) {
      throw createError(400, 'VALIDATION_ERROR', 'role must be one of: guest, host, platform_ops.');
    }
    updates.role = role;
    changedFields.role = role;
  }

  if (is_active !== undefined) {
    updates.is_active = !!is_active;
    changedFields.is_active = !!is_active;
  }

  if (phone !== undefined) {
    updates.phone_encrypted = encrypt(phone) || null;
    updates.phone_last4 = phone && phone.length >= 4 ? phone.slice(-4) : null;
    changedFields.phone_last4 = updates.phone_last4;
  }

  await db('users').where('id', id).update(updates);

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'user.update',
    'users',
    id,
    changedFields,
    ctx.ip
  );

  const updated = await db('users')
    .where('id', id)
    .select('id', 'username', 'display_name', 'phone_encrypted', 'phone_last4', 'role', 'is_active', 'max_sessions', 'created_at', 'updated_at')
    .first();

  const patchData = {
    id: updated.id,
    username: updated.username,
    display_name: updated.display_name,
    role: updated.role,
    is_active: !!updated.is_active,
    max_sessions: updated.max_sessions,
    created_at: updated.created_at,
    updated_at: updated.updated_at
  };
  // Platform Ops sees the full phone number (decrypted); others see a masked version.
  if (ctx.state.user.role === 'platform_ops') {
    patchData.phone_full = decrypt(updated.phone_encrypted) || null;
  } else {
    patchData.phone_masked = maskPhone(updated.phone_last4, ctx.state.user.role);
  }

  ctx.body = {
    success: true,
    data: patchData
  };
});

/**
 * GET /api/users/:id/sessions
 * List active sessions for a user.
 */
router.get('/:id/sessions', async (ctx) => {
  const { id } = ctx.params;

  const user = await db('users').where('id', id).first();
  if (!user) {
    throw createError(404, 'NOT_FOUND', 'User not found.');
  }

  const now = new Date();
  const sessions = await db('sessions')
    .where('user_id', id)
    .where('state', 'active')
    .where('expires_at', '>', now)
    .orderBy('last_active_at', 'desc')
    .select('id', 'device_fingerprint', 'ip_address', 'last_active_at', 'expires_at', 'created_at');

  ctx.body = {
    success: true,
    data: {
      userId: parseInt(id, 10),
      sessions: sessions.map((s) => ({
        id: s.id,
        device_fingerprint: s.device_fingerprint,
        ip_address: s.ip_address,
        last_active_at: s.last_active_at,
        expires_at: s.expires_at,
        created_at: s.created_at
      }))
    }
  };
});

/**
 * DELETE /api/users/:id/sessions/:sessionId
 * Revoke a specific session.
 */
router.delete('/:id/sessions/:sessionId', async (ctx) => {
  const { id, sessionId } = ctx.params;

  const session = await db('sessions')
    .where('id', sessionId)
    .where('user_id', id)
    .first();

  if (!session) {
    throw createError(404, 'NOT_FOUND', 'Session not found.');
  }

  // Expire the session immediately by setting expires_at to now
  await db('sessions')
    .where('id', sessionId)
    .update({ expires_at: new Date() });

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'session.revoke',
    'sessions',
    sessionId,
    { userId: id },
    ctx.ip
  );

  ctx.body = {
    success: true,
    data: { message: 'Session revoked.' }
  };
});

/**
 * POST /api/users/:id/unlock
 * Unlock a locked account.
 */
router.post('/:id/unlock', async (ctx) => {
  const { id } = ctx.params;

  const user = await db('users').where('id', id).first();
  if (!user) {
    throw createError(404, 'NOT_FOUND', 'User not found.');
  }

  // Find the active lockout by username (lockouts table keys on username)
  const activeLockout = await db('lockouts')
    .where('username', user.username)
    .whereNull('unlocked_at')
    .first();

  if (!activeLockout) {
    throw createError(409, 'CONFLICT', 'Account is not currently locked.');
  }

  const now = new Date();
  await db('lockouts')
    .where('id', activeLockout.id)
    .update({
      unlocked_at: now,
      unlock_reason: 'Admin unlock via /api/users/:id/unlock',
      unlocked_by: ctx.state.user.id
    });

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'user.unlock',
    'lockouts',
    activeLockout.id,
    { targetUserId: id, targetUsername: user.username },
    ctx.ip
  );

  ctx.body = {
    success: true,
    data: {
      userId: parseInt(id, 10),
      username: user.username,
      unlockedAt: now.toISOString(),
      unlockedBy: ctx.state.user.id
    }
  };
});

/**
 * POST /api/users/:id/session-exception
 * Grant a session limit override.
 * Requires: max_sessions, reason.
 */
router.post('/:id/session-exception', async (ctx) => {
  const { id } = ctx.params;
  const { max_sessions, reason, expires_at } = ctx.request.body || {};

  const user = await db('users').where('id', id).first();
  if (!user) {
    throw createError(404, 'NOT_FOUND', 'User not found.');
  }

  if (!max_sessions || typeof max_sessions !== 'number' || max_sessions < 1) {
    throw createError(400, 'VALIDATION_ERROR', 'max_sessions is required and must be a positive integer.');
  }
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw createError(400, 'VALIDATION_ERROR', 'reason is required.');
  }

  const expiresAt = expires_at ? new Date(expires_at) : null;
  const now = new Date();

  const [exceptionId] = await db('session_exceptions').insert({
    user_id: id,
    granted_by: ctx.state.user.id,
    max_sessions,
    reason,
    expires_at: expiresAt,
    created_at: now
  });

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'user.session_exception',
    'session_exceptions',
    exceptionId,
    { targetUserId: id, max_sessions, reason },
    ctx.ip
  );

  ctx.body = {
    success: true,
    data: {
      id: exceptionId,
      userId: parseInt(id, 10),
      maxSessions: max_sessions,
      reason,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      grantedBy: ctx.state.user.id,
      createdAt: now.toISOString()
    }
  };
});

/**
 * POST /api/users/:id/reset-password
 * Reset a user's password. Requires new_password.
 */
router.post('/:id/reset-password', async (ctx) => {
  const { id } = ctx.params;
  const { new_password } = ctx.request.body || {};

  const user = await db('users').where('id', id).first();
  if (!user) {
    throw createError(404, 'NOT_FOUND', 'User not found.');
  }

  if (!new_password || typeof new_password !== 'string' || new_password.length < 8) {
    throw createError(400, 'VALIDATION_ERROR', 'new_password is required and must be at least 8 characters.');
  }

  const passwordHash = await bcrypt.hash(new_password, BCRYPT_COST);
  const now = new Date();

  await db('users').where('id', id).update({
    password_hash: passwordHash,
    updated_at: now
  });

  // Expire all active sessions for this user so they must re-authenticate
  await db('sessions')
    .where('user_id', id)
    .where('expires_at', '>', now)
    .update({ expires_at: now });

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'user.reset_password',
    'users',
    id,
    { allSessionsRevoked: true },
    ctx.ip
  );

  ctx.body = {
    success: true,
    data: {
      userId: parseInt(id, 10),
      passwordReset: true,
      sessionsRevoked: true,
      resetBy: ctx.state.user.id,
      resetAt: now.toISOString()
    }
  };
});

/**
 * GET /api/users/:id/stations
 * Get assigned stations for a user.
 */
router.get('/:id/stations', async (ctx) => {
  const { id } = ctx.params;
  const scopes = await db('user_station_scopes as uss')
    .join('stations as s', 'uss.station_id', 's.id')
    .where('uss.user_id', id)
    .select('s.id', 's.code', 's.name', 's.region');
  ctx.body = { success: true, data: scopes };
});

/**
 * PUT /api/users/:id/stations
 * Replace station assignments for a user. Body: { station_ids: [1, 2, 3] }
 */
router.put('/:id/stations', async (ctx) => {
  const { id } = ctx.params;
  const { station_ids } = ctx.request.body || {};

  const user = await db('users').where('id', id).first();
  if (!user) {
    ctx.status = 404;
    ctx.body = { success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } };
    return;
  }

  const ids = Array.isArray(station_ids) ? station_ids.map(Number).filter(n => n > 0) : [];

  // Validate station IDs exist
  if (ids.length > 0) {
    const existing = await db('stations').whereIn('id', ids).select('id');
    const existingIds = existing.map(s => s.id);
    const invalid = ids.filter(i => !existingIds.includes(i));
    if (invalid.length) {
      ctx.status = 400;
      ctx.body = { success: false, error: { code: 'VALIDATION_ERROR', message: `Invalid station IDs: ${invalid.join(', ')}` } };
      return;
    }
  }

  // Replace assignments
  await db('user_station_scopes').where('user_id', id).del();
  if (ids.length > 0) {
    await db('user_station_scopes').insert(ids.map(sid => ({ user_id: parseInt(id), station_id: sid })));
  }

  await logAudit(ctx.state.user.id, ctx.state.user.username, 'station_assignment_updated', 'user', parseInt(id),
    { username: user.username, station_ids: ids }, ctx.ip);

  const updated = await db('user_station_scopes as uss')
    .join('stations as s', 'uss.station_id', 's.id')
    .where('uss.user_id', id)
    .select('s.id', 's.code', 's.name', 's.region');

  ctx.body = { success: true, data: updated };
});

/**
 * POST /api/users/:id/generate-codes
 * Generate recovery codes for any user (Platform Ops only).
 */
router.post('/:id/generate-codes', async (ctx) => {
  const { id } = ctx.params;
  const user = await db('users').where('id', id).first();
  if (!user) {
    ctx.status = 404;
    ctx.body = { success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } };
    return;
  }
  const codes = await require('../services/authService').generateRecoveryCodes(parseInt(id));
  await require('../services/auditService').logAudit(
    ctx.state.user.id, ctx.state.user.username, 'admin_generated_recovery_codes',
    'user', parseInt(id), { targetUser: user.username, codeCount: codes.length }, ctx.ip
  );
  ctx.body = { success: true, data: { codes, userId: parseInt(id), username: user.username } };
});

module.exports = router;
