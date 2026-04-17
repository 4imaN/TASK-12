#!/bin/bash
set -e

echo "============================================"
echo "  RailOps Test Suite (Docker-contained)"
echo "============================================"
echo ""

# Build test runner image with all dependencies pre-installed
echo ">> Building test runner..."
docker compose build test-runner 2>&1 | tail -3

# Ensure app services are running
echo ">> Ensuring app services are up..."
docker compose up -d mysql backend frontend 2>&1 | tail -3
echo "   Waiting for backend health..."
until docker compose exec -T backend sh -c 'wget -qO- --no-check-certificate https://localhost:3443/api/health 2>/dev/null | grep -q ok' 2>/dev/null; do
  sleep 2
done
echo "   Backend is healthy."

# Clear auth state for clean test run
echo "   Clearing auth state..."
docker compose exec -T mysql mysql -uroot -prailops_secret railops \
  -e "DELETE FROM lockouts; DELETE FROM login_attempts; DELETE FROM sessions;" 2>/dev/null || true

PASS=0
FAIL=0

# ---- Unit Tests ----
echo ""
echo ">> Running unit tests..."
if docker compose run --rm -T test-runner sh -c "cd /repo/unit_tests && npx jest --forceExit --coverage" 2>&1; then
  echo ">> Unit tests: PASSED"
  PASS=$((PASS + 1))
else
  echo ">> Unit tests: FAILED"
  FAIL=$((FAIL + 1))
fi

# ---- API Integration Tests ----
echo ""
echo ">> Running API integration tests..."
if docker compose run --rm -T test-runner sh -c "cd /repo/API_tests && API_BASE_URL=https://backend:3443 NODE_TLS_REJECT_UNAUTHORIZED=0 npx jest --forceExit --runInBand --testTimeout=60000" 2>&1; then
  echo ">> API tests: PASSED"
  PASS=$((PASS + 1))
else
  echo ">> API tests: FAILED"
  FAIL=$((FAIL + 1))
fi

# ---- Frontend Tests ----
echo ""
echo ">> Running frontend tests..."
if docker compose run --rm -T test-runner sh -c "cd /repo/frontend && npx vitest run" 2>&1; then
  echo ">> Frontend tests: PASSED"
  PASS=$((PASS + 1))
else
  echo ">> Frontend tests: FAILED"
  FAIL=$((FAIL + 1))
fi

# ---- E2E Tests ----
echo ""
echo ">> Running E2E tests..."
if docker compose run --rm -T test-runner sh -c "cd /repo/e2e && PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser BASE_URL=https://frontend:8443 NODE_TLS_REJECT_UNAUTHORIZED=0 npx playwright test --config=playwright.config.js" 2>&1; then
  echo ">> E2E tests: PASSED"
  PASS=$((PASS + 1))
else
  echo ">> E2E tests: FAILED"
  FAIL=$((FAIL + 1))
fi

# ---- Summary ----
echo ""
echo "============================================"
echo "  Results: $PASS passed, $FAIL failed"
echo "============================================"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
exit 0
