const Router = require('koa-router');
const { execFile } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('../database/connection');
const { authenticate, requireRole } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { logAudit } = require('../services/auditService');
const { validateBackupPath, validateFilePath } = require('../utils/backupPath');

const router = new Router({ prefix: '/api' });

// "incremental" backup type = binlog event segment capture.
// Each incremental captures actual binlog events between two positions,
// recording binlog_file_start/pos_start/file_end/pos_end and parent_backup_id,
// forming a deterministic chain: full -> incremental_1 -> incremental_2 -> ...
// Restore drills replay this chain in order (full first, then incrementals by position).

router.use(authenticate(), requireRole('platform_ops'));

// ─── BACKUPS ─────────────────────────────────────────────────

/**
 * GET /api/backups
 * List backup records.
 */
router.get('/backups', async (ctx) => {
  const { page = 1, pageSize = 25, status, backup_type } = ctx.query;
  const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  let query = db('backups');
  let countQuery = db('backups');

  if (status) {
    query = query.where('status', status);
    countQuery = countQuery.where('status', status);
  }
  if (backup_type) {
    query = query.where('backup_type', backup_type);
    countQuery = countQuery.where('backup_type', backup_type);
  }

  const totalResult = await countQuery.count('id as count').first();
  const total = totalResult ? totalResult.count : 0;

  const backups = await query.orderBy('started_at', 'desc').limit(limit).offset(offset);

  ctx.body = {
    success: true,
    data: {
      results: backups.map(b => ({
        id: b.id,
        backup_type: b.backup_type,
        file_path: b.file_path,
        file_size: b.file_size,
        checksum: b.checksum,
        binlog_file_start: b.binlog_file_start || null,
        binlog_pos_start: b.binlog_pos_start || null,
        binlog_file_end: b.binlog_file_end || null,
        binlog_pos_end: b.binlog_pos_end || null,
        parent_backup_id: b.parent_backup_id || null,
        status: b.status,
        started_at: b.started_at,
        completed_at: b.completed_at,
        error_message: b.error_message
      })),
      total,
      page: parseInt(page, 10) || 1,
      pageSize: limit
    }
  };
});

/**
 * POST /api/backups/run
 * Trigger a backup. Insert record with status=running, run mysqldump asynchronously,
 * update record on completion.
 *
 * "incremental" = binlog event segment capture. Each incremental captures actual binlog
 * events between two positions, recording binlog start/end positions and parent_backup_id,
 * forming a deterministic chain. Restore drills replay: full backup first, then each
 * incremental in position order.
 */
