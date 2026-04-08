const Router = require('koa-router');
const db = require('../database/connection');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { logAudit, auditFromCtx } = require('../services/auditService');
const { validateScheduleForPublish } = require('../utils/validators');

const router = new Router({ prefix: '/api/schedules' });

router.use(authenticate());

/**
 * Shared helper: look up the schedule by ID and enforce station-scope for hosts.
 * Returns the schedule row on success, or null after setting ctx.status/ctx.body on failure.
 */
async function enforceScheduleScope(ctx, scheduleId) {
  const schedule = await db('schedules').where('id', scheduleId).first();
  if (!schedule) {
    ctx.status = 404;
    ctx.body = { success: false, error: { code: 'NOT_FOUND', message: 'Schedule not found.' } };
    return null;
  }
  // Host scope check
  if (ctx.state.user.role === 'host') {
    const stationIds = ctx.state.user.assignedStationIds || [];
    if (!stationIds.includes(schedule.station_id)) {
      ctx.status = 403;
      ctx.body = { success: false, error: { code: 'FORBIDDEN', message: 'You are not assigned to this schedule\'s station.' } };
      return null;
    }
  }
  return schedule;
}

/**
 * GET /api/schedules
 * List schedules. Station-scoped for hosts via user_station_scopes.
 */
router.get('/', requireRole('host', 'platform_ops'), async (ctx) => {
  const user = ctx.state.user;

  let query = db('schedules as s')
    .leftJoin('schedule_versions as sv', 's.active_version_id', 'sv.id')
    .leftJoin('stations as st', 's.station_id', 'st.id')
    .leftJoin('trainsets as t', 's.trainset_id', 't.id')
    .select(
      's.id', 's.station_id', 's.route_name', 's.trainset_id',
      's.active_version_id', 's.created_by', 's.created_at', 's.updated_at',
      'sv.version_number', 'sv.status as version_status',
      'sv.effective_at', 'sv.published_at',
      'st.name as station_name',
      't.code as trainset_code'
    );

  // Station-scope for hosts
  if (user.role === 'host') {
    const stationIds = user.assignedStationIds || [];
    if (stationIds.length === 0) {
      throw createError(403, 'FORBIDDEN', 'You have no station assignments.');
    }
    query = query.whereIn('s.station_id', stationIds);
  }

  const schedules = await query.orderBy('s.updated_at', 'desc');

  ctx.body = {
    success: true,
    data: schedules.map(s => ({
      id: s.id,
      station_id: s.station_id,
      route_name: s.route_name,
      station_name: s.station_name || null,
      trainset_id: s.trainset_id,
      trainset_code: s.trainset_code || null,
      active_version_id: s.active_version_id,
      active_version_number: s.version_number || null,
      latest_status: s.version_status || null,
      effective_at: s.effective_at,
      published_at: s.published_at,
      created_by: s.created_by,
      created_at: s.created_at,
      updated_at: s.updated_at
    }))
  };
});

/**
 * POST /api/schedules
 * Create a new schedule with an initial draft version.
 * Body includes stops and seat_classes for the first version.
 */
router.post('/', requireRole('host', 'platform_ops'), async (ctx) => {
  const body = ctx.request.body || {};
  const stationId = body.stationId || body.station_id;
  const routeName = body.routeName || body.route_name;
  const trainsetId = body.trainsetId || body.trainset_id;
  const stops = body.stops || [];
  const seatClasses = body.seatClasses || body.seat_classes || [];
  const effectiveAt = body.effectiveAt || body.effective_at;
  const notes = body.notes;

  if (!stationId) throw createError(400, 'VALIDATION_ERROR', 'Station ID is required.');
  if (!routeName || typeof routeName !== 'string') {
    throw createError(400, 'VALIDATION_ERROR', 'Route name is required.');
  }

  // Host scope check: station_id must be in assigned stations
  if (ctx.state.user.role === 'host') {
    const assignedIds = ctx.state.user.assignedStationIds || [];
    if (!assignedIds.includes(stationId)) {
      throw createError(403, 'FORBIDDEN', 'You are not assigned to this station.');
    }
  }

  // Verify trainset if provided
  if (trainsetId) {
    const trainset = await db('trainsets').where('id', trainsetId).first();
    if (!trainset) throw createError(400, 'VALIDATION_ERROR', 'Trainset not found.');
    if (!trainset.is_active) throw createError(400, 'VALIDATION_ERROR', 'Trainset is not active.');
  }

  const now = new Date();

  let scheduleId, versionId;

  await db.transaction(async (trx) => {
    // Create the schedule
    [scheduleId] = await trx('schedules').insert({
      station_id: stationId,
      route_name: routeName,
      trainset_id: trainsetId || null,
      active_version_id: null,
      created_by: ctx.state.user.id,
      created_at: now,
      updated_at: now
    });

    // Create initial draft version
    [versionId] = await trx('schedule_versions').insert({
      schedule_id: scheduleId,
      version_number: 1,
      status: 'draft',
      trainset_id: trainsetId || null,
      effective_at: effectiveAt || null,
      published_at: null,
      created_by: ctx.state.user.id,
      created_at: now,
      notes: notes || null,
      rollback_source_version_id: null
    });

    // Insert stops
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      await trx('schedule_stops').insert({
        version_id: versionId,
        station_id: stop.stationId || stop.station_id,
        stop_sequence: stop.stopSequence || stop.stop_sequence || (i + 1),
        arrival_at: stop.arrivalAt || stop.arrival_at || null,
        departure_at: stop.departureAt || stop.departure_at,
        platform: stop.platform || null
      });
    }

    // Insert seat classes
    for (const sc of seatClasses) {
      await trx('seat_classes').insert({
        version_id: versionId,
        class_code: sc.classCode || sc.class_code,
        class_name: sc.className || sc.class_name,
        capacity: sc.capacity,
        fare: sc.fare,
        is_available: sc.isAvailable !== undefined ? sc.isAvailable : (sc.is_available !== undefined ? sc.is_available : true)
      });
    }
  });

  // Write-time DQ: completeness check — schedule should have stops and seat classes
  const dqIssues = [];
  if (!stops || stops.length === 0) {
    dqIssues.push({ check_type: 'completeness', description: 'Schedule created without any stops.' });
  }
  if (!seatClasses || seatClasses.length === 0) {
    dqIssues.push({ check_type: 'completeness', description: 'Schedule created without any seat classes.' });
  }
  // Uniqueness check: warn if a schedule with the same route_name already exists for this station
  const duplicateRoute = await db('schedules')
    .where('station_id', stationId)
    .where('route_name', routeName)
    .whereNot('id', scheduleId)
    .first();
  if (duplicateRoute) {
    dqIssues.push({
      check_type: 'uniqueness',
      description: `Duplicate route_name "${routeName}" for station ${stationId} (existing schedule id=${duplicateRoute.id}).`
    });
  }
  for (const dqIssue of dqIssues) {
    const existingDq = await db('data_quality_issues')
      .where({ entity_type: 'schedules', entity_id: scheduleId, check_type: dqIssue.check_type })
      .whereIn('status', ['open', 'in_progress'])
      .first();
    if (!existingDq) {
      await db('data_quality_issues').insert({
        entity_type: 'schedules',
        entity_id: scheduleId,
        check_type: dqIssue.check_type,
        severity: 'medium',
        description: dqIssue.description,
        status: 'open',
        owner: 'platform_ops',
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        created_at: now,
        updated_at: now
      }).catch(() => {}); // best-effort DQ logging
    }
  }

  const { actorId, actorUsername, ip } = auditFromCtx(ctx);
  await logAudit(actorId, actorUsername, 'schedule.create', 'schedules', scheduleId,
    { routeName, stationId, trainsetId }, ip);

  ctx.status = 201;
  ctx.body = {
    success: true,
    data: {
      id: scheduleId,
      stationId,
      routeName,
      trainsetId: trainsetId || null,
      versionId,
      versionNumber: 1,
      status: 'draft',
      createdBy: ctx.state.user.id,
      createdAt: now,
      updatedAt: now
    }
  };
});

