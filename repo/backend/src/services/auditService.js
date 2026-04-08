const db = require('../database/connection');
const log = require('../utils/logger');

/**
 * Log an audit event to the audit_logs table.
 * Schema: actor_id, actor_username, action, entity_type, entity_id, details (JSON), ip_address
 */
async function logAudit(actorId, actorUsername, action, entityType, entityId, details, ipAddress) {
  try {
    await db('audit_logs').insert({
      actor_id: actorId || null,
      actor_username: actorUsername || null,
      action,
      entity_type: entityType || null,
      entity_id: entityId || null,
      details: details ? JSON.stringify(details) : null,
      ip_address: ipAddress || null
    });
  } catch (err) {
    log.error('audit', 'Failed to write audit log', { action, entityType, entityId, error: err.message });
  }
}

/**
 * Helper to extract audit context from Koa ctx.
 */
function auditFromCtx(ctx) {
  return {
    actorId: ctx.state.user?.id || null,
    actorUsername: ctx.state.user?.username || null,
    ip: ctx.ip || null
  };
}

module.exports = { logAudit, auditFromCtx };