router.post('/backups/run', async (ctx) => {
  const { backup_type } = ctx.request.body || {};
  const type = backup_type || 'full';

  if (!['full', 'incremental'].includes(type)) {
    throw createError(400, 'VALIDATION_ERROR', 'backup_type must be full or incremental.');
  }

  // Check no backup is currently running
  const running = await db('backups').where('status', 'running').first();
  if (running) {
    throw createError(409, 'CONFLICT', 'A backup is already in progress.');
  }

  // Get backup path from config or environment — validate against allowlist
  const config = await db('backup_config').first();
  const rawPath = (config && config.backup_path) || process.env.BACKUP_PATH || '/backups';
  const pathCheck = validateBackupPath(rawPath);
  if (!pathCheck.valid) {
    throw createError(400, 'VALIDATION_ERROR', `Backup path rejected: ${pathCheck.error}`);
  }
  const backupPath = pathCheck.resolved;

  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T.Z]/g, '').substring(0, 14);
  const fileName = `railops_${type}_${timestamp}.sql.gz`;
  const filePath = validateFilePath(path.join(backupPath, fileName), backupPath);

  // Create backup record with status=running
  const [backupId] = await db('backups').insert({
    backup_type: type,
    file_path: filePath,
    status: 'running',
    started_at: now
  });

  // Run backup asynchronously
  setImmediate(async () => {
    try {
      const dbHost = process.env.DB_HOST || 'localhost';
      const dbUser = process.env.DB_USER || 'root';
      const dbPass = process.env.DB_PASSWORD || '';
      const dbName = process.env.DB_NAME || 'railops';

      // Ensure backup directory exists
      if (!fs.existsSync(backupPath)) {
        fs.mkdirSync(backupPath, { recursive: true });
      }

      // Capture binlog start position before backup
      let binlogFileStart = null;
      let binlogPosStart = null;
      let binlogAvailable = false;

      try {
        const masterStatusBefore = await db.raw('SHOW MASTER STATUS');
        const rowsBefore = masterStatusBefore[0] || masterStatusBefore;
        if (rowsBefore && rowsBefore.length > 0 && rowsBefore[0].File) {
          binlogAvailable = true;
          binlogFileStart = rowsBefore[0].File;
          binlogPosStart = rowsBefore[0].Position;
        }
      } catch (_) {
        binlogAvailable = false;
      }

      // Check binlog availability BEFORE starting incremental
      if (type === 'incremental' && !binlogAvailable) {
        console.error('[BACKUP] FAILED: Binlog not available. Cannot produce a valid incremental backup.');
        await db('backups').where('id', backupId).update({
          status: 'failed',
          completed_at: new Date(),
          error_message: 'Binlog not available. Enable binary logging in MySQL for incremental backups.'
        });
        return;
      }

      if (type === 'incremental') {
        // ── True binlog event segment capture ──────────────────────
        // Find last backup's end position
        const lastBackup = await db('backups')
          .whereIn('status', ['completed'])
          .orderBy('completed_at', 'desc')
          .first();

        const startFile = lastBackup?.binlog_file_end || binlogFileStart;
        const startPos = lastBackup?.binlog_pos_end || binlogPosStart;

        // Capture binlog events since last position
        let events = [];
        try {
          const [rows] = await db.raw('SHOW BINLOG EVENTS IN ? FROM ? LIMIT 50000', [startFile, startPos]);
          events = rows || [];
        } catch (err) {
          // Binlog access failed
          await db('backups').where('id', backupId).update({
            status: 'failed', completed_at: new Date(),
            error_message: 'Failed to capture binlog events: ' + err.message
          });
          return;
        }

        // Write events to file
        const binlogFilePath = validateFilePath(path.join(backupPath, `railops_binlog_${backupId}_${Date.now()}.json`), backupPath);
        fs.writeFileSync(binlogFilePath, JSON.stringify({
          type: 'binlog_segment',
          start_file: startFile,
          start_pos: startPos,
          end_file: binlogFileStart,  // current position at backup start
          end_pos: binlogPosStart,
          event_count: events.length,
          events: events.map(e => ({
            log_name: e.Log_name,
            pos: e.Pos,
            event_type: e.Event_type,
            server_id: e.Server_id,
            end_log_pos: e.End_log_pos,
            info: e.Info
          }))
        }, null, 2));

        const fileSize = fs.statSync(binlogFilePath).size;
        const checksum = crypto.createHash('sha256').update(fs.readFileSync(binlogFilePath)).digest('hex');

        // Get end position
        const [endRows] = await db.raw('SHOW MASTER STATUS');
        const endStatus = endRows?.[0];

        await db('backups').where('id', backupId).update({
          status: 'completed',
          file_path: binlogFilePath,
          file_size: fileSize,
          checksum: checksum,
          binlog_file_start: startFile,
          binlog_pos_start: startPos,
          binlog_file_end: endStatus?.File || startFile,
          binlog_pos_end: endStatus?.Position || startPos,
          parent_backup_id: lastBackup?.backup_type === 'full' ? lastBackup.id : lastBackup?.parent_backup_id,
          completed_at: new Date()
        });
      } else {
        // ── Full backup via mysqldump ──────────────────────────────
        await new Promise((resolve, reject) => {
          const args = ['--single-transaction'];

          // Always include routines and triggers for complete backups
          args.push('--routines', '--triggers');

          args.push('-h', dbHost, '-u', dbUser);
          if (dbPass) args.push(`-p${dbPass}`);
          args.push(dbName);

          const dump = require('child_process').spawn('mysqldump', args);
          const gzip = require('child_process').spawn('gzip');
          const output = fs.createWriteStream(filePath);

          dump.stdout.pipe(gzip.stdin);
          gzip.stdout.pipe(output);

          let dumpErr = '';
          dump.stderr.on('data', (chunk) => { dumpErr += chunk; });

          output.on('finish', resolve);
          dump.on('error', reject);
          gzip.on('error', reject);
          output.on('error', reject);
          dump.on('close', (code) => {
            if (code !== 0) reject(new Error(`mysqldump exited with code ${code}: ${dumpErr}`));
          });
        });

        // Capture binlog end position after backup
        let binlogFileEnd = null;
        let binlogPosEnd = null;
        try {
          const masterStatusAfter = await db.raw('SHOW MASTER STATUS');
          const rowsAfter = masterStatusAfter[0] || masterStatusAfter;
          if (rowsAfter && rowsAfter.length > 0 && rowsAfter[0].File) {
            binlogFileEnd = rowsAfter[0].File;
            binlogPosEnd = rowsAfter[0].Position;
          }
        } catch (_) {
          // binlog end position unavailable
        }

        // Calculate checksum and file size
        let checksum = null;
        let fileSize = null;
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          fileSize = stats.size;
          const hash = crypto.createHash('sha256');
          const stream = fs.createReadStream(filePath);
          await new Promise((resolve, reject) => {
            stream.on('data', (chunk) => hash.update(chunk));
            stream.on('end', resolve);
            stream.on('error', reject);
          });
          checksum = hash.digest('hex');
        }

        await db('backups').where('id', backupId).update({
          status: 'completed',
          completed_at: new Date(),
          checksum,
          file_size: fileSize,
          binlog_file_start: binlogFileStart,
          binlog_pos_start: binlogPosStart,
          binlog_file_end: binlogFileEnd,
          binlog_pos_end: binlogPosEnd
        });
      }
    } catch (err) {
      await db('backups').where('id', backupId).update({
        status: 'failed',
        completed_at: new Date(),
        error_message: err.message
      });
    }
  });

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'backup.run',
    'backups',
    backupId,
    { backup_type: type, file_path: filePath },
    ctx.ip
  );

  ctx.status = 202;
  ctx.body = {
    success: true,
    data: {
      id: backupId,
      backup_type: type,
      file_path: filePath,
      status: 'running',
      started_at: now
    }
  };
});