/**
 * PATCH /api/schedules/:id
 * Update schedule-level fields (route_name, station_id, trainset_id).
 * Requires a draft version to exist (draft workflow).
 * Changes are audited for version history traceability.
 */
router.patch('/:id', requireRole('host', 'platform_ops'), async (ctx) => {
  const { id } = ctx.params;
  const body = ctx.request.body || {};
  const routeName = body.routeName || body.route_name;
  const stationId = body.stationId || body.station_id;
  const trainsetId = body.trainsetId || body.trainset_id;

  const schedule = await enforceScheduleScope(ctx, id);
  if (!schedule) return;

  // Require an existing draft version (draft workflow enforcement)
  const draftVersion = await db('schedule_versions')
    .where('schedule_id', id)
    .where('status', 'draft')
    .first();
  if (!draftVersion) {
    throw createError(409, 'CONFLICT', 'Schedule can only be edited when a draft version exists. Create a new draft version first.');
  }

  const updates = {};
  const changedFields = {};

  if (routeName !== undefined) {
    if (typeof routeName !== 'string' || routeName.trim().length === 0) {
      throw createError(400, 'VALIDATION_ERROR', 'Route name must be a non-empty string.');
    }
    updates.route_name = routeName;
    changedFields.route_name = { from: schedule.route_name, to: routeName };
  }

  if (stationId !== undefined) {
    const station = await db('stations').where('id', stationId).where('is_active', true).first();
    if (!station) throw createError(400, 'VALIDATION_ERROR', 'Station not found or inactive.');
    // Host scope check: new station_id must be in assigned stations
    if (ctx.state.user.role === 'host') {
      const assignedIds = ctx.state.user.assignedStationIds || [];
      if (!assignedIds.includes(stationId)) {
        throw createError(403, 'FORBIDDEN', 'You are not assigned to the target station.');
      }
    }
    updates.station_id = stationId;
    changedFields.station_id = { from: schedule.station_id, to: stationId };
  }

  if (trainsetId !== undefined) {
    if (trainsetId) {
      const trainset = await db('trainsets').where('id', trainsetId).first();
      if (!trainset) throw createError(400, 'VALIDATION_ERROR', 'Trainset not found.');
      if (!trainset.is_active) throw createError(400, 'VALIDATION_ERROR', 'Trainset is not active.');
    }
    updates.trainset_id = trainsetId || null;
    changedFields.trainset_id = { from: schedule.trainset_id, to: trainsetId || null };
  }

  if (Object.keys(updates).length === 0) {
    throw createError(400, 'VALIDATION_ERROR', 'No valid fields to update.');
  }

  updates.updated_at = new Date();
  await db('schedules').where('id', id).update(updates);

  const { actorId, actorUsername, ip } = auditFromCtx(ctx);
  await logAudit(actorId, actorUsername, 'schedule.update', 'schedules', id, changedFields, ip);

  const updated = await db('schedules').where('id', id).first();
  const station = await db('stations').where('id', updated.station_id).first();
  const trainset = updated.trainset_id ? await db('trainsets').where('id', updated.trainset_id).first() : null;

  ctx.body = {
    success: true,
    data: {
      id: updated.id,
      station_id: updated.station_id,
      route_name: updated.route_name,
      station_name: station ? station.name : null,
      trainset_id: updated.trainset_id,
      trainset_code: trainset ? trainset.code : null,
      active_version_id: updated.active_version_id,
      created_by: updated.created_by,
      created_at: updated.created_at,
      updated_at: updated.updated_at
    }
  };
});

/**
 * GET /api/schedules/:id
 * Get a schedule with active version info.
 */
router.get('/:id', requireRole('host', 'platform_ops'), async (ctx) => {
  const { id } = ctx.params;

  const schedule = await enforceScheduleScope(ctx, id);
  if (!schedule) return;

  // Look up station name and trainset code
  const station = await db('stations').where('id', schedule.station_id).first();
  const trainset = schedule.trainset_id ? await db('trainsets').where('id', schedule.trainset_id).first() : null;

  let activeVersion = null;
  if (schedule.active_version_id) {
    activeVersion = await db('schedule_versions').where('id', schedule.active_version_id).first();
  } else {
    // Fall back to latest version
    activeVersion = await db('schedule_versions')
      .where('schedule_id', id)
      .orderBy('version_number', 'desc')
      .first();
  }

  let stops = [];
  let seatClasses = [];
  if (activeVersion) {
    stops = await db('schedule_stops as ss')
      .leftJoin('stations as stopSt', 'ss.station_id', 'stopSt.id')
      .where('ss.version_id', activeVersion.id)
      .orderBy('ss.stop_sequence', 'asc')
      .select('ss.*', 'stopSt.name as station_name');

    seatClasses = await db('seat_classes').where('version_id', activeVersion.id);
  }

  ctx.body = {
    success: true,
    data: {
      id: schedule.id,
      station_id: schedule.station_id,
      route_name: schedule.route_name,
      station_name: station ? station.name : null,
      trainset_id: schedule.trainset_id,
      trainset_code: trainset ? trainset.code : null,
      active_version_id: schedule.active_version_id,
      created_by: schedule.created_by,
      created_at: schedule.created_at,
      updated_at: schedule.updated_at,
      activeVersion: activeVersion ? {
        id: activeVersion.id,
        version_number: activeVersion.version_number,
        status: activeVersion.status,
        trainset_id: activeVersion.trainset_id,
        effective_at: activeVersion.effective_at,
        published_at: activeVersion.published_at,
        created_by: activeVersion.created_by,
        created_at: activeVersion.created_at,
        notes: activeVersion.notes,
        stops: stops.map(s => ({
          id: s.id,
          station_id: s.station_id,
          station_name: s.station_name || null,
          stop_sequence: s.stop_sequence,
          arrival_at: s.arrival_at,
          departure_at: s.departure_at,
          platform: s.platform
        })),
        seat_classes: seatClasses.map(sc => ({
          id: sc.id,
          class_code: sc.class_code,
          class_name: sc.class_name,
          capacity: sc.capacity,
          fare: parseFloat(sc.fare),
          is_available: !!sc.is_available
        }))
      } : null
    }
  };
});

