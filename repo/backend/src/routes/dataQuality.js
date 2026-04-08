const Router = require('koa-router');
const db = require('../database/connection');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { logAudit } = require('../services/auditService');
const { validateScheduleForPublish } = require('../utils/validators');

const router = new Router({ prefix: '/api/data-quality' });

router.use(authenticate(), requireRole('platform_ops'));

// ─── ISSUES ──────────────────────────────────────────────────

/**
 * GET /api/data-quality/issues
 * List data quality issues. Filterable by severity, status, owner.
 */
router.get('/issues', async (ctx) => {
  const { page = 1, pageSize = 25, severity, status, owner } = ctx.query;
  const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  let query = db('data_quality_issues');
  let countQuery = db('data_quality_issues');

  if (severity) {
    query = query.where('severity', severity);
    countQuery = countQuery.where('severity', severity);
  }
  if (status) {
    query = query.where('status', status);
    countQuery = countQuery.where('status', status);
  }
  if (owner) {
    query = query.where('owner', owner);
    countQuery = countQuery.where('owner', owner);
  }

  const totalResult = await countQuery.count('id as count').first();
  const total = totalResult ? totalResult.count : 0;

  const issues = await query.orderBy('id', 'desc').limit(limit).offset(offset);

  ctx.body = {
    success: true,
    data: {
      results: issues.map(i => ({
        id: i.id,
        entity_type: i.entity_type,
        entity_id: i.entity_id,
        check_type: i.check_type,
        severity: i.severity,
        description: i.description,
        owner: i.owner,
        due_date: i.due_date,
        status: i.status,
        corrective_notes: i.corrective_notes
      })),
      total,
      page: parseInt(page, 10) || 1,
      pageSize: limit
    }
  };
});

/**
 * POST /api/data-quality/issues
 * Create a data quality issue.
 */
router.post('/issues', async (ctx) => {
  const {
    entity_type, entity_id, check_type, severity,
    description, owner, due_date
  } = ctx.request.body || {};

  if (!description || description.trim().length === 0) {
    throw createError(400, 'VALIDATION_ERROR', 'description is required.');
  }
  if (!severity) {
    throw createError(400, 'VALIDATION_ERROR', 'severity is required.');
  }
  if (!check_type) {
    throw createError(400, 'VALIDATION_ERROR', 'check_type is required.');
  }

  // DQ governance: enforce owner and due_date defaults
  const resolvedOwner = owner || 'platform_ops';
  const resolvedDueDate = due_date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [issueId] = await db('data_quality_issues').insert({
    entity_type: entity_type || null,
    entity_id: entity_id || null,
    check_type,
    severity,
    description: description.trim(),
    owner: resolvedOwner,
    due_date: resolvedDueDate,
    status: 'open',
    corrective_notes: null
  });

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'data_quality.create_issue',
    'data_quality_issues',
    issueId,
    { severity, check_type, description: description.trim() },
    ctx.ip
  );

  const created = await db('data_quality_issues').where('id', issueId).first();

  ctx.status = 201;
  ctx.body = {
    success: true,
    data: {
      id: created.id,
      entity_type: created.entity_type,
      entity_id: created.entity_id,
      check_type: created.check_type,
      severity: created.severity,
      description: created.description,
      owner: created.owner,
      due_date: created.due_date,
      status: created.status,
      corrective_notes: created.corrective_notes
    }
  };
});

/**
 * PATCH /api/data-quality/issues/:id
 * Update a data quality issue (status, corrective_notes).
 */
router.patch('/issues/:id', async (ctx) => {
  const { id } = ctx.params;
  const { status, corrective_notes } = ctx.request.body || {};

  const issue = await db('data_quality_issues').where('id', id).first();
  if (!issue) throw createError(404, 'NOT_FOUND', 'Data quality issue not found.');

  const updates = {};

  if (status !== undefined) {
    if (!['open', 'in_progress', 'resolved', 'dismissed'].includes(status)) {
      throw createError(400, 'VALIDATION_ERROR', 'status must be open, in_progress, resolved, or dismissed.');
    }
    updates.status = status;
  }

  if (corrective_notes !== undefined) {
    updates.corrective_notes = corrective_notes;
  }

  if (Object.keys(updates).length === 0) {
    throw createError(400, 'VALIDATION_ERROR', 'No valid fields to update.');
  }

  await db('data_quality_issues').where('id', id).update(updates);

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'data_quality.update_issue',
    'data_quality_issues',
    parseInt(id),
    { old_status: issue.status, ...updates },
    ctx.ip
  );

  const updated = await db('data_quality_issues').where('id', id).first();

  ctx.body = {
    success: true,
    data: {
      id: updated.id,
      entity_type: updated.entity_type,
      entity_id: updated.entity_id,
      check_type: updated.check_type,
      severity: updated.severity,
      description: updated.description,
      owner: updated.owner,
      due_date: updated.due_date,
      status: updated.status,
      corrective_notes: updated.corrective_notes
    }
  };
});

