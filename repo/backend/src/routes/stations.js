const Router = require('koa-router');
const db = require('../database/connection');
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { logAudit } = require('../services/auditService');
const { normalize, findMatchingStations } = require('../utils/fuzzyMatch');

const router = new Router({ prefix: '/api/stations' });

/**
 * GET /api/stations
 * List stations. Supports fuzzy search via ?q= parameter.
 * Optionally authenticated — works for anonymous and logged-in users alike.
 */
router.get('/', optionalAuth(), async (ctx) => {
  const { page = 1, pageSize = 25, q, scope } = ctx.query;
  const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  // scope=network: authenticated hosts can see all active stations for route authoring
  // This does NOT grant operational access (schedules/inventory remain station-scoped)
  const isNetworkScope = scope === 'network' && ctx.state.user;

  if (q && q.trim().length > 0) {
    // --- Fuzzy search mode ---
    const allStations = await db('stations')
      .where('is_active', true)
      .select('id', 'code', 'name', 'name_normalized', 'region', 'is_active', 'created_at');

    // Load aliases for fuzzy matching
    const aliases = await db('station_aliases').select('station_id', 'alias', 'alias_normalized');
    const aliasMap = {};
    for (const a of aliases) {
      if (!aliasMap[a.station_id]) aliasMap[a.station_id] = [];
      aliasMap[a.station_id].push(a);
    }

    const stationsWithAliases = allStations.map((s) => ({
      ...s,
      aliases: aliasMap[s.id] || []
    }));

    const matched = findMatchingStations(q, stationsWithAliases);

    // Host scope: filter to assigned stations only, unless scope=network (route authoring)
    let filteredMatched = matched;
    if (ctx.state.user && ctx.state.user.role === 'host' && !isNetworkScope) {
      const assignedIds = ctx.state.user.assignedStationIds || [];
      filteredMatched = matched.filter(s => assignedIds.includes(s.id));
    }

    const total = filteredMatched.length;
    const paged = filteredMatched.slice(offset, offset + limit);

    ctx.body = {
      success: true,
      data: {
        results: paged.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          region: s.region,
          isActive: s.is_active,
          createdAt: s.created_at
        })),
        total,
        page: parseInt(page, 10) || 1,
        pageSize: limit
      }
    };
    return;
  }

  // --- Standard paginated list ---
  // For host users, filter to only their assigned stations (unless scope=network for route authoring)
  let stationQuery = db('stations');
  let stationCountQuery = db('stations');

  if (ctx.state.user && ctx.state.user.role === 'host' && !isNetworkScope) {
    const assignedIds = await db('user_station_scopes')
      .where('user_id', ctx.state.user.id)
      .select('station_id');
    const ids = assignedIds.map(r => r.station_id);
    stationQuery = stationQuery.whereIn('id', ids);
    stationCountQuery = stationCountQuery.whereIn('id', ids);
  }

  const totalResult = await stationCountQuery.count('id as count').first();
  const total = totalResult ? totalResult.count : 0;

  const stations = await stationQuery
    .orderBy('name', 'asc')
    .limit(limit)
    .offset(offset)
    .select('id', 'code', 'name', 'region', 'is_active', 'created_at');

  ctx.body = {
    success: true,
    data: {
      results: stations.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        region: s.region,
        isActive: s.is_active,
        createdAt: s.created_at
      })),
      total,
      page: parseInt(page, 10) || 1,
      pageSize: limit
    }
  };
});

/**
 * GET /api/stations/:id
 * Get a single station with its aliases.
 */
router.get('/:id', optionalAuth(), async (ctx) => {
  const { id } = ctx.params;

  const station = await db('stations').where('id', id).first();
  if (!station) {
    throw createError(404, 'NOT_FOUND', 'Station not found.');
  }

  // Host scope check
  if (ctx.state.user && ctx.state.user.role === 'host') {
    const assignedIds = ctx.state.user.assignedStationIds || [];
    if (!assignedIds.includes(station.id)) {
      throw createError(403, 'FORBIDDEN', 'You are not assigned to this station.');
    }
  }

  const aliases = await db('station_aliases')
    .where('station_id', id)
    .select('id', 'alias');

  ctx.body = {
    success: true,
    data: {
      id: station.id,
      code: station.code,
      name: station.name,
      region: station.region,
      isActive: station.is_active,
      aliases: aliases.map((a) => ({ id: a.id, alias: a.alias })),
      createdAt: station.created_at
    }
  };
});

/**
 * POST /api/stations
 * Create a new station. Platform Ops only.
 * Required fields: code, name.
 */
router.post('/', authenticate(), requireRole('platform_ops'), async (ctx) => {
  const { code, name, region } = ctx.request.body || {};

  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    throw createError(400, 'VALIDATION_ERROR', 'code is required.');
  }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw createError(400, 'VALIDATION_ERROR', 'name is required.');
  }

  // Check uniqueness of code
  const existingCode = await db('stations').where('code', code).first();
  if (existingCode) {
    throw createError(409, 'CONFLICT', 'Station code already exists.');
  }

  const nameNormalized = normalize(name);
  const now = new Date();

  const [stationId] = await db('stations').insert({
    code,
    name,
    name_normalized: nameNormalized,
    region: region || null,
    is_active: true,
    created_at: now
  });

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'station.create',
    'stations',
    stationId,
    { code, name, region: region || null },
    ctx.ip
  );

  ctx.status = 201;
  ctx.body = {
    success: true,
    data: {
      id: stationId,
      code,
      name,
      region: region || null,
      isActive: true,
      createdAt: now
    }
  };
});

/**
 * PATCH /api/stations/:id
 * Update a station. Platform Ops only.
 */
router.patch('/:id', authenticate(), requireRole('platform_ops'), async (ctx) => {
  const { id } = ctx.params;
  const { name, code, region, is_active } = ctx.request.body || {};

  const station = await db('stations').where('id', id).first();
  if (!station) {
    throw createError(404, 'NOT_FOUND', 'Station not found.');
  }

  const updates = {};
  const changedFields = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw createError(400, 'VALIDATION_ERROR', 'name must be a non-empty string.');
    }
    updates.name = name;
    updates.name_normalized = normalize(name);
    changedFields.name = name;
  }

  if (code !== undefined) {
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw createError(400, 'VALIDATION_ERROR', 'code must be a non-empty string.');
    }
    // Check uniqueness if code is changing
    if (code !== station.code) {
      const existingCode = await db('stations').where('code', code).whereNot('id', id).first();
      if (existingCode) {
        throw createError(409, 'CONFLICT', 'Station code already exists.');
      }
    }
    updates.code = code;
    changedFields.code = code;
  }

  if (region !== undefined) {
    updates.region = region;
    changedFields.region = region;
  }

  if (is_active !== undefined) {
    updates.is_active = !!is_active;
    changedFields.is_active = !!is_active;
  }

  if (Object.keys(updates).length === 0) {
    throw createError(400, 'VALIDATION_ERROR', 'No valid fields to update.');
  }

  await db('stations').where('id', id).update(updates);

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'station.update',
    'stations',
    id,
    changedFields,
    ctx.ip
  );

  const updated = await db('stations').where('id', id).first();

  ctx.body = {
    success: true,
    data: {
      id: updated.id,
      code: updated.code,
      name: updated.name,
      region: updated.region,
      isActive: updated.is_active,
      createdAt: updated.created_at
    }
  };
});

module.exports = router;