/**
 * GET /api/schedules/:id/versions
 * List versions of a schedule.
 */
router.get('/:id/versions', requireRole('host', 'platform_ops'), async (ctx) => {
  const { id } = ctx.params;

  const schedule = await enforceScheduleScope(ctx, id);
  if (!schedule) return;

  const versions = await db('schedule_versions as sv')
    .leftJoin('users as u', 'sv.created_by', 'u.id')
    .where('sv.schedule_id', id)
    .orderBy('sv.version_number', 'desc')
    .select('sv.*', 'u.display_name as created_by_name');

  ctx.body = {
    success: true,
    data: versions.map(v => ({
      id: v.id,
      version_number: v.version_number,
      status: v.status,
      trainset_id: v.trainset_id,
      effective_at: v.effective_at,
      published_at: v.published_at,
      created_by: v.created_by,
      created_by_name: v.created_by_name || null,
      created_at: v.created_at,
      notes: v.notes,
      rollback_source_version_id: v.rollback_source_version_id
    }))
  };
});

/**
 * GET /api/schedules/:id/versions/:versionId
 * Get version detail with stops and seat classes.
 */
router.get('/:id/versions/:versionId', requireRole('host', 'platform_ops'), async (ctx) => {
  const { id, versionId } = ctx.params;

  const schedule = await enforceScheduleScope(ctx, id);
  if (!schedule) return;

  const version = await db('schedule_versions')
    .where('id', versionId)
    .where('schedule_id', id)
    .first();
  if (!version) throw createError(404, 'NOT_FOUND', 'Version not found.');

  const stops = await db('schedule_stops as ss')
    .leftJoin('stations as stopSt', 'ss.station_id', 'stopSt.id')
    .where('ss.version_id', versionId)
    .orderBy('ss.stop_sequence', 'asc')
    .select('ss.*', 'stopSt.name as station_name');

  const seatClasses = await db('seat_classes').where('version_id', versionId);

  ctx.body = {
    success: true,
    data: {
      id: version.id,
      schedule_id: version.schedule_id,
      version_number: version.version_number,
      status: version.status,
      trainset_id: version.trainset_id,
      effective_at: version.effective_at,
      published_at: version.published_at,
      created_by: version.created_by,
      created_at: version.created_at,
      notes: version.notes,
      rollback_source_version_id: version.rollback_source_version_id,
      stops: stops.map(s => ({
        id: s.id,
        station_id: s.station_id,
        station_name: s.station_name || null,
        stop_sequence: s.stop_sequence,
        arrival_at: s.arrival_at,
        departure_at: s.departure_at,
        platform: s.platform
      })),
      seat_classes: seatClasses.map(sc => ({
        id: sc.id,
        class_code: sc.class_code,
        class_name: sc.class_name,
        capacity: sc.capacity,
        fare: parseFloat(sc.fare),
        is_available: !!sc.is_available
      }))
    }
  };
});

/**
 * POST /api/schedules/:id/versions
 * Create a new draft version.
 */
router.post('/:id/versions', requireRole('host', 'platform_ops'), async (ctx) => {
  const { id } = ctx.params;
  const body = ctx.request.body || {};
  const { cloneFromVersionId, notes } = body;
  const incomingStops = body.stops || [];
  const incomingSeatClasses = body.seatClasses || body.seat_classes || [];
  const incomingTrainsetId = body.trainsetId || body.trainset_id;

  const schedule = await enforceScheduleScope(ctx, id);
  if (!schedule) return;

  // Only one draft at a time
  const existingDraft = await db('schedule_versions')
    .where('schedule_id', id)
    .where('status', 'draft')
    .first();
  if (existingDraft) {
    throw createError(409, 'CONFLICT', 'A draft version already exists for this schedule.');
  }

  // Next version number
  const maxVersion = await db('schedule_versions')
    .where('schedule_id', id)
    .max('version_number as max')
    .first();
  const nextVersion = (maxVersion ? maxVersion.max : 0) + 1;

  const now = new Date();
  let versionId;

  await db.transaction(async (trx) => {
    [versionId] = await trx('schedule_versions').insert({
      schedule_id: id,
      version_number: nextVersion,
      status: 'draft',
      trainset_id: incomingTrainsetId || schedule.trainset_id,
      effective_at: null,
      published_at: null,
      created_by: ctx.state.user.id,
      created_at: now,
      notes: notes || null,
      rollback_source_version_id: null
    });

    // Insert stops and seat classes from the request body (e.g., from ScheduleEditor saveDraft)
    if (!cloneFromVersionId && incomingStops.length > 0) {
      for (let i = 0; i < incomingStops.length; i++) {
        const stop = incomingStops[i];
        await trx('schedule_stops').insert({
          version_id: versionId,
          station_id: stop.stationId || stop.station_id,
          stop_sequence: stop.stopSequence || stop.stop_sequence || (i + 1),
          arrival_at: stop.arrivalAt || stop.arrival_at || null,
          departure_at: stop.departureAt || stop.departure_at,
          platform: stop.platform || null
        });
      }
    }

    if (!cloneFromVersionId && incomingSeatClasses.length > 0) {
      for (const sc of incomingSeatClasses) {
        await trx('seat_classes').insert({
          version_id: versionId,
          class_code: sc.classCode || sc.class_code,
          class_name: sc.className || sc.class_name,
          capacity: sc.capacity,
          fare: sc.fare,
          is_available: sc.isAvailable !== undefined ? sc.isAvailable : (sc.is_available !== undefined ? sc.is_available : true)
        });
      }
    }

    // Clone stops and seat classes if requested
    if (cloneFromVersionId) {
      const sourceVersion = await trx('schedule_versions')
        .where('id', cloneFromVersionId)
        .where('schedule_id', id)
        .first();

      if (sourceVersion) {
        const stops = await trx('schedule_stops').where('version_id', sourceVersion.id);
        for (const stop of stops) {
          await trx('schedule_stops').insert({
            version_id: versionId,
            station_id: stop.station_id,
            stop_sequence: stop.stop_sequence,
            arrival_at: stop.arrival_at,
            departure_at: stop.departure_at,
            platform: stop.platform
          });
        }

        const classes = await trx('seat_classes').where('version_id', sourceVersion.id);
        for (const sc of classes) {
          await trx('seat_classes').insert({
            version_id: versionId,
            class_code: sc.class_code,
            class_name: sc.class_name,
            capacity: sc.capacity,
            fare: sc.fare,
            is_available: sc.is_available
          });
        }

        // Copy trainset_id and effective_at from source
        await trx('schedule_versions').where('id', versionId).update({
          trainset_id: sourceVersion.trainset_id,
          effective_at: sourceVersion.effective_at
        });
      }
    }
  });

  const version = await db('schedule_versions').where('id', versionId).first();
  const stops = await db('schedule_stops').where('version_id', versionId).orderBy('stop_sequence', 'asc');
  const seatClasses = await db('seat_classes').where('version_id', versionId);

  const { actorId, actorUsername, ip } = auditFromCtx(ctx);
  await logAudit(actorId, actorUsername, 'schedule.create_version', 'schedule_versions', versionId,
    { scheduleId: id, versionNumber: nextVersion, cloneFromVersionId }, ip);

  ctx.status = 201;
  ctx.body = {
    success: true,
    data: {
      id: versionId,
      scheduleId: parseInt(id),
      versionNumber: nextVersion,
      status: 'draft',
      trainsetId: version.trainset_id,
      effectiveAt: version.effective_at,
      createdBy: ctx.state.user.id,
      createdAt: now,
      notes: version.notes,
      stops: stops.map(s => ({
        id: s.id,
        stationId: s.station_id,
        stopSequence: s.stop_sequence,
        arrivalAt: s.arrival_at,
        departureAt: s.departure_at,
        platform: s.platform
      })),
      seatClasses: seatClasses.map(sc => ({
        id: sc.id,
        classCode: sc.class_code,
        className: sc.class_name,
        capacity: sc.capacity,
        fare: parseFloat(sc.fare),
        isAvailable: !!sc.is_available
      }))
    }
  };
});

