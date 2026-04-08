/**
 * Backup path validation tests.
 * Ensures backup paths cannot escape allowlisted roots.
 */
const { validateBackupPath, validateFilePath } = require('../backend/src/utils/backupPath');

describe('validateBackupPath', () => {
  test('accepts path within default allowed root /backups', () => {
    const result = validateBackupPath('/backups');
    expect(result.valid).toBe(true);
    expect(result.resolved).toBeDefined();
  });

  test('accepts path within /tmp/railops-backups when directory exists', () => {
    const fs = require('fs');
    // Create the directory if it doesn't exist so validation can resolve it
    if (!fs.existsSync('/tmp/railops-backups')) {
      fs.mkdirSync('/tmp/railops-backups', { recursive: true });
    }
    const result = validateBackupPath('/tmp/railops-backups');
    expect(result.valid).toBe(true);
  });

  test('accepts subdirectory of allowed root', () => {
    const result = validateBackupPath('/backups/daily');
    expect(result.valid).toBe(true);
  });

  test('rejects relative path', () => {
    const result = validateBackupPath('backups/data');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/absolute/i);
  });

  test('rejects path traversal with .. (resolves outside allowed roots)', () => {
    const result = validateBackupPath('/backups/../etc/passwd');
    expect(result.valid).toBe(false);
    // path.normalize resolves the .. so it becomes /etc/passwd — rejected by allowlist
    expect(result.error).toBeTruthy();
  });

  test('rejects path outside allowed roots', () => {
    const result = validateBackupPath('/etc/shadow');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/allowed roots/i);
  });

  test('rejects /var/log (outside roots)', () => {
    const result = validateBackupPath('/var/log');
    expect(result.valid).toBe(false);
  });

  test('rejects empty string', () => {
    const result = validateBackupPath('');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  test('rejects null', () => {
    const result = validateBackupPath(null);
    expect(result.valid).toBe(false);
  });

  test('rejects root filesystem /', () => {
    const result = validateBackupPath('/');
    expect(result.valid).toBe(false);
  });

  test('rejects home directory escape', () => {
    const result = validateBackupPath('/home/attacker/data');
    expect(result.valid).toBe(false);
  });
});

describe('validateFilePath', () => {
  test('accepts file within backup directory', () => {
    const result = validateFilePath('/backups/backup_001.sql.gz', '/backups');
    expect(result).toBe('/backups/backup_001.sql.gz');
  });

  test('rejects file that escapes backup directory', () => {
    expect(() => {
      validateFilePath('/etc/crontab', '/backups');
    }).toThrow(/escapes backup directory/);
  });

  test('rejects path traversal in filename', () => {
    expect(() => {
      validateFilePath('/backups/../etc/passwd', '/backups');
    }).toThrow(/escapes backup directory/);
  });
});
