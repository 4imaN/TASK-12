#!/bin/bash
# Quick development seed script
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo ">> Running database migration..."
cd "$REPO_DIR/backend"
node src/database/migrate.js

echo ""
echo ">> Seeding development data..."
node src/database/seed.js

echo ""
echo ">> Done! Development data loaded."
echo "   Default accounts:"
echo "     admin / admin123  (Platform Operations)"
echo "     host1 / host123   (Host / Station Agent)"
