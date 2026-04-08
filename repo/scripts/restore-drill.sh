#!/bin/bash
# RailOps Restore Drill Script
# Restores a backup to a scratch database for verification
set -e

BACKUP_FILE="${1:?Usage: restore-drill.sh <backup_file>}"
TIMESTAMP=$(date +%Y%m%d)
SCRATCH_DB="railops_drill_$TIMESTAMP"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD must be set. Run: source .env}"

MYSQL_CMD="mysql -h $DB_HOST -P $DB_PORT -u $DB_USER -p$DB_PASSWORD"

echo "============================================"
echo "  RailOps Restore Drill"
echo "  Backup:   $BACKUP_FILE"
echo "  Scratch:  $SCRATCH_DB"
echo "============================================"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file not found: $BACKUP_FILE"
  exit 1
fi

echo ">> Creating scratch database..."
$MYSQL_CMD -e "CREATE DATABASE IF NOT EXISTS \`$SCRATCH_DB\`;"

echo ">> Restoring backup..."
START_TIME=$(date +%s)

if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" | $MYSQL_CMD "$SCRATCH_DB"
else
  $MYSQL_CMD "$SCRATCH_DB" < "$BACKUP_FILE"
fi

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ">> Restore completed in ${DURATION}s"

echo ""
echo ">> Running integrity checks..."
TABLE_COUNT=$($MYSQL_CMD -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$SCRATCH_DB';")
echo "   Tables found: $TABLE_COUNT"

echo ""
echo "   Row counts per table:"
$MYSQL_CMD -N -e "
  SELECT table_name, table_rows
  FROM information_schema.tables
  WHERE table_schema='$SCRATCH_DB'
  ORDER BY table_name;" | while read TABLE ROWS; do
  printf "   %-35s %s rows\n" "$TABLE" "$ROWS"
done

echo ""
echo ">> Cleaning up scratch database..."
$MYSQL_CMD -e "DROP DATABASE IF EXISTS \`$SCRATCH_DB\`;"

echo ""
echo "============================================"
echo "  Drill Result: PASSED"
echo "  Tables: $TABLE_COUNT"
echo "  Duration: ${DURATION}s"
echo "============================================"