/**
 * GET /api/backups/config
 * Get backup configuration.
 */
router.get('/backups/config', async (ctx) => {
  const config = await db('backup_config').first();

  ctx.body = {
    success: true,
    data: config ? {
      id: config.id,
      backup_path: config.backup_path,
      full_schedule: config.full_schedule,
      incremental_interval_min: config.incremental_interval_min,
      retention_days: config.retention_days
    } : null
  };
});

/**
 * PATCH /api/backups/config
 * Update backup configuration.
 */
router.patch('/backups/config', async (ctx) => {
  const { backup_path, full_schedule, incremental_interval_min, retention_days } = ctx.request.body || {};

  const updates = {};

  if (backup_path !== undefined) {
    // Validate against allowlisted roots — prevents path traversal/escape
    const pathCheck = validateBackupPath(backup_path);
    if (!pathCheck.valid) {
      throw createError(400, 'VALIDATION_ERROR', `Backup path rejected: ${pathCheck.error}`);
    }
    // Verify path is writable
    try {
      if (!fs.existsSync(pathCheck.resolved)) {
        fs.mkdirSync(pathCheck.resolved, { recursive: true });
      }
      const testFile = path.join(pathCheck.resolved, '.write_test_' + Date.now());
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
    } catch (err) {
      throw createError(400, 'VALIDATION_ERROR', `Path "${pathCheck.resolved}" is not writable: ${err.message}`);
    }
    updates.backup_path = pathCheck.resolved;
  }

  if (full_schedule !== undefined) {
    updates.full_schedule = full_schedule;
  }

  if (incremental_interval_min !== undefined) {
    if (!Number.isInteger(incremental_interval_min) || incremental_interval_min < 1) {
      throw createError(400, 'VALIDATION_ERROR', 'incremental_interval_min must be a positive integer.');
    }
    updates.incremental_interval_min = incremental_interval_min;
  }

  if (retention_days !== undefined) {
    if (!Number.isInteger(retention_days) || retention_days < 1 || retention_days > 365) {
      throw createError(400, 'VALIDATION_ERROR', 'retention_days must be 1-365.');
    }
    updates.retention_days = retention_days;
  }

  if (Object.keys(updates).length === 0) {
    throw createError(400, 'VALIDATION_ERROR', 'No valid fields to update.');
  }

  let config = await db('backup_config').first();

  if (config) {
    await db('backup_config').where('id', config.id).update(updates);
  } else {
    await db('backup_config').insert({
      backup_path: backup_path || process.env.BACKUP_PATH || '/backups',
      full_schedule: full_schedule || '0 2 * * *',
      incremental_interval_min: incremental_interval_min || 60,
      retention_days: retention_days || 30,
      ...updates
    });
  }

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'backup.update_config',
    'backup_config',
    config ? config.id : null,
    updates,
    ctx.ip
  );

  config = await db('backup_config').first();

  ctx.body = {
    success: true,
    data: {
      id: config.id,
      backup_path: config.backup_path,
      full_schedule: config.full_schedule,
      incremental_interval_min: config.incremental_interval_min,
      retention_days: config.retention_days
    }
  };
});

