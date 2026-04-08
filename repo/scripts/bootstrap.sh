#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# RailOps environment bootstrap (idempotent)
#
# Creates .env from .env.example, generates secrets for
# placeholder values, and ensures TLS certs exist.
#
# Usage:
#   ./scripts/bootstrap.sh           # safe, never overwrites
#   ./scripts/bootstrap.sh --force   # regenerate secrets & certs
# ──────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
ENV_EXAMPLE="$REPO_ROOT/.env.example"
CERT_DIR="$REPO_ROOT/backend/certs"

FORCE=false
if [[ "${1:-}" == "--force" ]]; then
  FORCE=true
fi

# ── helpers ──────────────────────────────────────────────

random_secret() {
  # 32 bytes → 64 hex chars
  openssl rand -hex 32
}

replace_env_value() {
  # Replace the value of a key in .env only if the current value matches the placeholder.
  local key="$1"
  local placeholder="$2"
  local new_value="$3"

  if $FORCE || grep -qE "^${key}=${placeholder}$" "$ENV_FILE" 2>/dev/null; then
    # Use a temp file for portability (BSD + GNU sed differ on -i)
    local tmp
    tmp=$(mktemp)
    sed "s|^${key}=${placeholder}$|${key}=${new_value}|" "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
    echo "  [set] $key"
  else
    echo "  [ok]  $key (already customized)"
  fi
}

# ── 1. Create .env ───────────────────────────────────────

echo "==> Checking .env"
if [[ -f "$ENV_FILE" ]] && ! $FORCE; then
  echo "  .env exists, preserving current values."
else
  if [[ ! -f "$ENV_EXAMPLE" ]]; then
    echo "ERROR: $ENV_EXAMPLE not found." >&2
    exit 1
  fi
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "  Created .env from .env.example"
fi

# ── 2. Generate secrets for placeholder values ───────────

echo "==> Checking secrets"

# SESSION_SECRET was removed — sessions use random tokens stored as SHA-256 hashes
# in the database, so no shared signing secret is needed.
replace_env_value "PHONE_ENCRYPTION_KEY" "change-this-to-a-32-char-secret!" "$(random_secret)"
replace_env_value "MYSQL_ROOT_PASSWORD" "change-me-in-production" "$(random_secret)"
replace_env_value "DB_PASSWORD" "change-me-in-production" "$(random_secret)"

# ── 3. Set local-dev overrides if DB_HOST is still 'mysql' ─

# When running outside Docker, DB_HOST should be localhost.
# We don't touch it if the user has already changed it.
echo "==> Checking DB_HOST"
if grep -qE "^DB_HOST=mysql$" "$ENV_FILE" 2>/dev/null; then
  echo "  [info] DB_HOST is 'mysql' (Docker default). For local dev, override with:"
  echo "         export DB_HOST=localhost"
else
  echo "  [ok]  DB_HOST already customized"
fi

# ── 4. Ensure TLS certificates exist ────────────────────

echo "==> Checking TLS certificates"
mkdir -p "$CERT_DIR"
if [[ -f "$CERT_DIR/server.crt" && -f "$CERT_DIR/server.key" ]] && ! $FORCE; then
  echo "  Certificates exist at $CERT_DIR"
else
  echo "  Generating self-signed TLS certificates..."
  "$SCRIPT_DIR/generate-certs.sh"
fi

# ── 5. Summary ───────────────────────────────────────────

echo ""
echo "Bootstrap complete."
echo ""
echo "  .env           : $ENV_FILE"
echo "  TLS cert       : $CERT_DIR/server.crt"
echo "  TLS key        : $CERT_DIR/server.key"
echo ""
echo "Next steps:"
echo "  Docker:    docker-compose up --build"
echo "  Local dev: see README.md 'Manual Setup' section"
