const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/connection');
const { logAudit } = require('./auditService');

const BCRYPT_COST = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 10 * 60 * 1000;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const MAX_LOCKOUTS_24H = 3;
const SESSION_HARD_EXPIRY_DAYS = 30;

async function checkLockout(username) {
  const activeLockout = await db('lockouts')
    .where('username', username)
    .whereNull('unlocked_at')
    .orderBy('locked_at', 'desc')
    .first();

  if (!activeLockout) return { locked: false };

  if (activeLockout.requires_admin_reset) {
    return { locked: true, requiresAdminReset: true, message: 'Account locked. Contact administrator.' };
  }

  const lockExpiry = new Date(activeLockout.locked_at).getTime() + LOCKOUT_DURATION_MS;
  if (Date.now() < lockExpiry) {
    const remainingSec = Math.ceil((lockExpiry - Date.now()) / 1000);
    return { locked: true, remainingSec, message: `Account locked. Try again in ${remainingSec} seconds.` };
  }

  await db('lockouts').where('id', activeLockout.id).update({ unlocked_at: new Date(), unlock_reason: 'auto_expired' });
  return { locked: false };
}

async function recordFailedAttempt(username, ip, deviceFingerprint, reason) {
  await db('login_attempts').insert({
    username, ip_address: ip, device_fingerprint: deviceFingerprint,
    success: false, failure_reason: reason
  });

  const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MS);
  const recentFailures = await db('login_attempts')
    .where('username', username)
    .where('success', false)
    .where('attempted_at', '>=', windowStart)
    .count('id as count')
    .first();

  if (recentFailures.count >= MAX_FAILED_ATTEMPTS) {
    // Check if there's already an active lockout -- don't create duplicates
    const activeLockout = await db('lockouts')
      .where('username', username)
      .whereNull('unlocked_at')
      .first();
    if (activeLockout) {
      // Already locked -- don't create a duplicate
      return;
    }

    // Count DISTINCT lockout windows in last 24 hours (only resolved/expired ones plus the new one)
    const dayStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentLockouts = await db('lockouts')
      .where('username', username)
      .where('locked_at', '>=', dayStart)
      .count('id as count')
      .first();

    const lockoutCount = (recentLockouts.count || 0) + 1;
    const requiresAdminReset = lockoutCount >= MAX_LOCKOUTS_24H;

    await db('lockouts').insert({
      username,
      lockout_count_24h: lockoutCount,
      requires_admin_reset: requiresAdminReset
    });

    await logAudit(null, username, 'lockout', 'user', null, { lockoutCount, requiresAdminReset, ip });
  }
}

async function login({ username, password, deviceFingerprint, ipAddress }) {
  const lockStatus = await checkLockout(username);
  if (lockStatus.locked) {
    return { success: false, error: lockStatus.message, locked: true };
  }

  const user = await db('users').where('username', username).where('is_active', true).first();
  if (!user) {
    await recordFailedAttempt(username, ipAddress, deviceFingerprint, 'user_not_found');
    return { success: false, error: 'Invalid username or password.' };
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    await recordFailedAttempt(username, ipAddress, deviceFingerprint, 'invalid_password');
    return { success: false, error: 'Invalid username or password.' };
  }

  // Device fingerprint is mandatory — fail closed if missing
  if (!deviceFingerprint || typeof deviceFingerprint !== 'string' || deviceFingerprint.trim().length === 0) {
    return { success: false, error: 'Device fingerprint is required for login.' };
  }

  const trusted = await db('trusted_devices')
    .where('user_id', user.id)
    .where('device_fingerprint', deviceFingerprint)
    .first();

  if (!trusted) {
    // Check for unused recovery codes
    const unusedCodes = await db('recovery_codes')
      .where('user_id', user.id)
      .where('is_used', false)
      .first();

    if (unusedCodes) {
      // Has unused codes — require device verification
      const pendingToken = uuidv4();
      const pendingTokenHash = crypto.createHash('sha256').update(pendingToken).digest('hex');
      const pendingExpiry = new Date(Date.now() + 10 * 60 * 1000);
      await db('sessions').insert({
        id: pendingTokenHash,
        user_id: user.id,
        device_fingerprint: 'PENDING_VERIFICATION',
        state: 'pending_verification',
        ip_address: ipAddress,
        expires_at: pendingExpiry
      });
      return {
        success: true,
        requireDeviceVerification: true,
        sessionToken: pendingToken
      };
    }

    // No unused codes — check if codes were ever generated
    const anyCodes = await db('recovery_codes').where('user_id', user.id).first();
    if (anyCodes) {
      // All codes exhausted — block until admin regenerates
      await logAudit(user.id, username, 'login_blocked_codes_exhausted', 'user', user.id, { ip: ipAddress, deviceFingerprint });
      return { success: false, error: 'All recovery codes exhausted. Contact administrator to generate new codes.' };
    }

    // No codes ever generated — enrollment required
    // Platform Ops can generate codes for this user via POST /api/auth/recovery-codes or admin endpoint
    await logAudit(user.id, username, 'login_blocked_enrollment_required', 'user', user.id, { ip: ipAddress, deviceFingerprint });
    return {
      success: false,
      error: 'Device enrollment required. Contact administrator to generate recovery codes for your account.',
      enrollmentRequired: true
    };
  }

  // Session limits — only count active sessions, not pending_verification
  const activeCount = await db('sessions')
    .where('user_id', user.id)
    .where('state', 'active')
    .where('expires_at', '>', new Date())
    .count('id as count')
    .first();

  let maxSessions = user.max_sessions || 2;
  const exception = await db('session_exceptions')
    .where('user_id', user.id)
    .where(function() { this.whereNull('expires_at').orWhere('expires_at', '>', new Date()); })
    .orderBy('created_at', 'desc')
    .first();
  if (exception) maxSessions = exception.max_sessions;

  if (activeCount.count >= maxSessions) {
    await logAudit(user.id, username, 'session_cap_denied', 'session', null, {
      activeCount: activeCount.count, maxSessions, ip: ipAddress
    });
    return {
      success: false,
      error: `Session limit reached (${maxSessions} active). Log out of another session or contact Platform Operations for an exception.`,
      sessionCapExceeded: true
    };
  }

  // Create session
  const token = uuidv4();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + SESSION_HARD_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await db('sessions').insert({
    id: tokenHash, user_id: user.id, device_fingerprint: deviceFingerprint || null,
    state: 'active', ip_address: ipAddress, expires_at: expiresAt
  });

  await db('login_attempts').insert({
    username, ip_address: ipAddress, device_fingerprint: deviceFingerprint, success: true
  });

  await logAudit(user.id, username, 'login', 'session', null, { ip: ipAddress, deviceFingerprint });

  return {
    success: true,
    token,
    user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role, phone_last4: user.phone_last4 }
  };
}