/**
 * PATCH /api/schedules/:id/versions/:versionId
 * Update a draft version's metadata.
 */
router.patch('/:id/versions/:versionId', requireRole('host', 'platform_ops'), async (ctx) => {
  const { id, versionId } = ctx.params;
  const { notes, effectiveAt, trainsetId } = ctx.request.body || {};

  const schedule = await enforceScheduleScope(ctx, id);
  if (!schedule) return;

  const version = await db('schedule_versions')
    .where('id', versionId)
    .where('schedule_id', id)
    .first();
  if (!version) throw createError(404, 'NOT_FOUND', 'Version not found.');
  if (version.status !== 'draft') {
    throw createError(409, 'CONFLICT', 'Only draft versions can be modified.');
  }

  const updates = {};
  if (notes !== undefined) updates.notes = notes;
  if (effectiveAt !== undefined) updates.effective_at = effectiveAt;
  if (trainsetId !== undefined) {
    const ts = await db('trainsets').where('id', trainsetId).first();
    if (!ts) throw createError(400, 'VALIDATION_ERROR', 'Trainset not found.');
    updates.trainset_id = trainsetId;
  }

  if (Object.keys(updates).length > 0) {
    await db('schedule_versions').where('id', versionId).update(updates);
  }

  const updated = await db('schedule_versions').where('id', versionId).first();

  ctx.body = {
    success: true,
    data: {
      id: updated.id,
      scheduleId: updated.schedule_id,
      versionNumber: updated.version_number,
      status: updated.status,
      trainsetId: updated.trainset_id,
      effectiveAt: updated.effective_at,
      notes: updated.notes,
      createdAt: updated.created_at
    }
  };
});

/**
 * POST /api/schedules/:id/versions/:versionId/stops
 * Add a stop to a draft version.
 */
router.post('/:id/versions/:versionId/stops', requireRole('host', 'platform_ops'), async (ctx) => {
  const { id, versionId } = ctx.params;
  const body = ctx.request.body || {};
  const stationId = body.stationId || body.station_id;
  const stopSequence = body.stopSequence || body.stop_sequence;
  const arrivalAt = body.arrivalAt || body.arrival_at;
  const departureAt = body.departureAt || body.departure_at;
  const platform = body.platform;

  const schedule = await enforceScheduleScope(ctx, id);
  if (!schedule) return;

  const version = await db('schedule_versions').where('id', versionId).where('schedule_id', id).first();
  if (!version) throw createError(404, 'NOT_FOUND', 'Version not found.');
  if (version.status !== 'draft') throw createError(409, 'CONFLICT', 'Only draft versions can be modified.');

  if (!stationId) throw createError(400, 'VALIDATION_ERROR', 'Station ID is required.');
  if (!departureAt) throw createError(400, 'VALIDATION_ERROR', 'Departure time is required.');
  if (!stopSequence || stopSequence < 1) throw createError(400, 'VALIDATION_ERROR', 'Stop sequence must be >= 1.');

  // Shift existing stops at or above the sequence
  await db('schedule_stops')
    .where('version_id', versionId)
    .where('stop_sequence', '>=', stopSequence)
    .increment('stop_sequence', 1);

  const [stopId] = await db('schedule_stops').insert({
    version_id: versionId,
    station_id: stationId,
    stop_sequence: stopSequence,
    arrival_at: arrivalAt || null,
    departure_at: departureAt,
    platform: platform || null
  });

  const { actorId, actorUsername, ip } = auditFromCtx(ctx);
  await logAudit(actorId, actorUsername, 'schedule.add_stop', 'schedule_stops', stopId,
    { stationId, stopSequence, departureAt }, ip);

  ctx.status = 201;
  ctx.body = {
    success: true,
    data: {
      id: stopId,
      stationId,
      stopSequence,
      arrivalAt: arrivalAt || null,
      departureAt,
      platform: platform || null
    }
  };
});

/**
 * PATCH /api/schedules/:id/versions/:versionId/stops/:stopId
 * Update a stop.
 */
router.patch('/:id/versions/:versionId/stops/:stopId', requireRole('host', 'platform_ops'), async (ctx) => {
  const { id, versionId, stopId } = ctx.params;
  const { stopSequence, arrivalAt, departureAt, platform } = ctx.request.body || {};

  const schedule = await enforceScheduleScope(ctx, id);
  if (!schedule) return;

  const version = await db('schedule_versions').where('id', versionId).where('schedule_id', id).first();
  if (!version) throw createError(404, 'NOT_FOUND', 'Version not found.');
  if (version.status !== 'draft') throw createError(409, 'CONFLICT', 'Only draft versions can be modified.');

  const stop = await db('schedule_stops').where('id', stopId).where('version_id', versionId).first();
  if (!stop) throw createError(404, 'NOT_FOUND', 'Stop not found in this version.');

  const updates = {};
  if (stopSequence !== undefined) updates.stop_sequence = stopSequence;
  if (arrivalAt !== undefined) updates.arrival_at = arrivalAt;
  if (departureAt !== undefined) updates.departure_at = departureAt;
  if (platform !== undefined) updates.platform = platform;

  if (Object.keys(updates).length > 0) {
    await db('schedule_stops').where('id', stopId).update(updates);
  }

  const updated = await db('schedule_stops').where('id', stopId).first();

  const { actorId, actorUsername, ip } = auditFromCtx(ctx);
  await logAudit(actorId, actorUsername, 'schedule.update_stop', 'schedule_stops', stopId,
    { old: stop, new: updates }, ip);

  ctx.body = {
    success: true,
    data: {
      id: updated.id,
      stationId: updated.station_id,
      stopSequence: updated.stop_sequence,
      arrivalAt: updated.arrival_at,
      departureAt: updated.departure_at,
      platform: updated.platform
    }
  };
});

