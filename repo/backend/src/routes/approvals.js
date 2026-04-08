const Router = require('koa-router');
const db = require('../database/connection');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { logAudit, auditFromCtx } = require('../services/auditService');
const { validateScheduleForPublish } = require('../utils/validators');

const router = new Router({ prefix: '/api/approvals' });

router.use(authenticate(), requireRole('platform_ops'));

/**
 * GET /api/approvals
 * List approval requests with schedule/version info.
 */
router.get('/', async (ctx) => {
  const { status = 'pending' } = ctx.query;

  let query = db('approval_requests as ar')
    .join('schedule_versions as sv', 'ar.version_id', 'sv.id')
    .join('schedules as s', 'sv.schedule_id', 's.id')
    .leftJoin('users as req_user', 'ar.requested_by', 'req_user.id')
    .leftJoin('users as rev_user', 'ar.reviewed_by', 'rev_user.id')
    .select(
      'ar.id', 'ar.version_id', 'ar.requested_by', 'ar.status',
      'ar.reviewed_by', 'ar.review_comment', 'ar.requested_at', 'ar.reviewed_at',
      'sv.version_number', 'sv.schedule_id', 'sv.status as version_status',
      's.route_name', 's.station_id',
      'req_user.display_name as requested_by_name',
      'rev_user.display_name as reviewed_by_name'
    );

  if (status !== 'all') {
    query = query.where('ar.status', status);
  }

  const approvals = await query.orderBy('ar.requested_at', 'desc');

  ctx.body = {
    success: true,
    data: approvals.map(a => ({
      id: a.id,
      version_id: a.version_id,
      schedule_id: a.schedule_id,
      schedule_name: a.route_name,
      station_id: a.station_id,
      version_number: a.version_number,
      version_status: a.version_status,
      status: a.status,
      requested_by: a.requested_by,
      requested_by_name: a.requested_by_name || null,
      requested_at: a.requested_at,
      reviewed_by: a.reviewed_by,
      reviewed_by_name: a.reviewed_by_name || null,
      review_comment: a.review_comment,
      reviewed_at: a.reviewed_at
    }))
  };
});

/**
 * POST /api/approvals/:id/approve
 * Approve a pending approval request.
 * Updates version status to published, sets effective_at, updates schedule.active_version_id.
 */
router.post('/:id/approve', async (ctx) => {
  const { id } = ctx.params;
  const { reviewComment } = ctx.request.body || {};

  const approval = await db('approval_requests').where('id', id).first();
  if (!approval) throw createError(404, 'NOT_FOUND', 'Approval request not found.');
  if (approval.status !== 'pending') {
    throw createError(409, 'CONFLICT', 'This approval request is not in pending status.');
  }

  // Cannot approve own submission
  if (approval.requested_by === ctx.state.user.id) {
    throw createError(403, 'FORBIDDEN', 'You cannot approve your own submission.');
  }

  // Get version and schedule for validation before any state changes
  const version = await db('schedule_versions').where('id', approval.version_id).first();
  const schedule = await db('schedules').where('id', version.schedule_id).first();

  // Run pre-publish checklist validation before approving
  const stops = await db('schedule_stops').where('version_id', approval.version_id).orderBy('stop_sequence');
  const seatClasses = await db('seat_classes').where('version_id', approval.version_id);
  const trainset = version.trainset_id
    ? await db('trainsets').where('id', version.trainset_id).first()
    : null;

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
    throw createError(400, 'VALIDATION_FAILED',
      'Cannot approve: pre-publish checklist failed. ' + validation.errors.join('; '));
  }

  const now = new Date();

  await db.transaction(async (trx) => {
    // Update approval request
    await trx('approval_requests').where('id', id).update({
      status: 'approved',
      reviewed_by: ctx.state.user.id,
      review_comment: reviewComment || null,
      reviewed_at: now
    });

    // Archive currently active version if different
    if (schedule.active_version_id && schedule.active_version_id !== approval.version_id) {
      await trx('schedule_versions')
        .where('id', schedule.active_version_id)
        .update({ status: 'archived' });
    }

    // Publish the approved version
    await trx('schedule_versions').where('id', approval.version_id).update({
      status: 'published',
      effective_at: now,
      published_at: now
    });

    // Update schedule active_version_id
    await trx('schedules').where('id', version.schedule_id).update({
      active_version_id: approval.version_id,
      updated_at: now
    });
  });

  const { actorId, actorUsername, ip } = auditFromCtx(ctx);
  await logAudit(actorId, actorUsername, 'approval.approve', 'approval_requests', id,
    { versionId: approval.version_id, reviewComment }, ip);
  await logAudit(actorId, actorUsername, 'schedule.publish', 'schedule_versions', approval.version_id,
    { status: 'published', publishedAt: now }, ip);

  ctx.body = {
    success: true,
    data: {
      id: parseInt(id),
      status: 'approved',
      versionId: approval.version_id,
      reviewedBy: ctx.state.user.id,
      reviewedAt: now,
      reviewComment: reviewComment || null
    }
  };
});

/**
 * POST /api/approvals/:id/reject
 * Reject a pending approval request. Requires a comment.
 * Updates version status back to draft.
 */
router.post('/:id/reject', async (ctx) => {
  const { id } = ctx.params;
  const { reviewComment } = ctx.request.body || {};

  if (!reviewComment || reviewComment.length < 1 || reviewComment.length > 2000) {
    throw createError(400, 'VALIDATION_ERROR', 'A rejection comment is required (1-2000 characters).');
  }

  const approval = await db('approval_requests').where('id', id).first();
  if (!approval) throw createError(404, 'NOT_FOUND', 'Approval request not found.');
  if (approval.status !== 'pending') {
    throw createError(409, 'CONFLICT', 'This approval request is not in pending status.');
  }

  const now = new Date();

  await db.transaction(async (trx) => {
    // Update approval request
    await trx('approval_requests').where('id', id).update({
      status: 'rejected',
      reviewed_by: ctx.state.user.id,
      review_comment: reviewComment,
      reviewed_at: now
    });

    // Revert version status to draft
    await trx('schedule_versions').where('id', approval.version_id).update({
      status: 'draft'
    });
  });

  const { actorId, actorUsername, ip } = auditFromCtx(ctx);
  await logAudit(actorId, actorUsername, 'approval.reject', 'approval_requests', id,
    { versionId: approval.version_id, reviewComment }, ip);

  ctx.body = {
    success: true,
    data: {
      id: parseInt(id),
      status: 'rejected',
      versionId: approval.version_id,
      reviewedBy: ctx.state.user.id,
      reviewedAt: now,
      reviewComment
    }
  };
});

module.exports = router;
