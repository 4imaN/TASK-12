const Router = require('koa-router');
const db = require('../database/connection');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { logAudit, auditFromCtx } = require('../services/auditService');

const router = new Router({ prefix: '/api/trainsets' });

/**
 * GET /api/trainsets
 * List all trainsets. Authenticated.
 */
router.get('/', authenticate(), async (ctx) => {
  const trainsets = await db('trainsets').orderBy('code', 'asc');

  ctx.body = {
    success: true,
    data: trainsets.map(t => ({
      id: t.id,
      code: t.code,
      name: t.name,
      totalCapacity: t.total_capacity,
      isActive: !!t.is_active
    }))
  };
});

/**
 * POST /api/trainsets
 * Create a new trainset. Platform Ops only.
 */
router.post('/', authenticate(), requireRole('platform_ops'), async (ctx) => {
  const { code, name, totalCapacity, isActive } = ctx.request.body || {};

  if (!code || code.length < 2 || code.length > 20) {
    throw createError(400, 'VALIDATION_ERROR', 'Code must be 2-20 characters.');
  }
  if (!name || typeof name !== 'string') {
    throw createError(400, 'VALIDATION_ERROR', 'Name is required.');
  }
  if (!totalCapacity || !Number.isInteger(totalCapacity) || totalCapacity < 1) {
    throw createError(400, 'VALIDATION_ERROR', 'Total capacity must be a positive integer.');
  }

  // Check unique code
  const existing = await db('trainsets').where('code', code).first();
  if (existing) throw createError(409, 'CONFLICT', 'Trainset code already exists.');

  const [trainsetId] = await db('trainsets').insert({
    code,
    name,
    total_capacity: totalCapacity,
    is_active: isActive !== undefined ? isActive : true
  });

  const { actorId, actorUsername, ip } = auditFromCtx(ctx);
  await logAudit(actorId, actorUsername, 'trainset.create', 'trainsets', trainsetId,
    { code, name, totalCapacity }, ip);

  ctx.status = 201;
  ctx.body = {
    success: true,
    data: {
      id: trainsetId,
      code,
      name,
      totalCapacity,
      isActive: isActive !== undefined ? isActive : true
    }
  };
});

/**
 * PATCH /api/trainsets/:id
 * Update a trainset. Platform Ops only.
 */
router.patch('/:id', authenticate(), requireRole('platform_ops'), async (ctx) => {
  const { id } = ctx.params;
  const { code, name, totalCapacity, isActive } = ctx.request.body || {};

  const trainset = await db('trainsets').where('id', id).first();
  if (!trainset) throw createError(404, 'NOT_FOUND', 'Trainset not found.');

  const updates = {};
  if (code !== undefined) {
    if (code.length < 2 || code.length > 20) {
      throw createError(400, 'VALIDATION_ERROR', 'Code must be 2-20 characters.');
    }
    // Check unique code if changing
    if (code !== trainset.code) {
      const dup = await db('trainsets').where('code', code).whereNot('id', id).first();
      if (dup) throw createError(409, 'CONFLICT', 'Trainset code already exists.');
    }
    updates.code = code;
  }
  if (name !== undefined) updates.name = name;
  if (totalCapacity !== undefined) {
    if (!Number.isInteger(totalCapacity) || totalCapacity < 1) {
      throw createError(400, 'VALIDATION_ERROR', 'Total capacity must be a positive integer.');
    }
    updates.total_capacity = totalCapacity;
  }
  if (isActive !== undefined) updates.is_active = isActive;

  if (Object.keys(updates).length === 0) {
    throw createError(400, 'VALIDATION_ERROR', 'No fields to update.');
  }

  await db('trainsets').where('id', id).update(updates);
  const updated = await db('trainsets').where('id', id).first();

  const { actorId, actorUsername, ip } = auditFromCtx(ctx);
  await logAudit(actorId, actorUsername, 'trainset.update', 'trainsets', id,
    { old: { code: trainset.code, name: trainset.name, total_capacity: trainset.total_capacity, is_active: trainset.is_active }, new: updates }, ip);

  ctx.body = {
    success: true,
    data: {
      id: updated.id,
      code: updated.code,
      name: updated.name,
      totalCapacity: updated.total_capacity,
      isActive: !!updated.is_active
    }
  };
});

module.exports = router;