/**
 * DELETE /api/schedules/:id/versions/:versionId/stops/:stopId
 * Delete a stop and re-sequence.
 */
router.delete('/:id/versions/:versionId/stops/:stopId', requireRole('host', 'platform_ops'), async (ctx) => {
  const { id, versionId, stopId } = ctx.params;

  const schedule = await enforceScheduleScope(ctx, id);
  if (!schedule) return;

  const version = await db('schedule_versions').where('id', versionId).where('schedule_id', id).first();
  if (!version) throw createError(404, 'NOT_FOUND', 'Version not found.');
  if (version.status !== 'draft') throw createError(409, 'CONFLICT', 'Only draft versions can be modified.');

  const stop = await db('schedule_stops').where('id', stopId).where('version_id', versionId).first();
  if (!stop) throw createError(404, 'NOT_FOUND', 'Stop not found.');

  await db('schedule_stops').where('id', stopId).delete();

  // Re-sequence remaining stops
  await db('schedule_stops')
    .where('version_id', versionId)
    .where('stop_sequence', '>', stop.stop_sequence)
    .decrement('stop_sequence', 1);

  const { actorId, actorUsername, ip } = auditFromCtx(ctx);
  await logAudit(actorId, actorUsername, 'schedule.remove_stop', 'schedule_stops', stopId,
    { removed: stop }, ip);

  ctx.body = {
    success: true,
    data: { message: 'Stop removed.', deletedStopId: parseInt(stopId) }
  };
});

/**
 * POST /api/schedules/:id/versions/:versionId/seat-classes
 * Add a seat class to a draft version.
 */
router.post('/:id/versions/:versionId/seat-classes', requireRole('host', 'platform_ops'), async (ctx) => {
  const { id, versionId } = ctx.params;
  const body = ctx.request.body || {};
  const classCode = body.classCode || body.class_code;
  const className = body.className || body.class_name;
  const capacity = body.capacity;
  const fare = body.fare;
  const isAvailable = body.isAvailable !== undefined ? body.isAvailable : body.is_available;

  const schedule = await enforceScheduleScope(ctx, id);
  if (!schedule) return;

  const version = await db('schedule_versions').where('id', versionId).where('schedule_id', id).first();
  if (!version) throw createError(404, 'NOT_FOUND', 'Version not found.');
  if (version.status !== 'draft') throw createError(409, 'CONFLICT', 'Only draft versions can be modified.');

  if (!classCode) throw createError(400, 'VALIDATION_ERROR', 'Class code is required.');
  if (!className) throw createError(400, 'VALIDATION_ERROR', 'Class name is required.');
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
    throw createError(400, 'VALIDATION_ERROR', 'Capacity must be an integer between 1 and 500.');
  }
  if (fare === undefined || fare === null || fare < 1 || fare > 999) {
    throw createError(400, 'VALIDATION_ERROR', 'Fare must be between 1 and 999.');
  }

  // Check duplicate class_code in version
  const existing = await db('seat_classes')
    .where('version_id', versionId)
    .where('class_code', classCode)
    .first();
  if (existing) {
    throw createError(409, 'CONFLICT', 'A seat class with this code already exists in this version.');
  }

  const [classId] = await db('seat_classes').insert({
    version_id: versionId,
    class_code: classCode,
    class_name: className,
    capacity,
    fare,
    is_available: isAvailable !== undefined ? isAvailable : true
  });

  const { actorId, actorUsername, ip } = auditFromCtx(ctx);
  await logAudit(actorId, actorUsername, 'schedule.add_seat_class', 'seat_classes', classId,
    { classCode, className, capacity, fare }, ip);

  ctx.status = 201;
  ctx.body = {
    success: true,
    data: {
      id: classId,
      classCode,
      className,
      capacity,
      fare: parseFloat(fare),
      isAvailable: isAvailable !== undefined ? isAvailable : true
    }
  };
});

/**
 * PATCH /api/schedules/:id/versions/:versionId/seat-classes/:classId
 * Update a seat class.
 */
router.patch('/:id/versions/:versionId/seat-classes/:classId', requireRole('host', 'platform_ops'), async (ctx) => {
  const { id, versionId, classId } = ctx.params;
  const body = ctx.request.body || {};
  const classCode = body.classCode || body.class_code;
  const className = body.className || body.class_name;
  const capacity = body.capacity;
  const fare = body.fare;
  const isAvailable = body.isAvailable !== undefined ? body.isAvailable : body.is_available;

  const schedule = await enforceScheduleScope(ctx, id);
  if (!schedule) return;

  const version = await db('schedule_versions').where('id', versionId).where('schedule_id', id).first();
  if (!version) throw createError(404, 'NOT_FOUND', 'Version not found.');
  if (version.status !== 'draft') throw createError(409, 'CONFLICT', 'Only draft versions can be modified.');

  const sc = await db('seat_classes').where('id', classId).where('version_id', versionId).first();
  if (!sc) throw createError(404, 'NOT_FOUND', 'Seat class not found in this version.');

  const updates = {};
  if (classCode !== undefined) updates.class_code = classCode;
  if (className !== undefined) updates.class_name = className;
  if (capacity !== undefined) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
      throw createError(400, 'VALIDATION_ERROR', 'Capacity must be 1-500.');
    }
    updates.capacity = capacity;
  }
  if (fare !== undefined) {
    if (fare < 1 || fare > 999) {
      throw createError(400, 'VALIDATION_ERROR', 'Fare must be between 1 and 999.');
    }
    updates.fare = fare;
  }
  if (isAvailable !== undefined) updates.is_available = isAvailable;

  if (Object.keys(updates).length > 0) {
    await db('seat_classes').where('id', classId).update(updates);
  }

  const updated = await db('seat_classes').where('id', classId).first();

  const { actorId, actorUsername, ip } = auditFromCtx(ctx);
  await logAudit(actorId, actorUsername, 'schedule.update_seat_class', 'seat_classes', classId,
    { old: sc, new: updates }, ip);

  ctx.body = {
    success: true,
    data: {
      id: updated.id,
      classCode: updated.class_code,
      className: updated.class_name,
      capacity: updated.capacity,
      fare: parseFloat(updated.fare),
      isAvailable: !!updated.is_available
    }
  };
});