// ─── REPORTS ─────────────────────────────────────────────────

/**
 * GET /api/data-quality/reports
 * List data quality reports.
 */
router.get('/reports', async (ctx) => {
  const { page = 1, pageSize = 25 } = ctx.query;
  const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  const totalResult = await db('data_quality_reports').count('id as count').first();
  const total = totalResult ? totalResult.count : 0;

  const reports = await db('data_quality_reports')
    .orderBy('report_date', 'desc')
    .limit(limit).offset(offset);

  ctx.body = {
    success: true,
    data: {
      results: reports.map(r => ({
        id: r.id,
        report_date: r.report_date,
        total_checks: r.total_checks,
        passed_checks: r.passed_checks,
        failed_checks: r.failed_checks,
        issues_found: r.issues_found,
        report_data: r.report_data ? (typeof r.report_data === 'string' ? JSON.parse(r.report_data) : r.report_data) : null
      })),
      total,
      page: parseInt(page, 10) || 1,
      pageSize: limit
    }
  };
});

/**
 * GET /api/data-quality/reports/:id
 * Get a single data quality report.
 */
router.get('/reports/:id', async (ctx) => {
  const { id } = ctx.params;

  const report = await db('data_quality_reports').where('id', id).first();
  if (!report) throw createError(404, 'NOT_FOUND', 'Data quality report not found.');

  ctx.body = {
    success: true,
    data: {
      id: report.id,
      report_date: report.report_date,
      total_checks: report.total_checks,
      passed_checks: report.passed_checks,
      failed_checks: report.failed_checks,
      issues_found: report.issues_found,
      report_data: report.report_data ? (typeof report.report_data === 'string' ? JSON.parse(report.report_data) : report.report_data) : null
    }
  };
});

/**
 * POST /api/data-quality/reports/generate
 * Generate a quality report: check schedule completeness, inventory balance accuracy,
 * data freshness.
 */
