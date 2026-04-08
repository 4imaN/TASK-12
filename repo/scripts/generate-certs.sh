#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# Generate self-signed TLS certificates for local development
# Output: backend/certs/server.crt and backend/certs/server.key
# ──────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CERT_DIR="$REPO_ROOT/backend/certs"

DAYS_VALID=365
SUBJECT="/C=US/ST=Development/L=Local/O=RailOps/OU=Dev/CN=localhost"

mkdir -p "$CERT_DIR"

echo "Generating self-signed TLS certificate for development..."
echo "  Output directory: $CERT_DIR"
echo "  Valid for: $DAYS_VALID days"

openssl req \
  -x509 \
  -newkey rsa:2048 \
  -nodes \
  -keyout "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.crt" \
  -days "$DAYS_VALID" \
  -subj "$SUBJECT" \
  -addext "subjectAltName=DNS:localhost,DNS:backend,IP:127.0.0.1"

chmod 600 "$CERT_DIR/server.key"
chmod 644 "$CERT_DIR/server.crt"

echo ""
echo "Certificates generated successfully:"
echo "  Certificate: $CERT_DIR/server.crt"
echo "  Private key: $CERT_DIR/server.key"
echo ""
echo "These are self-signed and for DEVELOPMENT USE ONLY."
echo "Do NOT use in production."