/**
 * DELETE /api/schedules/:id/versions/:versionId/seat-classes/:classId
 * Remove a seat class.
 */
router.delete('/:id/versions/:versionId/seat-classes/:classId', requireRole('host', 'platform_ops'), async (ctx) => {
  const { id, versionId, classId } = ctx.params;

  const schedule = await enforceScheduleScope(ctx, id);
  if (!schedule) return;

  const version = await db('schedule_versions').where('id', versionId).where('schedule_id', id).first();
  if (!version) throw createError(404, 'NOT_FOUND', 'Version not found.');
  if (version.status !== 'draft') throw createError(409, 'CONFLICT', 'Only draft versions can be modified.');

  const sc = await db('seat_classes').where('id', classId).where('version_id', versionId).first();
  if (!sc) throw createError(404, 'NOT_FOUND', 'Seat class not found.');

  await db('seat_classes').where('id', classId).delete();

  const { actorId, actorUsername, ip } = auditFromCtx(ctx);
  await logAudit(actorId, actorUsername, 'schedule.remove_seat_class', 'seat_classes', classId,
    { removed: sc }, ip);

  ctx.body = {
    success: true,
    data: { message: 'Seat class removed.', deletedClassId: parseInt(classId) }
  };
});

/**
 * POST /api/schedules/:id/versions/:versionId/validate
 * Run pre-publish checklist using validators.
 */
router.post('/:id/versions/:versionId/validate', requireRole('host', 'platform_ops'), async (ctx) => {
  const { id, versionId } = ctx.params;

  const schedule = await enforceScheduleScope(ctx, id);
  if (!schedule) return;

  const version = await db('schedule_versions').where('id', versionId).where('schedule_id', id).first();
  if (!version) throw createError(404, 'NOT_FOUND', 'Version not found.');
  if (version.status !== 'draft') throw createError(409, 'CONFLICT', 'Only draft versions can be validated.');
  const stops = await db('schedule_stops').where('version_id', versionId).orderBy('stop_sequence', 'asc');
  const seatClasses = await db('seat_classes').where('version_id', versionId);

  const trainset = version.trainset_id
    ? await db('trainsets').where('id', version.trainset_id).first()
    : null;

  // Get all published schedule versions for overlap check, including first/last stop times
  const publishedSchedules = await db('schedule_versions')
    .join('schedules', 'schedule_versions.schedule_id', 'schedules.id')
    .leftJoin(
      db('schedule_stops')
        .select('version_id')
        .min('departure_at as first_departure')
        .select(db.raw('MAX(COALESCE(arrival_at, departure_at)) as last_arrival'))
        .groupBy('version_id')
        .as('stop_times'),
      'schedule_versions.id', 'stop_times.version_id'
    )
    .where('schedule_versions.status', 'published')
    .where('schedule_versions.trainset_id', version.trainset_id)
    .select(
      'schedule_versions.id',
      'schedule_versions.schedule_id',
      'schedule_versions.trainset_id',
      'stop_times.first_departure',
      'stop_times.last_arrival'
    );

  const result = validateScheduleForPublish(version, stops, seatClasses, trainset, publishedSchedules);

  ctx.body = { success: true, data: result };
});

/**
 * POST /api/schedules/:id/versions/:versionId/publish
 * Directly publish a draft version. Platform Ops only.
 */
router.post('/:id/versions/:versionId/publish', requireRole('platform_ops'), async (ctx) => {
  const { id, versionId } = ctx.params;

  const version = await db('schedule_versions').where('id', versionId).where('schedule_id', id).first();
  if (!version) throw createError(404, 'NOT_FOUND', 'Version not found.');
  if (version.status !== 'draft' && version.status !== 'approved') {
    throw createError(409, 'CONFLICT', 'Only draft or approved versions can be published.');
  }

  // Server-side checklist enforcement before publish
  const stops = await db('schedule_stops').where('version_id', versionId).orderBy('stop_sequence');
  const seatClasses = await db('seat_classes').where('version_id', versionId);
  const trainset = version.trainset_id ? await db('trainsets').where('id', version.trainset_id).first() : null;

  // Query published versions for trainset overlap check
  let publishedVersions = [];
  if (trainset) {
    publishedVersions = await db('schedule_versions as sv')
      .join('schedules as s', 'sv.schedule_id', 's.id')
      .leftJoin(
        db('schedule_stops').select('version_id')
          .min('departure_at as first_departure')
          .select(db.raw('MAX(COALESCE(arrival_at, departure_at)) as last_arrival'))
          .groupBy('version_id')
          .as('st'),
        'sv.id', 'st.version_id'
      )
      .where('sv.status', 'published')
      .where('sv.trainset_id', trainset.id)
      .select('sv.id', 'sv.schedule_id', 'sv.trainset_id', 'st.first_departure', 'st.last_arrival');
  }

  const validation = validateScheduleForPublish(version, stops, seatClasses, trainset, publishedVersions);
  if (!validation.valid) {
    throw createError(400, 'VALIDATION_FAILED', 'Pre-publish checklist failed: ' + validation.errors.join('; '));
  }

  const now = new Date();
  const schedule = await db('schedules').where('id', id).first();

  await db.transaction(async (trx) => {
    // Archive currently published version
    if (schedule.active_version_id) {
      await trx('schedule_versions')
        .where('id', schedule.active_version_id)
        .update({ status: 'archived' });
    }

    // Publish
    await trx('schedule_versions').where('id', versionId).update({
      status: 'published',
      effective_at: now,
      published_at: now
    });

    // Update schedule active_version_id
    await trx('schedules').where('id', id).update({
      active_version_id: versionId,
      updated_at: now
    });
  });

  const { actorId, actorUsername, ip } = auditFromCtx(ctx);
  await logAudit(actorId, actorUsername, 'schedule.publish', 'schedule_versions', versionId,
    { status: 'published', publishedAt: now }, ip);

  ctx.body = {
    success: true,
    data: {
      id: parseInt(versionId),
      scheduleId: parseInt(id),
      versionNumber: version.version_number,
      status: 'published',
      effectiveAt: now,
      publishedAt: now,
      publishedBy: ctx.state.user.id
    }
  };
});

/**
 * POST /api/schedules/:id/versions/:versionId/request-approval
 * Submit a draft for approval (host).
 */
