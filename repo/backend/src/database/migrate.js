/**
 * Database migration script.
 * Reads and executes schema.sql against the database.
 * Run with: node src/database/migrate.js
 */
const fs = require('fs');
const path = require('path');
const db = require('./connection');

/**
 * Split SQL text by semicolons that are NOT inside quoted strings.
 * Handles single-quoted and double-quoted strings, including escaped quotes.
 */
function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (inString) {
      current += ch;
      if (ch === stringChar && sql[i - 1] !== '\\') inString = false;
    } else if (ch === "'" || ch === '"') {
      current += ch;
      inString = true;
      stringChar = ch;
    } else if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed && !trimmed.startsWith('--')) statements.push(trimmed);
      current = '';
    } else {
      current += ch;
    }
  }

  const trimmed = current.trim();
  if (trimmed && !trimmed.startsWith('--')) statements.push(trimmed);

  return statements;
}

async function migrate() {
  console.log('[MIGRATE] Starting database migration...');

  const schemaPath = path.join(__dirname, '..', '..', 'database', 'schema.sql');

  if (!fs.existsSync(schemaPath)) {
    console.error('[MIGRATE] schema.sql not found at:', schemaPath);
    process.exit(1);
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');

  // Split by semicolons that are NOT inside quoted strings
  const statements = splitSqlStatements(sql);

  let created = 0;
  for (const stmt of statements) {
    try {
      await db.raw(stmt);
      // Count CREATE TABLE statements
      if (stmt.toUpperCase().includes('CREATE TABLE')) {
        const match = stmt.match(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\S+)/i);
        if (match) {
          console.log(`[MIGRATE] Created table: ${match[1]}`);
          created++;
        }
      }
    } catch (err) {
      // Skip "already exists" errors
      if (err.code === 'ER_TABLE_EXISTS_ERROR' || err.errno === 1050) {
        const match = stmt.match(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\S+)/i);
        console.log(`[MIGRATE] Table already exists: ${match ? match[1] : 'unknown'}`);
      } else if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
        // Skip duplicate inserts (e.g., backup_config default row)
        console.log('[MIGRATE] Skipping duplicate insert');
      } else {
        console.warn(`[MIGRATE] Warning: ${err.message}`);
      }
    }
  }

  console.log(`[MIGRATE] Migration complete. ${created} table(s) processed.`);
  process.exit(0);
}

migrate();