// ─── RESTORE DRILLS ──────────────────────────────────────────

/**
 * GET /api/restore-drills
 * List restore drill records.
 */
router.get('/restore-drills', async (ctx) => {
  const { page = 1, pageSize = 25 } = ctx.query;
  const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  const totalResult = await db('restore_drills').count('id as count').first();
  const total = totalResult ? totalResult.count : 0;

  const drills = await db('restore_drills')
    .orderBy('started_at', 'desc')
    .limit(limit).offset(offset);

  ctx.body = {
    success: true,
    data: {
      results: drills.map(d => ({
        id: d.id,
        backup_id: d.backup_id,
        status: d.status,
        scratch_schema: d.scratch_schema,
        started_at: d.started_at,
        completed_at: d.completed_at,
        report: d.report ? (typeof d.report === 'string' ? JSON.parse(d.report) : d.report) : null,
        performed_by: d.performed_by
      })),
      total,
      page: parseInt(page, 10) || 1,
      pageSize: limit
    }
  };
});

/**
 * POST /api/restore-drills
 * Start a restore drill. Create scratch DB, restore from backup, record results.
 */
router.post('/restore-drills', async (ctx) => {
  const { backup_id } = ctx.request.body || {};

  if (!backup_id) throw createError(400, 'VALIDATION_ERROR', 'backup_id is required.');

  const backup = await db('backups').where('id', backup_id).first();
  if (!backup) throw createError(404, 'NOT_FOUND', 'Backup not found.');
  if (backup.status !== 'completed') {
    throw createError(400, 'VALIDATION_ERROR', 'Only completed backups can be used for restore drills.');
  }

  const now = new Date();
  const scratchSchema = `restore_drill_${now.getTime()}`;

  const [drillId] = await db('restore_drills').insert({
    backup_id,
    status: 'running',
    scratch_schema: scratchSchema,
    started_at: now,
    performed_by: ctx.state.user.id
  });

  // Helper: verify a backup file exists and its checksum matches
  async function verifyBackupFile(b, report) {
    if (!fs.existsSync(b.file_path)) {
      report.checks.push({ name: `file_exists_${b.id}`, passed: false, message: `Backup #${b.id} file not found at ${b.file_path}.` });
      throw new Error(`Backup #${b.id} file not found.`);
    }
    report.checks.push({ name: `file_exists_${b.id}`, passed: true, message: `Backup #${b.id} file found.` });

    if (b.checksum) {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(b.file_path);
      await new Promise((resolve, reject) => {
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      const computedChecksum = hash.digest('hex');
      const checksumMatch = computedChecksum === b.checksum;
      report.checks.push({
        name: `checksum_${b.id}`,
        passed: checksumMatch,
        message: checksumMatch ? `Backup #${b.id} SHA-256 checksum matches.` : `Backup #${b.id} checksum mismatch.`
      });
      if (!checksumMatch) throw new Error(`Backup #${b.id} checksum mismatch.`);
    }
  }

  // Helper: restore a single backup artifact into a scratch schema.
  // Full backups are gzipped SQL dumps (.sql.gz); incrementals are JSON binlog segments (.json).
  async function restoreDumpToSchema(b, schema, report) {
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbUser = process.env.DB_USER || 'root';
    const dbPass = process.env.DB_PASSWORD || '';

    const isJsonSegment = b.file_path && b.file_path.endsWith('.json');

    if (isJsonSegment) {
      // Incremental: JSON binlog segment — replay SQL statements from captured events
      const segmentData = JSON.parse(fs.readFileSync(b.file_path, 'utf8'));
      if (segmentData.type !== 'binlog_segment') {
        throw new Error(`Backup #${b.id} is not a valid binlog segment.`);
      }

      // Extract executable SQL from binlog events (Query events contain the SQL)
      const sqlStatements = (segmentData.events || [])
        .filter(e => e.event_type === 'Query' && e.info && !e.info.startsWith('BEGIN') && !e.info.startsWith('COMMIT'))
        .map(e => e.info)
        .filter(sql => sql && sql.trim().length > 0);

      if (sqlStatements.length > 0) {
        const args = ['-h', dbHost, '-u', dbUser];
        if (dbPass) args.push(`-p${dbPass}`);
        args.push(schema);

        await new Promise((resolve, reject) => {
          const mysql = require('child_process').spawn('mysql', args);
          let mysqlErr = '';
          mysql.stderr.on('data', (chunk) => { mysqlErr += chunk; });
          mysql.on('close', (code) => {
            if (code !== 0) reject(new Error(`Binlog replay of backup #${b.id} failed: ${mysqlErr}`));
            else resolve();
          });
          mysql.on('error', reject);
          // Pipe SQL statements
          mysql.stdin.write(sqlStatements.join(';\n') + ';\n');
          mysql.stdin.end();
        });
      }

      report.checks.push({
        name: `restore_${b.id}`,
        passed: true,
        message: `Binlog segment #${b.id}: ${sqlStatements.length} SQL statements replayed to ${schema}. ${segmentData.event_count} total events.`
      });
    } else {
      // Full backup: gzipped SQL dump — gunzip | mysql
      await new Promise((resolve, reject) => {
        const gunzip = require('child_process').spawn('gunzip', ['-c', b.file_path]);
        const args = ['-h', dbHost, '-u', dbUser];
        if (dbPass) args.push(`-p${dbPass}`);
        args.push(schema);
        const mysql = require('child_process').spawn('mysql', args);

        gunzip.stdout.pipe(mysql.stdin);
        let mysqlErr = '';
        mysql.stderr.on('data', (chunk) => { mysqlErr += chunk; });
        mysql.on('close', (code) => {
          if (code !== 0) reject(new Error(`mysql restore of backup #${b.id} exited with code ${code}: ${mysqlErr}`));
          else resolve();
        });
        gunzip.on('error', reject);
        mysql.on('error', reject);
      });

      report.checks.push({ name: `restore_${b.id}`, passed: true, message: `Full dump #${b.id} restored to ${schema}.` });
    }
  }

  // Run drill asynchronously
  setImmediate(async () => {
    const report = { checks: [], chain: [] };
    try {
      // ─── Build the restore chain ───────────────────────────────
      // For incremental backups: find the parent full backup, collect all
      // incrementals in the chain up to and including the target, then restore
      // them in order (full first, then each incremental by binlog position).
      // For full backups: just restore the single dump.
      let restoreChain = [];

      if (backup.backup_type === 'incremental' && backup.parent_backup_id) {
        const parentBackup = await db('backups').where('id', backup.parent_backup_id).first();
        if (!parentBackup || parentBackup.status !== 'completed') {
          report.checks.push({ name: 'chain_parent', passed: false, message: `Parent full backup #${backup.parent_backup_id} not found or not completed.` });
          throw new Error('Parent full backup missing or incomplete.');
        }

        // Collect all completed incrementals in this chain up to the target backup
        const chainIncrementals = await db('backups')
          .where('backup_type', 'incremental')
          .where('parent_backup_id', backup.parent_backup_id)
          .where('status', 'completed')
          .whereNotNull('binlog_pos_start')
          .orderBy('binlog_pos_start', 'asc');

        // Only include incrementals up to and including the target
        const targetIdx = chainIncrementals.findIndex(b => b.id === backup.id);
        const relevantIncrementals = targetIdx >= 0
          ? chainIncrementals.slice(0, targetIdx + 1)
          : chainIncrementals;

        // Validate chain continuity
        const gaps = [];
        if (parentBackup.binlog_pos_end && relevantIncrementals.length > 0 && relevantIncrementals[0].binlog_pos_start) {
          if (parentBackup.binlog_file_end !== relevantIncrementals[0].binlog_file_start ||
              parentBackup.binlog_pos_end !== relevantIncrementals[0].binlog_pos_start) {
            gaps.push(`Gap between full backup #${parentBackup.id} end (${parentBackup.binlog_file_end}:${parentBackup.binlog_pos_end}) and first incremental #${relevantIncrementals[0].id} start (${relevantIncrementals[0].binlog_file_start}:${relevantIncrementals[0].binlog_pos_start})`);
          }
        }
        for (let i = 1; i < relevantIncrementals.length; i++) {
          const prev = relevantIncrementals[i - 1];
          const curr = relevantIncrementals[i];
          if (prev.binlog_file_end !== curr.binlog_file_start ||
              prev.binlog_pos_end !== curr.binlog_pos_start) {
            gaps.push(`Gap between incremental #${prev.id} end (${prev.binlog_file_end}:${prev.binlog_pos_end}) and incremental #${curr.id} start (${curr.binlog_file_start}:${curr.binlog_pos_start})`);
          }
        }

        const chainValid = gaps.length === 0 && relevantIncrementals.length > 0;
        report.checks.push({
          name: 'binlog_chain',
          passed: chainValid,
          message: chainValid
            ? `Binlog chain verified: full backup #${parentBackup.id} + ${relevantIncrementals.length} incremental(s) with continuous positions.`
            : `Binlog chain integrity issue: ${gaps.length > 0 ? gaps.join('; ') : 'no incremental records found for chain'}.`
        });

        // Build ordered restore chain: full first, then incrementals
        restoreChain = [parentBackup, ...relevantIncrementals];
        report.chain = restoreChain.map(b => ({
          id: b.id,
          backup_type: b.backup_type,
          binlog_file_start: b.binlog_file_start,
          binlog_pos_start: b.binlog_pos_start,
          binlog_file_end: b.binlog_file_end,
          binlog_pos_end: b.binlog_pos_end
        }));
      } else {
        // Full backup: single-step restore
        restoreChain = [backup];
        report.chain = [{ id: backup.id, backup_type: backup.backup_type }];
      }

      // ─── Verify all backup files in the chain ─────────────────
      for (const b of restoreChain) {
        await verifyBackupFile(b, report);
      }

      // ─── Create scratch schema ────────────────────────────────
      await db.raw(`CREATE DATABASE IF NOT EXISTS \`${scratchSchema}\``);
      report.checks.push({ name: 'scratch_schema_created', passed: true, message: `Scratch schema ${scratchSchema} created.` });

      // ─── Restore chain in order ───────────────────────────────
      // Restore the full backup first, then apply each incremental dump on top.
      // Each incremental is a position-tracked dump that layers on the full.
      for (const b of restoreChain) {
        await restoreDumpToSchema(b, scratchSchema, report);
      }

      report.checks.push({
        name: 'chain_restore_complete',
        passed: true,
        message: `Full restore chain applied: ${restoreChain.length} backup(s) restored in order.`
      });

      // Clean up scratch schema
      await db.raw(`DROP DATABASE IF EXISTS \`${scratchSchema}\``);
      report.checks.push({ name: 'cleanup', passed: true, message: 'Scratch schema dropped.' });

      const allPassed = report.checks.every(c => c.passed);
      await db('restore_drills').where('id', drillId).update({
        status: allPassed ? 'passed' : 'failed',
        completed_at: new Date(),
        report: JSON.stringify(report)
      });
    } catch (err) {
      // Attempt cleanup
      try { await db.raw(`DROP DATABASE IF EXISTS \`${scratchSchema}\``); } catch (_) { /* ignore */ }

      report.checks.push({ name: 'error', passed: false, message: err.message });
      await db('restore_drills').where('id', drillId).update({
        status: 'failed',
        completed_at: new Date(),
        report: JSON.stringify(report)
      });
    }
  });

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'backup.restore_drill',
    'restore_drills',
    drillId,
    { backup_id, scratch_schema: scratchSchema },
    ctx.ip
  );

  ctx.status = 202;
  ctx.body = {
    success: true,
    data: {
      id: drillId,
      backup_id: parseInt(backup_id),
      status: 'running',
      scratch_schema: scratchSchema,
      started_at: now,
      performed_by: ctx.state.user.id
    }
  };
});

/**
 * GET /api/restore-drills/:id
 * Get detailed report for a restore drill.
 */
router.get('/restore-drills/:id', async (ctx) => {
  const { id } = ctx.params;

  const drill = await db('restore_drills').where('id', id).first();
  if (!drill) throw createError(404, 'NOT_FOUND', 'Restore drill not found.');

  ctx.body = {
    success: true,
    data: {
      id: drill.id,
      backup_id: drill.backup_id,
      status: drill.status,
      scratch_schema: drill.scratch_schema,
      started_at: drill.started_at,
      completed_at: drill.completed_at,
      report: drill.report ? (typeof drill.report === 'string' ? JSON.parse(drill.report) : drill.report) : null,
      performed_by: drill.performed_by,
      duration_seconds: drill.started_at && drill.completed_at
        ? Math.round((new Date(drill.completed_at) - new Date(drill.started_at)) / 1000)
        : null
    }
  };
});

module.exports = router;
