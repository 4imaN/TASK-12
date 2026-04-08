#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
API_BASE_URL="${API_BASE_URL:-https://localhost:3443}"
PASS=0
FAIL=0

echo "============================================"
echo "  RailOps Test Suite"
echo "============================================"
echo ""

# ---- Unit Tests ----
echo ">> Running unit tests..."
cd "$REPO_DIR/unit_tests"
if [ ! -d "node_modules" ]; then
  npm install 2>/dev/null
fi

if npx jest --coverage --forceExit 2>&1; then
  echo ">> Unit tests: PASSED"
  PASS=$((PASS + 1))
else
  echo ">> Unit tests: FAILED"
  FAIL=$((FAIL + 1))
fi
echo ""

# ---- API Tests ----
echo ">> Running API integration tests..."
echo "   Backend URL: $API_BASE_URL"

# Preflight health check
echo "   Checking backend connectivity..."
HEALTH_STATUS=$(node -e "
const url = new URL('/api/health', '$API_BASE_URL');
const mod = url.protocol === 'https:' ? require('https') : require('http');
const req = mod.get(url.href, { rejectUnauthorized: false, timeout: 5000 }, (res) => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => { try { const j = JSON.parse(d); console.log(j.data?.status || 'unknown'); } catch { console.log('error'); } });
});
req.on('error', () => console.log('unreachable'));
req.on('timeout', () => { req.destroy(); console.log('timeout'); });
" 2>/dev/null)

if [ "$HEALTH_STATUS" = "ok" ]; then
  echo "   Backend is healthy."

  # Clear auth state before API tests to prevent cross-run lockout interference
  echo "   Clearing auth state for clean test run..."
  docker exec railops-mysql mysql -uroot -prailops_secret railops \
    -e "DELETE FROM lockouts; DELETE FROM login_attempts; DELETE FROM sessions;" 2>/dev/null || true

  cd "$REPO_DIR/API_tests"
  if [ ! -d "node_modules" ]; then
    npm install 2>/dev/null
  fi

  if API_BASE_URL="$API_BASE_URL" npx jest --forceExit --runInBand --testTimeout=30000 2>&1; then
    echo ">> API tests: PASSED"
    PASS=$((PASS + 1))
  else
    echo ">> API tests: FAILED"
    FAIL=$((FAIL + 1))
  fi
else
  echo "   ERROR: Backend not reachable at $API_BASE_URL (status: $HEALTH_STATUS)"
  echo "   Start the backend first, or set API_BASE_URL to the correct address."
  echo ">> API tests: SKIPPED"
  FAIL=$((FAIL + 1))
fi
echo ""

# ---- Frontend Tests ----
echo ">> Running frontend tests..."
cd "$REPO_DIR/frontend"
if [ ! -d "node_modules" ]; then
  npm install 2>/dev/null
fi

if npx vitest run 2>&1; then
  echo ">> Frontend tests: PASSED"
  PASS=$((PASS + 1))
else
  echo ">> Frontend tests: FAILED"
  FAIL=$((FAIL + 1))
fi
echo ""

# ---- Summary ----
echo "============================================"
echo "  Results: $PASS passed, $FAIL failed"
echo "============================================"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
exit 0