router.post('/:id/versions/:versionId/request-approval', requireRole('host', 'platform_ops'), async (ctx) => {
  const { id, versionId } = ctx.params;

  const schedule = await enforceScheduleScope(ctx, id);
  if (!schedule) return;

  const version = await db('schedule_versions').where('id', versionId).where('schedule_id', id).first();
  if (!version) throw createError(404, 'NOT_FOUND', 'Version not found.');
  if (version.status !== 'draft') {
    throw createError(409, 'CONFLICT', 'Only draft versions can be submitted for approval.');
  }

  // Check no pending approval already
  const pendingApproval = await db('approval_requests')
    .where('version_id', versionId)
    .where('status', 'pending')
    .first();
  if (pendingApproval) {
    throw createError(409, 'CONFLICT', 'This version already has a pending approval request.');
  }

  // Enforce pre-publish checklist BEFORE submission — reject invalid drafts early
  const stops = await db('schedule_stops').where('version_id', versionId).orderBy('stop_sequence');
  const seatClasses = await db('seat_classes').where('version_id', versionId);
  const trainset = version.trainset_id
    ? await db('trainsets').where('id', version.trainset_id).first()
    : null;

  let publishedVersions = [];
  if (trainset) {
    publishedVersions = await db('schedule_versions as sv')
      .join('schedules as s', 'sv.schedule_id', 's.id')
      .leftJoin(
        db('schedule_stops').select('version_id')
          .min('departure_at as first_departure')
          .select(db.raw('MAX(COALESCE(arrival_at, departure_at)) as last_arrival'))
          .groupBy('version_id')
          .as('st'),
        'sv.id', 'st.version_id'
      )
      .where('sv.status', 'published')
      .where('sv.trainset_id', trainset.id)
      .select('sv.id', 'sv.schedule_id', 'sv.trainset_id', 'st.first_departure', 'st.last_arrival');
  }

  const validation = validateScheduleForPublish(version, stops, seatClasses, trainset, publishedVersions);
  if (!validation.valid) {
    throw createError(400, 'VALIDATION_FAILED',
      'Cannot submit for approval: pre-publish checklist failed. ' + validation.errors.join('; '));
  }

  const now = new Date();

  // Transactional: update version status + create approval request atomically
  let approvalId;
  await db.transaction(async (trx) => {
    await trx('schedule_versions').where('id', versionId).update({ status: 'pending_approval' });
    [approvalId] = await trx('approval_requests').insert({
      version_id: versionId,
      requested_by: ctx.state.user.id,
      status: 'pending',
      reviewed_by: null,
      review_comment: null,
      requested_at: now,
      reviewed_at: null
    });
  });

  const { actorId, actorUsername, ip } = auditFromCtx(ctx);
  await logAudit(actorId, actorUsername, 'schedule.request_approval', 'approval_requests', approvalId,
    { versionId, status: 'pending' }, ip);

  ctx.body = {
    success: true,
    data: {
      approvalId,
      scheduleId: parseInt(id),
      versionId: parseInt(versionId),
      status: 'pending',
      requestedBy: ctx.state.user.id,
      requestedAt: now
    }
  };
});

/**
 * GET /api/schedules/:id/versions/compare?v1=X&v2=Y
 * Compare two versions and return diff.
 */
router.get('/:id/versions/compare', requireRole('host', 'platform_ops'), async (ctx) => {
  const { id } = ctx.params;
  const { v1, v2 } = ctx.query;

  const schedule = await enforceScheduleScope(ctx, id);
  if (!schedule) return;

  if (!v1 || !v2) throw createError(400, 'VALIDATION_ERROR', 'Both v1 and v2 version IDs are required.');

  const version1 = await db('schedule_versions').where('id', v1).where('schedule_id', id).first();
  const version2 = await db('schedule_versions').where('id', v2).where('schedule_id', id).first();

  if (!version1 || !version2) {
    throw createError(404, 'NOT_FOUND', 'One or both versions not found for this schedule.');
  }

  // Load stops for both
  const stops1 = await db('schedule_stops').where('version_id', v1).orderBy('stop_sequence', 'asc');
  const stops2 = await db('schedule_stops').where('version_id', v2).orderBy('stop_sequence', 'asc');

  // Load seat classes for both
  const classes1 = await db('seat_classes').where('version_id', v1);
  const classes2 = await db('seat_classes').where('version_id', v2);

  const stopDiff = computeStopDiff(stops1, stops2);
  const classDiff = computeClassDiff(classes1, classes2);

  ctx.body = {
    success: true,
    data: {
      scheduleId: parseInt(id),
      v1: { id: version1.id, version_number: version1.version_number, status: version1.status },
      v2: { id: version2.id, version_number: version2.version_number, status: version2.status },
      stops: stopDiff,
      seatClasses: classDiff
    }
  };
});

/**
 * POST /api/schedules/:id/rollback
 * Create a new version cloned from a historical version. Platform Ops only.
 * Body: { sourceVersionId, reason }
 */