router.post('/reports/generate', async (ctx) => {
  const now = new Date();
  const reportDate = now.toISOString().split('T')[0];
  const checks = [];
  const newIssues = [];

  // ─── Check 1: Schedule completeness (uses shared validateScheduleForPublish) ───
  // Run the same validation that publish/approve uses, ensuring consistent rules.
  const schedules = await db('schedules')
    .whereNotNull('active_version_id')
    .select('id', 'route_name', 'active_version_id');
  let scheduleCheckPassed = 0;
  let scheduleCheckFailed = 0;

  for (const schedule of schedules) {
    const version = await db('schedule_versions').where('id', schedule.active_version_id).first();
    const stops = await db('schedule_stops').where('version_id', schedule.active_version_id);
    const seatClasses = await db('seat_classes').where('version_id', schedule.active_version_id);
    const trainset = version && version.trainset_id
      ? await db('trainsets').where('id', version.trainset_id).first()
      : null;

    const validation = validateScheduleForPublish(version, stops, seatClasses, trainset, []);
    if (validation.valid) {
      scheduleCheckPassed++;
    } else {
      scheduleCheckFailed++;
      newIssues.push({
        entity_type: 'schedules',
        entity_id: schedule.id,
        check_type: 'completeness',
        severity: 'medium',
        description: `Schedule "${schedule.route_name}" failed publish validation: ${validation.errors.join('; ')}`,
        status: 'open',
        owner: 'platform_ops',
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      });
    }
  }

  checks.push({
    name: 'schedule_completeness',
    total: schedules.length,
    passed: scheduleCheckPassed,
    failed: scheduleCheckFailed
  });

  // ─── Check 2: Inventory balance accuracy ──────────────────
  // Compare ledger (sum of movements) vs cached balance
  const items = await db('inventory_items').select('id', 'sku', 'station_id');
  let balanceCheckPassed = 0;
  let balanceCheckFailed = 0;

  for (const item of items) {
    // Compute expected balance from movements
    const inSum = await db('inventory_movements')
      .where('item_id', item.id)
      .where('direction', 'in')
      .sum('quantity as total')
      .first();
    const outSum = await db('inventory_movements')
      .where('item_id', item.id)
      .where('direction', 'out')
      .sum('quantity as total')
      .first();

    const ledgerBalance = (inSum ? (inSum.total || 0) : 0) - (outSum ? (outSum.total || 0) : 0);

    const balance = await db('inventory_balances')
      .where('item_id', item.id)
      .where('station_id', item.station_id)
      .first();
    const cachedBalance = balance ? balance.on_hand : 0;

    if (ledgerBalance === cachedBalance) {
      balanceCheckPassed++;
    } else {
      balanceCheckFailed++;
      newIssues.push({
        entity_type: 'inventory_items',
        entity_id: item.id,
        check_type: 'accuracy',
        severity: 'high',
        description: `Item ${item.sku} balance mismatch: cached=${cachedBalance}, ledger=${ledgerBalance}.`,
        status: 'open',
        owner: 'platform_ops',
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      });
    }
  }

  checks.push({
    name: 'inventory_balance_accuracy',
    total: items.length,
    passed: balanceCheckPassed,
    failed: balanceCheckFailed
  });

  // ─── Check 3: Data freshness ──────────────────────────────
  // Check if inventory balances have been updated recently (within 30 days)
  const staleThreshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const staleBalances = await db('inventory_balances')
    .where('updated_at', '<', staleThreshold)
    .count('id as count')
    .first();
  const totalBalances = await db('inventory_balances').count('id as count').first();
  const staleCount = staleBalances ? staleBalances.count : 0;
  const totalBalanceCount = totalBalances ? totalBalances.count : 0;
  const freshCount = totalBalanceCount - staleCount;

  checks.push({
    name: 'data_freshness',
    total: totalBalanceCount,
    passed: freshCount,
    failed: staleCount
  });

  if (staleCount > 0) {
    newIssues.push({
      entity_type: 'inventory_balances',
      entity_id: null,
      check_type: 'freshness',
      severity: 'low',
      description: `${staleCount} inventory balance(s) have not been updated in 30+ days.`,
      status: 'open',
      owner: 'platform_ops',
      due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    });
  }

  // ─── Check 4: Uniqueness — duplicate SKUs ─────────────────
  const dupSkus = await db('inventory_items')
    .select('sku')
    .groupBy('sku')
    .having(db.raw('COUNT(*) > 1'));
  let skuCheckFailed = 0;
  for (const dup of dupSkus) {
    skuCheckFailed++;
    newIssues.push({
      entity_type: 'inventory_item',
      check_type: 'uniqueness',
      severity: 'high',
      description: `Duplicate SKU found: ${dup.sku}`,
      status: 'open',
      owner: 'platform_ops',
      due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    });
  }

  // ─── Check 5: Uniqueness — duplicate station codes ───────
  const dupStations = await db('stations')
    .select('code')
    .groupBy('code')
    .having(db.raw('COUNT(*) > 1'));
  let stationCheckFailed = 0;
  for (const dup of dupStations) {
    stationCheckFailed++;
    newIssues.push({
      entity_type: 'station',
      check_type: 'uniqueness',
      severity: 'high',
      description: `Duplicate station code: ${dup.code}`,
      status: 'open',
      owner: 'platform_ops',
      due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    });
  }

  checks.push({
    name: 'sku_uniqueness',
    total: 1,
    passed: dupSkus.length === 0 ? 1 : 0,
    failed: dupSkus.length === 0 ? 0 : 1
  });
  checks.push({
    name: 'station_code_uniqueness',
    total: 1,
    passed: dupStations.length === 0 ? 1 : 0,
    failed: dupStations.length === 0 ? 0 : 1
  });

  // ─── Summarize ────────────────────────────────────────────
  const totalChecks = checks.reduce((sum, c) => sum + c.total, 0);
  const passedChecks = checks.reduce((sum, c) => sum + c.passed, 0);
  const failedChecks = checks.reduce((sum, c) => sum + c.failed, 0);

  // Insert new issues (dedup: skip if a matching open/in_progress issue already exists)
  for (const issue of newIssues) {
    const existing = await db('data_quality_issues')
      .where({ entity_type: issue.entity_type, entity_id: issue.entity_id, check_type: issue.check_type })
      .whereIn('status', ['open', 'in_progress'])
      .first();
    if (!existing) {
      await db('data_quality_issues').insert(issue).catch(() => {});
    }
  }

  // Insert report (report_date is UNIQUE, use insert-or-update)
  const reportData = { checks, generated_at: now.toISOString() };

  const existingReport = await db('data_quality_reports').where('report_date', reportDate).first();
  let reportId;

  if (existingReport) {
    await db('data_quality_reports').where('id', existingReport.id).update({
      total_checks: totalChecks,
      passed_checks: passedChecks,
      failed_checks: failedChecks,
      issues_found: newIssues.length,
      report_data: JSON.stringify(reportData)
    });
    reportId = existingReport.id;
  } else {
    [reportId] = await db('data_quality_reports').insert({
      report_date: reportDate,
      total_checks: totalChecks,
      passed_checks: passedChecks,
      failed_checks: failedChecks,
      issues_found: newIssues.length,
      report_data: JSON.stringify(reportData)
    });
  }

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'data_quality.generate_report',
    'data_quality_reports',
    reportId,
    { total_checks: totalChecks, passed_checks: passedChecks, failed_checks: failedChecks, issues_found: newIssues.length },
    ctx.ip
  );

  ctx.status = 201;
  ctx.body = {
    success: true,
    data: {
      id: reportId,
      report_date: reportDate,
      total_checks: totalChecks,
      passed_checks: passedChecks,
      failed_checks: failedChecks,
      issues_found: newIssues.length,
      report_data: reportData
    }
  };
});

module.exports = router;