async function verifyDevice(userId, code, deviceFingerprint) {
  const codes = await db('recovery_codes').where('user_id', userId).where('is_used', false);

  for (const stored of codes) {
    const match = await bcrypt.compare(code, stored.code_hash);
    if (match) {
      await db('recovery_codes').where('id', stored.id).update({ is_used: true, used_at: new Date() });

      const user = await db('users').where('id', userId).first();

      // Require fingerprint
      if (!deviceFingerprint || typeof deviceFingerprint !== 'string' || deviceFingerprint.trim().length === 0) {
        return { success: false, error: 'Device fingerprint is required for verification.' };
      }

      // Trust the device
      await db('trusted_devices').insert({ user_id: userId, device_fingerprint: deviceFingerprint }).catch(() => {});

      // Enforce session cap — only count active sessions, not pending_verification
      const activeCount = await db('sessions')
        .where('user_id', userId)
        .where('state', 'active')
        .where('expires_at', '>', new Date())
        .count('id as count')
        .first();

      let maxSessions = user.max_sessions || 2;
      const exception = await db('session_exceptions')
        .where('user_id', userId)
        .where(function() { this.whereNull('expires_at').orWhere('expires_at', '>', new Date()); })
        .orderBy('created_at', 'desc')
        .first();
      if (exception) maxSessions = exception.max_sessions;

      if (activeCount.count >= maxSessions) {
        await logAudit(userId, user.username, 'session_cap_denied', 'session', null, {
          activeCount: activeCount.count, maxSessions, context: 'device_verification'
        });
        return {
          success: false,
          error: `Session limit reached (${maxSessions} active). Log out of another session or contact Platform Operations for an exception.`,
          sessionCapExceeded: true
        };
      }

      const token = uuidv4();
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + SESSION_HARD_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      await db('sessions').insert({ id: tokenHash, user_id: userId, device_fingerprint: deviceFingerprint, state: 'active', expires_at: expiresAt });

      await logAudit(userId, user.username, 'device_verified', 'trusted_device', null, { deviceFingerprint });

      return {
        success: true,
        token,
        user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role, phone_last4: user.phone_last4 }
      };
    }
  }

  return { success: false, error: 'Invalid recovery code.' };
}

async function generateRecoveryCodes(userId) {
  await db('recovery_codes').where('user_id', userId).del();

  const codes = [];
  for (let i = 0; i < 10; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const hash = await bcrypt.hash(code, BCRYPT_COST);
    codes.push({ plaintext: code, hash });
  }

  await db('recovery_codes').insert(codes.map(c => ({ user_id: userId, code_hash: c.hash })));
  return codes.map(c => c.plaintext);
}

async function unlockUser(username, adminId, adminUsername) {
  await db('lockouts')
    .where('username', username)
    .whereNull('unlocked_at')
    .update({ unlocked_at: new Date(), unlock_reason: 'admin_reset', unlocked_by: adminId });

  await logAudit(adminId, adminUsername, 'user_unlocked', 'user', null, { unlockedUser: username });
}

module.exports = { login, verifyDevice, generateRecoveryCodes, unlockUser, checkLockout };
