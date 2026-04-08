const Router = require('koa-router');
const db = require('../database/connection');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { logAudit } = require('../services/auditService');

const router = new Router({ prefix: '/api' });

router.use(authenticate(), requireRole('platform_ops'));

// ─── AUDIT LOGS ──────────────────────────────────────────────

/**
 * GET /api/audit/logs
 * Query audit_logs. Filterable by action, entity_type, actor_username, date range.
 */
router.get('/audit/logs', async (ctx) => {
  const {
    page = 1, pageSize = 25,
    action, entity_type, actor_username,
    date_from, date_to
  } = ctx.query;
  const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  let query = db('audit_logs');
  let countQuery = db('audit_logs');

  if (action) {
    query = query.where('action', 'like', `%${action}%`);
    countQuery = countQuery.where('action', 'like', `%${action}%`);
  }
  if (entity_type) {
    query = query.where('entity_type', entity_type);
    countQuery = countQuery.where('entity_type', entity_type);
  }
  if (actor_username) {
    query = query.where('actor_username', actor_username);
    countQuery = countQuery.where('actor_username', actor_username);
  }
  if (date_from) {
    query = query.where('created_at', '>=', date_from);
    countQuery = countQuery.where('created_at', '>=', date_from);
  }
  if (date_to) {
    query = query.where('created_at', '<=', date_to);
    countQuery = countQuery.where('created_at', '<=', date_to);
  }

  const totalResult = await countQuery.count('* as count').first();
  const total = totalResult ? totalResult.count : 0;

  const logs = await query.orderBy('created_at', 'desc').limit(limit).offset(offset);

  ctx.body = {
    success: true,
    data: {
      results: logs.map(l => ({
        id: l.id,
        actor_id: l.actor_id,
        actor_username: l.actor_username,
        action: l.action,
        entity_type: l.entity_type,
        entity_id: l.entity_id,
        details: l.details ? (typeof l.details === 'string' ? JSON.parse(l.details) : l.details) : null,
        ip_address: l.ip_address,
        created_at: l.created_at
      })),
      total,
      page: parseInt(page, 10) || 1,
      pageSize: limit
    }
  };
});

/**
 * GET /api/audit/logs/:id
 * Get a single audit log entry.
 */
router.get('/audit/logs/:id', async (ctx) => {
  const { id } = ctx.params;

  const log = await db('audit_logs').where('id', id).first();
  if (!log) throw createError(404, 'NOT_FOUND', 'Audit log entry not found.');

  ctx.body = {
    success: true,
    data: {
      id: log.id,
      actor_id: log.actor_id,
      actor_username: log.actor_username,
      action: log.action,
      entity_type: log.entity_type,
      entity_id: log.entity_id,
      details: log.details ? (typeof log.details === 'string' ? JSON.parse(log.details) : log.details) : null,
      ip_address: log.ip_address,
      created_at: log.created_at
    }
  };
});

// ─── BACKTRACK ───────────────────────────────────────────────

/**
 * GET /api/backtrack/diff
 * Compare two points in time for an entity. Returns audit entries in the range
 * showing what changed.
 * Query params: entity (entity_type), id (entity_id), from (start date), to (end date)
 */
router.get('/backtrack/diff', async (ctx) => {
  const { entity, id: entityId, from, to } = ctx.query;

  if (!entity || !entityId) {
    throw createError(400, 'VALIDATION_ERROR', 'entity and id query parameters are required.');
  }
  if (!from || !to) {
    throw createError(400, 'VALIDATION_ERROR', 'from and to date parameters are required.');
  }

  const entries = await db('audit_logs')
    .where('entity_type', entity)
    .where('entity_id', entityId)
    .where('created_at', '>=', from)
    .where('created_at', '<=', to)
    .orderBy('created_at', 'asc');

  // Build a diff summary: collect all details from entries in range
  const changes = entries.map(e => ({
    id: e.id,
    action: e.action,
    actor_id: e.actor_id,
    actor_username: e.actor_username,
    details: e.details ? (typeof e.details === 'string' ? JSON.parse(e.details) : e.details) : null,
    ip_address: e.ip_address,
    created_at: e.created_at
  }));

  ctx.body = {
    success: true,
    data: {
      entity_type: entity,
      entity_id: entityId,
      from,
      to,
      total_changes: changes.length,
      changes
    }
  };
});

/**
 * GET /api/backtrack/replay
 * Replay events for an entity in a date range.
 * Query params: entity (entity_type), id (entity_id), from, to
 */
router.get('/backtrack/replay', async (ctx) => {
  const { entity, id: entityId, from, to } = ctx.query;

  if (!entity || !entityId) {
    throw createError(400, 'VALIDATION_ERROR', 'entity and id query parameters are required.');
  }

  let query = db('audit_logs')
    .where('entity_type', entity)
    .where('entity_id', entityId)
    .orderBy('created_at', 'asc');

  if (from) query = query.where('created_at', '>=', from);
  if (to) query = query.where('created_at', '<=', to);

  const entries = await query;

  // Replay: build a timeline of events with sequence numbers
  const timeline = entries.map((entry, index) => ({
    sequence: index + 1,
    id: entry.id,
    action: entry.action,
    actor_id: entry.actor_id,
    actor_username: entry.actor_username,
    details: entry.details ? (typeof entry.details === 'string' ? JSON.parse(entry.details) : entry.details) : null,
    ip_address: entry.ip_address,
    created_at: entry.created_at
  }));

  ctx.body = {
    success: true,
    data: {
      entity_type: entity,
      entity_id: entityId,
      from: from || null,
      to: to || null,
      total_events: timeline.length,
      timeline
    }
  };
});

// ─── CORRECTIVE ACTIONS ──────────────────────────────────────

/**
 * POST /api/backtrack/corrective-actions
 * Create a corrective action record.
 */
router.post('/backtrack/corrective-actions', async (ctx) => {
  const {
    entity_type, entity_id, description,
    action_taken
  } = ctx.request.body || {};

  if (!entity_type) {
    throw createError(400, 'VALIDATION_ERROR', 'entity_type is required.');
  }
  if (!entity_id) {
    throw createError(400, 'VALIDATION_ERROR', 'entity_id is required.');
  }
  if (!description || description.trim().length === 0) {
    throw createError(400, 'VALIDATION_ERROR', 'description is required.');
  }
  if (!action_taken || action_taken.trim().length === 0) {
    throw createError(400, 'VALIDATION_ERROR', 'action_taken is required.');
  }

  const [actionId] = await db('corrective_actions').insert({
    entity_type,
    entity_id,
    description: description.trim(),
    action_taken: action_taken.trim(),
    performed_by: ctx.state.user.id  // Always bind to authenticated user
  });

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'backtrack.corrective_action',
    'corrective_actions',
    actionId,
    { entity_type, entity_id, description: description.trim(), action_taken: action_taken.trim() },
    ctx.ip
  );

  const created = await db('corrective_actions').where('id', actionId).first();

  ctx.status = 201;
  ctx.body = {
    success: true,
    data: {
      id: created.id,
      entity_type: created.entity_type,
      entity_id: created.entity_id,
      description: created.description,
      action_taken: created.action_taken,
      performed_by: created.performed_by
    }
  };
});

module.exports = router;
