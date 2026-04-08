# RailOps Prior-Issue Recheck (Static) — v3

Source baselines:
- `.tmp/railops-static-retest-2026-04-08.md`
- `.tmp/railops-issue-recheck-2026-04-08-v2.md`

Date: 2026-04-08
Method: static-only recheck (no project startup/tests/docker run in this audit pass)

## Overall Recheck Verdict
- Issue 1: **Fixed (statically confirmed)**
- Issue 2: **Code/config/docs alignment fixed; runtime behavior not independently re-executed in this pass**
- Issue 3: **Fixed (statically confirmed)**
- Issue 4: **Fixed (statically confirmed)**
- Issue 5: **Fixed (statically confirmed)**

Net: all previously code/doc/test gaps are now closed by static evidence. The only remaining boundary is independent runtime verification for Issue 2, which has a separate manual verification artifact.

## Issue-by-Issue Status

### Issue 1 — Session-cap eviction logic
- Status: **Fixed**
- Evidence:
  - Active-only count + active-only eviction in login path: `backend/src/services/authService.js:157-162`, `backend/src/services/authService.js:173-180`
  - Same enforcement in verify-device path: `backend/src/services/authService.js:226-231`, `backend/src/services/authService.js:242-249`
  - Regression tests exist for both flows: `API_tests/session-cap.test.js:62`, `API_tests/session-cap.test.js:107`, `API_tests/session-cap.test.js:147`

### Issue 2 — Secure-cookie/frontend HTTPS topology mismatch
- Status: **Structurally fixed in repository; independent runtime confirmation not re-executed in this static pass**
- Static evidence of fix:
  - Secure cookie preserved in non-test modes: `backend/src/routes/auth.js:11-17`
  - Frontend HTTPS cert resolution aligned to canonical `backend/certs`: `frontend/vite.config.js:9-13`, `frontend/vite.config.js:22`
  - Docker frontend now receives TLS paths + cert mount: `docker-compose.yml:65-70`
  - Canonical cert generation path: `scripts/generate-certs.sh:11`, `scripts/generate-certs.sh:26-27`
  - Docs/Checklist aligned: `README.md:47`, `README.md:73`, `README.md:82`, `README.md:171-181`, `.env.example:22-26`
- Manual runtime evidence provided (not independently rerun here):
  - `.tmp/issue2-runtime-verification-2026-04-08.md:46-60` (backend HTTPS)
  - `.tmp/issue2-runtime-verification-2026-04-08.md:63-85` (frontend HTTPS)
  - `.tmp/issue2-runtime-verification-2026-04-08.md:88-116` (secure cookie flags)

### Issue 3 — Documentation drift
- Status: **Fixed**
- Evidence:
  - `/api/auth/me` docs match implementation fields: `docs/api-spec.md:266-279`, `backend/src/routes/auth.js:145-153`
  - Design route taxonomy matches mounted routes: `docs/design.md:65-75`, `backend/src/index.js:118-128`
  - Session model docs align with schema: `docs/design.md:140-147`, `backend/database/schema.sql:33-41`
  - README API test section no longer uses stale hardcoded count; uses category description + optional count command: `README.md:167-171`

### Issue 4 — Admin session observability includes non-active sessions
- Status: **Fixed**
- Evidence:
  - User list `active_sessions` filtered to active + unexpired: `backend/src/routes/users.js:69-75`
  - User session list endpoint filtered to active + unexpired: `backend/src/routes/users.js:291-296`
  - Coverage tests: `API_tests/session-cap.test.js:192`, `API_tests/session-cap.test.js:215`

### Issue 5 — Missing direct session-cap regression coverage
- Status: **Fixed**
- Evidence:
  - Dedicated regression suite: `API_tests/session-cap.test.js:1`
  - Login eviction scenario: `API_tests/session-cap.test.js:62`
  - Verify-device eviction scenario: `API_tests/session-cap.test.js:107`
  - Exception cap scenario: `API_tests/session-cap.test.js:147`

## Final Note
This recheck pass is static-only by boundary. Runtime/manual checks were not rerun here; however, a detailed runtime verification artifact exists at `.tmp/issue2-runtime-verification-2026-04-08.md`.