router.post('/:id/rollback', requireRole('platform_ops'), async (ctx) => {
  const { id } = ctx.params;
  const { sourceVersionId, reason } = ctx.request.body || {};

  if (!sourceVersionId) throw createError(400, 'VALIDATION_ERROR', 'Source version ID is required.');
  if (!reason || reason.length < 1 || reason.length > 2000) {
    throw createError(400, 'VALIDATION_ERROR', 'Reason is required (1-2000 characters).');
  }

  const schedule = await db('schedules').where('id', id).first();
  if (!schedule) throw createError(404, 'NOT_FOUND', 'Schedule not found.');

  const sourceVersion = await db('schedule_versions')
    .where('id', sourceVersionId)
    .where('schedule_id', id)
    .first();
  if (!sourceVersion) throw createError(404, 'NOT_FOUND', 'Source version not found for this schedule.');

  if (sourceVersion.status !== 'published' && sourceVersion.status !== 'archived') {
    throw createError(409, 'CONFLICT', 'Rollback source must be a previously published version.');
  }

  const now = new Date();

  // Run pre-publish validation on source version before rollback activation
  const sourceStops = await db('schedule_stops').where('version_id', sourceVersionId).orderBy('stop_sequence');
  const sourceSeatClasses = await db('seat_classes').where('version_id', sourceVersionId);
  const trainset = sourceVersion.trainset_id ? await db('trainsets').where('id', sourceVersion.trainset_id).first() : null;

  let publishedVersions = [];
  if (trainset) {
    publishedVersions = await db('schedule_versions as sv')
      .join('schedules as s', 'sv.schedule_id', 's.id')
      .leftJoin(
        db('schedule_stops').select('version_id')
          .min('departure_at as first_departure')
          .select(db.raw('MAX(COALESCE(arrival_at, departure_at)) as last_arrival'))
          .groupBy('version_id')
          .as('st'),
        'sv.id', 'st.version_id'
      )
      .where('sv.status', 'published')
      .where('sv.trainset_id', trainset.id)
      .select('sv.id', 'sv.schedule_id', 'sv.trainset_id', 'st.first_departure', 'st.last_arrival');
  }

  const validation = validateScheduleForPublish(sourceVersion, sourceStops, sourceSeatClasses, trainset, publishedVersions);
  if (!validation.valid) {
    throw createError(400, 'VALIDATION_FAILED', 'Rollback blocked: ' + validation.errors.join('; '));
  }

  // Next version number
  const maxVersion = await db('schedule_versions')
    .where('schedule_id', id)
    .max('version_number as max')
    .first();
  const nextVersion = (maxVersion ? maxVersion.max : 0) + 1;

  let newVersionId;

  await db.transaction(async (trx) => {
    // Archive currently active version
    if (schedule.active_version_id) {
      await trx('schedule_versions')
        .where('id', schedule.active_version_id)
        .update({ status: 'archived' });
    }

    // Clone source version as new PUBLISHED version (rollback = immediate activation)
    [newVersionId] = await trx('schedule_versions').insert({
      schedule_id: id,
      version_number: nextVersion,
      status: 'published',
      trainset_id: sourceVersion.trainset_id,
      effective_at: now,
      published_at: now,
      created_by: ctx.state.user.id,
      created_at: now,
      notes: reason,
      rollback_source_version_id: sourceVersionId
    });

    // Update schedule active version
    await trx('schedules').where('id', id).update({ active_version_id: newVersionId, updated_at: now });

    // Clone stops
    const stops = await trx('schedule_stops').where('version_id', sourceVersionId);
    for (const stop of stops) {
      await trx('schedule_stops').insert({
        version_id: newVersionId,
        station_id: stop.station_id,
        stop_sequence: stop.stop_sequence,
        arrival_at: stop.arrival_at,
        departure_at: stop.departure_at,
        platform: stop.platform
      });
    }

    // Clone seat classes
    const classes = await trx('seat_classes').where('version_id', sourceVersionId);
    for (const sc of classes) {
      await trx('seat_classes').insert({
        version_id: newVersionId,
        class_code: sc.class_code,
        class_name: sc.class_name,
        capacity: sc.capacity,
        fare: sc.fare,
        is_available: sc.is_available
      });
    }
  });

  const { actorId, actorUsername, ip } = auditFromCtx(ctx);
  await logAudit(actorId, actorUsername, 'schedule.rollback', 'schedule_versions', newVersionId,
    { sourceVersionId, reason, previousActiveVersionId: schedule.active_version_id }, ip);

  ctx.body = {
    success: true,
    data: {
      id: newVersionId,
      scheduleId: parseInt(id),
      versionNumber: nextVersion,
      status: 'published',
      effectiveAt: now,
      publishedAt: now,
      rollbackSourceVersionId: sourceVersionId,
      reason,
      createdBy: ctx.state.user.id,
      createdAt: now
    }
  };
});

/**
 * Compute a structured diff of stops between two versions.
 *
 * Stops are matched by stop_sequence (their positional identity within a route),
 * NOT by station_id alone. This correctly handles routes that revisit the same
 * station (e.g., loop routes A→B→C→A where station A appears at sequence 1 and 4).
 */
function computeStopDiff(stops1, stops2) {
  const map1 = {};
  const map2 = {};
  stops1.forEach(s => { map1[s.stop_sequence] = s; });
  stops2.forEach(s => { map2[s.stop_sequence] = s; });

  const result = [];

  // Added stops (sequence in v2 but not v1)
  for (const s of stops2) {
    if (!map1[s.stop_sequence]) {
      result.push({
        key: `stop-seq-${s.stop_sequence}`,
        change: 'added',
        v1: null,
        v2: { sequence: s.stop_sequence, station: s.station_id, departure_at: s.departure_at, arrival_at: s.arrival_at, platform: s.platform }
      });
    }
  }

  // Removed stops (sequence in v1 but not v2)
  for (const s of stops1) {
    if (!map2[s.stop_sequence]) {
      result.push({
        key: `stop-seq-${s.stop_sequence}`,
        change: 'removed',
        v1: { sequence: s.stop_sequence, station: s.station_id, departure_at: s.departure_at, arrival_at: s.arrival_at, platform: s.platform },
        v2: null
      });
    }
  }

  // Modified stops (same sequence in both but with differences)
  for (const s2 of stops2) {
    const s1 = map1[s2.stop_sequence];
    if (!s1) continue;

    const hasChanges = s1.station_id !== s2.station_id ||
                       s1.arrival_at !== s2.arrival_at || s1.departure_at !== s2.departure_at ||
                       s1.platform !== s2.platform;

    if (hasChanges) {
      result.push({
        key: `stop-seq-${s2.stop_sequence}`,
        change: 'changed',
        v1: { sequence: s1.stop_sequence, station: s1.station_id, departure_at: s1.departure_at, arrival_at: s1.arrival_at, platform: s1.platform },
        v2: { sequence: s2.stop_sequence, station: s2.station_id, departure_at: s2.departure_at, arrival_at: s2.arrival_at, platform: s2.platform }
      });
    }
  }

  return result;
}

/**
 * Compute a structured diff of seat classes between two versions.
 */
function computeClassDiff(classes1, classes2) {
  const map1 = {};
  const map2 = {};
  classes1.forEach(c => { map1[c.class_code] = c; });
  classes2.forEach(c => { map2[c.class_code] = c; });

  const result = [];

  // Added classes (in v2 but not v1)
  for (const c of classes2) {
    if (!map1[c.class_code]) {
      result.push({
        key: `class-${c.class_code}`,
        change: 'added',
        v1: null,
        v2: { class_code: c.class_code, capacity: c.capacity, fare: parseFloat(c.fare) }
      });
    }
  }

  // Removed classes (in v1 but not v2)
  for (const c of classes1) {
    if (!map2[c.class_code]) {
      result.push({
        key: `class-${c.class_code}`,
        change: 'removed',
        v1: { class_code: c.class_code, capacity: c.capacity, fare: parseFloat(c.fare) },
        v2: null
      });
    }
  }

  // Modified classes (in both but with differences)
  for (const c2 of classes2) {
    const c1 = map1[c2.class_code];
    if (!c1) continue;

    const hasChanges = c1.class_name !== c2.class_name || c1.capacity !== c2.capacity ||
                       parseFloat(c1.fare) !== parseFloat(c2.fare) || c1.is_available !== c2.is_available;

    if (hasChanges) {
      result.push({
        key: `class-${c2.class_code}`,
        change: 'changed',
        v1: { class_code: c1.class_code, capacity: c1.capacity, fare: parseFloat(c1.fare) },
        v2: { class_code: c2.class_code, capacity: c2.capacity, fare: parseFloat(c2.fare) }
      });
    }
  }

  return result;
}

module.exports = router;
// Exported for unit testing only
module.exports._computeStopDiff = computeStopDiff;
module.exports._computeClassDiff = computeClassDiff;
