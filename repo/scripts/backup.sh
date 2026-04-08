#!/bin/bash
# RailOps MySQL Full Backup Script
set -e

BACKUP_PATH="${1:-/backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_PATH/railops_full_$TIMESTAMP.sql.gz"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD must be set. Run: source .env}"
DB_NAME="${DB_NAME:-railops}"

echo "============================================"
echo "  RailOps Full Backup"
echo "  Target: $BACKUP_FILE"
echo "  Database: $DB_NAME@$DB_HOST:$DB_PORT"
echo "============================================"

# Ensure backup directory exists
mkdir -p "$BACKUP_PATH"

# Run mysqldump with compression
echo ">> Starting backup..."
START_TIME=$(date +%s)

mysqldump \
  -h "$DB_HOST" \
  -P "$DB_PORT" \
  -u "$DB_USER" \
  -p"$DB_PASSWORD" \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  "$DB_NAME" | gzip > "$BACKUP_FILE"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Calculate checksum
CHECKSUM=$(sha256sum "$BACKUP_FILE" | awk '{print $1}')
FILE_SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat --printf="%s" "$BACKUP_FILE" 2>/dev/null)

echo ""
echo ">> Backup completed"
echo "   File:     $BACKUP_FILE"
echo "   Size:     $FILE_SIZE bytes"
echo "   Checksum: $CHECKSUM"
echo "   Duration: ${DURATION}s"
echo "============================================"
