const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('../database/connection');
const { validateBackupPath, validateFilePath } = require('../utils/backupPath');
const log = require('../utils/logger');

let incrementalTimer = null;
let cronCheckTimer = null;
let lastBinlogPosition = null;

/**
 * Parse a simple cron expression (minute hour day-of-month month day-of-week).
 * Returns { minute, hour } for scheduling full backups.
 * Supports numeric values and '*' wildcards.
 */
function parseCronSchedule(cronExpr) {
  if (!cronExpr) return null;
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 2) return null;
  return {
    minute: parts[0],
    hour: parts[1]
  };
}

/**
 * Check if the current time matches a cron minute/hour pattern.
 */
function cronMatches(cronField, currentValue) {
  if (cronField === '*') return true;
  // Handle comma-separated values like "0,30"
  const values = cronField.split(',').map(v => parseInt(v.trim(), 10));
  return values.includes(currentValue);
}

/**
 * Get the current MySQL binlog position for incremental change detection.
 * Returns a string like "binlog.000001:12345" or null if unavailable.
 */
async function getBinlogPosition() {
  try {
    const result = await db.raw('SHOW MASTER STATUS');
    const rows = result[0] || result;
    if (rows && rows.length > 0) {
      const row = rows[0];
      return `${row.File}:${row.Position}`;
    }
  } catch (err) {
    // Binlog may not be enabled; fall back to a change-detection heuristic
    // using the information_schema to detect any table modifications
    try {
      const result = await db.raw(
        "SELECT MAX(UPDATE_TIME) as last_update FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
      );
      const rows = result[0] || result;
      if (rows && rows.length > 0 && rows[0].last_update) {
        return `update_time:${new Date(rows[0].last_update).getTime()}`;
      }
    } catch (_) {
      // ignore
    }
  }
  return null;
}

/**
 * Run a backup (full or incremental). Creates a backup record and spawns
 * mysqldump asynchronously, similar to the /backups/run endpoint.
 */
async function runScheduledBackup(type) {
  // Check no backup is currently running
  const running = await db('backups').where('status', 'running').first();
  if (running) {
    log.info('backup', `Skipping ${type} backup: another backup is already running`, { type });
    return;
  }

  const config = await db('backup_config').first();
  const rawPath = (config && config.backup_path) || process.env.BACKUP_PATH || '/backups';
  const pathCheck = validateBackupPath(rawPath);
  if (!pathCheck.valid) {
    log.error('backup', `Path rejected: ${pathCheck.error}`, { path: rawPath });
    return;
  }
  const backupPath = pathCheck.resolved;

  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T.Z]/g, '').substring(0, 14);
  const fileName = `railops_${type}_${timestamp}.sql.gz`;
  const filePath = validateFilePath(path.join(backupPath, fileName), backupPath);

  const [backupId] = await db('backups').insert({
    backup_type: type,
    file_path: filePath,
    status: 'running',
    started_at: now
  });

  log.info('backup', `Starting scheduled ${type} backup`, { type, backupId, filePath });

  // Run backup asynchronously
  setImmediate(async () => {
    try {
      const dbHost = process.env.DB_HOST || 'localhost';
      const dbUser = process.env.DB_USER || 'root';
      const dbPass = process.env.DB_PASSWORD || '';
      const dbName = process.env.DB_NAME || 'railops';

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
        log.error('backup', 'Incremental backup FAILED: binlog not available', { backupId });
        await db('backups').where('id', backupId).update({
          status: 'failed', completed_at: new Date(),
          error_message: 'Binlog not available for incremental backup.'
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
          end_file: binlogFileStart,
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

      log.info('backup', `${type} backup completed`, { type, backupId });
    } catch (err) {
      await db('backups').where('id', backupId).update({
        status: 'failed',
        completed_at: new Date(),
        error_message: err.message
      });
      log.error('backup', `${type} backup failed`, { type, backupId, error: err.message });
    }
  });
}

/**
 * Incremental backup tick: checks if the database has changed since the last
 * check by comparing binlog position or table update times. If changes are
 * detected, triggers an incremental backup.
 */
async function incrementalTick() {
  try {
    const currentPosition = await getBinlogPosition();
    if (currentPosition && currentPosition !== lastBinlogPosition) {
      if (lastBinlogPosition !== null) {
        // Position has advanced since last check -- run incremental backup
        log.info('backup', 'Binlog/change position advanced — running incremental backup', { from: lastBinlogPosition, to: currentPosition });
        await runScheduledBackup('incremental');
      }
      lastBinlogPosition = currentPosition;
    }
  } catch (err) {
    log.error('backup', 'Incremental tick error', { error: err.message });
  }
}

/**
 * Full backup cron tick: checks once per minute whether the current time
 * matches the configured cron schedule for full backups.
 */
async function cronTick() {
  try {
    const config = await db('backup_config').first();
    if (!config || !config.full_schedule) return;

    const cron = parseCronSchedule(config.full_schedule);
    if (!cron) return;

    const now = new Date();
    if (cronMatches(cron.minute, now.getMinutes()) && cronMatches(cron.hour, now.getHours())) {
      log.info('backup', 'Cron match for full backup', { schedule: config.full_schedule });
      await runScheduledBackup('full');
    }
  } catch (err) {
    log.error('backup', 'Cron tick error', { error: err.message });
  }
}

/**
 * Start the backup scheduler. Reads backup_config and sets up recurring timers
 * for incremental and full backups. Safe to call on server startup.
 */
async function startBackupScheduler() {
  // Stop any existing timers first
  stopBackupScheduler();

  try {
    const config = await db('backup_config').first();

    if (!config) {
      log.info('backup', 'No backup_config found — scheduler not started');
      return;
    }

    // Initialize binlog position baseline (so we don't immediately trigger a backup)
    lastBinlogPosition = await getBinlogPosition();

    // Set up incremental backup timer
    const intervalMin = config.incremental_interval_min || 15;
    const intervalMs = intervalMin * 60 * 1000;
    incrementalTimer = setInterval(incrementalTick, intervalMs);
    log.info('backup', `Incremental backup timer set: every ${intervalMin} minutes`, { intervalMin });

    // Set up cron check timer (check once per minute for full backup schedule match)
    cronCheckTimer = setInterval(cronTick, 60 * 1000);
    log.info('backup', 'Full backup cron check active', { schedule: config.full_schedule });

    log.info('backup', 'Backup scheduler started');
  } catch (err) {
    log.error('backup', 'Failed to start scheduler', { error: err.message });
  }
}

/**
 * Stop the backup scheduler timers. Safe to call multiple times.
 */
function stopBackupScheduler() {
  if (incrementalTimer) {
    clearInterval(incrementalTimer);
    incrementalTimer = null;
  }
  if (cronCheckTimer) {
    clearInterval(cronCheckTimer);
    cronCheckTimer = null;
  }
}

module.exports = { startBackupScheduler, stopBackupScheduler };
