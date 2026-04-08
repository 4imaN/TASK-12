const db = require('../database/connection');
const log = require('../utils/logger');

let dailyTimer = null;

async function runDailyReport() {
  log.info('dq', 'Running daily data quality report');
  try {
    const today = new Date().toISOString().split('T')[0];

    // Check if report already exists for today
    const existing = await db('data_quality_reports').where('report_date', today).first();
    if (existing) {
      log.info('dq', 'Report for today already exists — skipping', { date: today });
      return;
    }

    const checks = [];

    // Completeness: schedules with active version must have stops
    const activeSchedules = await db('schedules').whereNotNull('active_version_id');
    let completeCount = 0;
    for (const s of activeSchedules) {
      const stopCount = await db('schedule_stops').where('version_id', s.active_version_id).count('id as c').first();
      if (parseInt(stopCount.c) > 0) completeCount++;
      else {
        const existing = await db('data_quality_issues')
          .where({ entity_type: 'schedule', entity_id: s.id, check_type: 'completeness' })
          .whereIn('status', ['open', 'in_progress'])
          .first();
        if (!existing) {
          await db('data_quality_issues').insert({
            entity_type: 'schedule', entity_id: s.id, check_type: 'completeness',
            severity: 'high', description: `Schedule ${s.route_name || s.id} has no stops`, status: 'open',
            owner: 'platform_ops',
            due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          }).catch(() => {});
        }
      }
    }
    checks.push({ name: 'schedule_completeness', total: activeSchedules.length, passed: completeCount, failed: activeSchedules.length - completeCount });

    // Uniqueness: duplicate SKUs
    const dupSkus = await db('inventory_items').select('sku').groupBy('sku').having(db.raw('COUNT(*) > 1'));
    checks.push({ name: 'sku_uniqueness', total: 1, passed: dupSkus.length === 0 ? 1 : 0, failed: dupSkus.length > 0 ? 1 : 0 });

    // Freshness: items not updated in 90 days
    const staleDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const staleItems = await db('inventory_items').where('updated_at', '<', staleDate).count('id as c').first();
    checks.push({ name: 'item_freshness', total: 1, passed: parseInt(staleItems.c) === 0 ? 1 : 0, failed: parseInt(staleItems.c) > 0 ? 1 : 0 });

    const totalChecks = checks.reduce((s, c) => s + c.total, 0);
    const passedChecks = checks.reduce((s, c) => s + c.passed, 0);
    const failedChecks = checks.reduce((s, c) => s + c.failed, 0);

    await db('data_quality_reports').insert({
      report_date: today,
      total_checks: totalChecks,
      passed_checks: passedChecks,
      failed_checks: failedChecks,
      issues_found: failedChecks,
      report_data: JSON.stringify({ checks, generatedBy: 'scheduler' })
    });

    log.info('dq', 'Report complete', { passed: passedChecks, total: totalChecks, failed: failedChecks });
  } catch (err) {
    log.error('dq', 'Report failed', { error: err.message });
  }
}

function startDQScheduler() {
  // Run immediately on startup (after 10 second delay for DB readiness)
  setTimeout(runDailyReport, 10000);

  // Then run every 24 hours
  dailyTimer = setInterval(runDailyReport, 24 * 60 * 60 * 1000);
  log.info('dq', 'Daily data quality scheduler started');
}

function stopDQScheduler() {
  if (dailyTimer) { clearInterval(dailyTimer); dailyTimer = null; }
}

module.exports = { startDQScheduler, stopDQScheduler, runDailyReport };
