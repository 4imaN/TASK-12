/**
 * Backup path validation and hardening.
 * Prevents arbitrary filesystem access via backup configuration.
 */
const path = require('path');
const fs = require('fs');

// Allowlisted roots from environment (comma-separated absolute paths)
// Defaults to /backups (Docker volume) and /tmp/railops-backups (local dev)
const ALLOWED_ROOTS = (process.env.BACKUP_ALLOWED_ROOTS || '/backups,/tmp/railops-backups')
  .split(',')
  .map(p => path.resolve(p.trim()))
  .filter(p => p.length > 0);

/**
 * Validate that a backup path is safe:
 * - Must be absolute
 * - Must resolve to within an allowlisted root
 * - Must not contain path traversal components
 * - Symlinks are resolved before validation
 *
 * @param {string} inputPath - The path to validate
 * @returns {{ valid: boolean, resolved: string|null, error: string|null }}
 */
function validateBackupPath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return { valid: false, resolved: null, error: 'Backup path is required.' };
  }

  // Must be absolute
  if (!path.isAbsolute(inputPath)) {
    return { valid: false, resolved: null, error: 'Backup path must be absolute.' };
  }

  // Reject obvious traversal patterns
  const normalized = path.normalize(inputPath);
  if (normalized.includes('..')) {
    return { valid: false, resolved: null, error: 'Backup path must not contain path traversal (..).' };
  }

  // Resolve to canonical form
  let resolved;
  try {
    // If path exists, resolve symlinks. If not, resolve the parent.
    if (fs.existsSync(normalized)) {
      resolved = fs.realpathSync(normalized);
    } else {
      // Resolve parent to check it's not a symlink escape
      const parent = path.dirname(normalized);
      if (fs.existsSync(parent)) {
        resolved = path.join(fs.realpathSync(parent), path.basename(normalized));
      } else {
        resolved = normalized;
      }
    }
  } catch {
    resolved = normalized;
  }

  // Must be within an allowlisted root (resolve symlinks on roots too for consistency)
  const withinAllowlist = ALLOWED_ROOTS.some(root => {
    let resolvedRoot = path.resolve(root);
    try { if (fs.existsSync(resolvedRoot)) resolvedRoot = fs.realpathSync(resolvedRoot); } catch {}
    return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
  });

  if (!withinAllowlist) {
    return {
      valid: false,
      resolved: null,
      error: `Backup path must be within allowed roots: ${ALLOWED_ROOTS.join(', ')}`
    };
  }

  return { valid: true, resolved, error: null };
}

/**
 * Validate that a generated backup file path stays within the expected directory.
 */
function validateFilePath(filePath, backupDir) {
  const resolvedFile = path.resolve(filePath);
  const resolvedDir = path.resolve(backupDir);
  if (!resolvedFile.startsWith(resolvedDir + path.sep) && resolvedFile !== resolvedDir) {
    throw new Error(`Backup file path ${resolvedFile} escapes backup directory ${resolvedDir}`);
  }
  return resolvedFile;
}

module.exports = { validateBackupPath, validateFilePath, ALLOWED_ROOTS };
