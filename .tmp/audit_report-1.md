# RailOps Offline Suite — Static Retest Audit (2026-04-08)

## 1. Verdict
- Overall conclusion: **Partial Pass**

## 2. Scope and Static Verification Boundary
- Reviewed:
  - Documentation and configuration (`README.md`, `docs/design.md`, `docs/api-spec.md`, `.env.example`, `docker-compose.yml`).
  - Backend architecture, auth/security, RBAC/scope controls, schedule/inventory/backup/data-quality/audit modules.
  - Frontend role-based routing, auth/session handling, guest search/cache, schedule/approval/rollback UI, inventory/backup/data-quality/audit UI.
  - Static test suites (`unit_tests/`, `API_tests/`, `frontend/src/__tests__/`).
- Not reviewed:
  - External infrastructure, OS-level backup permissions, certificate trust-store setup, removable drive behavior outside repository code.
  - Runtime state in a live DB instance.
- Intentionally not executed:
  - Project startup, tests, Docker, browsers, external services.
- Claims requiring manual verification:
  - Browser behavior for `Secure` session cookies when frontend is served on `http://localhost:8443`.
  - `<200 ms` repeated-query target for hot searches.
  - End-to-end backup/restore-drill execution with `mysqldump`, `mysql`, `gzip`, binlog availability.

## 3. Repository / Requirement Mapping Summary
- Prompt core goal: offline LAN rail operations suite with role-based guest/host/platform-ops workflows for trip search, schedule lifecycle (draft/checklist/approval/rollback/version diff), inventory workflows/alerts, strict local auth/security, backup/recovery, data quality, and full auditability.
- Mapped implementation areas:
  - Backend Koa APIs and MySQL schema for auth/sessions, schedules/versions/approvals, inventory/stock counts/alerts, backups/restore drills, data quality, audit/backtracking.
  - Vue SPA route guards and role-specific views for guest search, host operations, and platform-ops administration/audit.
  - Static tests across unit/API/frontend.
- Main outcome:
  - Broad feature coverage exists, but one **confirmed High** security-control defect (session-cap enforcement logic) and one **High suspected runtime risk** (cookie transport mismatch) prevent full acceptance.

## 4. Section-by-section Review

### 1. Hard Gates

#### 1.1 Documentation and static verifiability
- Conclusion: **Partial Pass**
- Rationale: Startup/config/test docs are present and generally actionable, but material doc-to-code drift reduces static verifiability accuracy.
- Evidence:
  - Startup/test/config guidance exists: `README.md:30`, `README.md:53`, `README.md:141`, `README.md:155`.
  - API contract mismatch for `/auth/me`:
    - docs expect `displayName`, `recoveryCodesRemaining`, `lastLoginAt`: `docs/api-spec.md:266`
    - implementation returns `display_name`, `phone_last4`, `max_sessions`: `backend/src/routes/auth.js:145`
  - Design route taxonomy mismatch (`/api/admin`, `/api/search` in design vs actual mounted routes): `docs/design.md:69`, `docs/design.md:70`, `backend/src/index.js:118`.
  - Design session model omits current `state` field used in schema/auth logic: `docs/design.md:146`, `backend/database/schema.sql:38`, `backend/src/middleware/auth.js:34`.
- Manual verification note: Not required for this conclusion (static drift is directly observable).

#### 1.2 Whether delivery materially deviates from Prompt
- Conclusion: **Partial Pass**
- Rationale: Implementation is centered on the required business domain and workflows, but an explicit security requirement (2-session cap enforcement) is not reliably enforced in code paths.
- Evidence:
  - Domain alignment (schedule/inventory/approval/backup/DQ/audit modules): `backend/src/index.js:106`, `backend/src/index.js:128`.
  - Confirmed session-cap logic defect: `backend/src/services/authService.js:157`, `backend/src/services/authService.js:173`, `backend/src/services/authService.js:222`, `backend/src/services/authService.js:238`.
- Manual verification note: Session-cap defect is statically provable; no runtime needed to identify the bug.

### 2. Delivery Completeness

#### 2.1 Coverage of explicit core requirements
- Conclusion: **Partial Pass**
- Rationale:
  - Implemented:
    - Guest search filters/date format/sort/fuzzy/hot cache: `backend/src/routes/trips.js:15`, `backend/src/routes/trips.js:36`, `backend/src/routes/trips.js:181`, `backend/src/utils/fuzzyMatch.js:53`, `frontend/src/stores/search.js:20`, `frontend/src/views/TripSearch.vue:194`.
    - Schedule draft/checklist/approval/rollback/version compare: `backend/src/routes/schedules.js:924`, `backend/src/routes/schedules.js:971`, `backend/src/routes/schedules.js:1055`, `backend/src/routes/schedules.js:1114`, `backend/src/routes/schedules.js:1158`, `backend/src/routes/approvals.js:172`, `frontend/src/components/VersionCompare.vue:23`, `frontend/src/views/ScheduleDetail.vue:17`.
    - Inventory workflows and alerts thresholds: `backend/src/routes/inventory.js:434`, `backend/src/routes/inventory.js:499`, `backend/src/routes/inventory.js:1023`, `backend/src/routes/inventory.js:1084`, `backend/src/routes/inventory.js:1116`.
    - Local auth/security primitives (bcrypt, lockout, recovery code hashes, pending verification flow): `backend/src/services/authService.js:7`, `backend/src/services/authService.js:51`, `backend/src/services/authService.js:127`, `backend/src/services/authService.js:269`, `backend/src/middleware/auth.js:34`.
    - Backup/recovery and data-quality/audit/backtrack features: `backend/src/routes/backups.js:86`, `backend/src/routes/backups.js:480`, `backend/src/services/backupScheduler.js:347`, `backend/src/routes/dataQuality.js:18`, `backend/src/routes/dataQuality.js:257`, `backend/src/routes/audit.js:110`, `backend/src/routes/audit.js:156`, `backend/src/routes/audit.js:204`.
  - Gaps/risks:
    - Session-cap policy (“max 2 active sessions unless exception”) can be bypassed due eviction query bug: `backend/src/services/authService.js:173`, `backend/src/services/authService.js:238`.
    - `<200ms` hot-search target cannot be statically proven.
- Evidence: see above.
- Manual verification note: Performance target requires runtime timing validation.

#### 2.2 Basic end-to-end deliverable (not fragment/demo)
- Conclusion: **Pass**
- Rationale: Repository includes full-stack structure, schema+seed, docs, and tests; core features are not single-file demos.
- Evidence:
  - Project structure and docs: `README.md:190`.
  - Backend + frontend + schema + tests present: `backend/src/index.js:16`, `frontend/src/main.js:1`, `backend/database/schema.sql:19`, `API_tests/package.json:5`, `unit_tests/package.json:5`, `frontend/package.json:10`.
- Manual verification note: Runtime operability remains manual due static-only boundary.

### 3. Engineering and Architecture Quality

#### 3.1 Structure and module decomposition
- Conclusion: **Pass**
- Rationale: Code is modular by concern (routes/middleware/services/utils), with clear separation between auth, domain modules, and cross-cutting concerns.
- Evidence:
  - Route modularization: `backend/src/index.js:106`, `backend/src/index.js:128`.
  - Dedicated middleware/services: `backend/src/middleware/auth.js:87`, `backend/src/middleware/scopeFilter.js:13`, `backend/src/services/authService.js:83`, `backend/src/services/backupScheduler.js:331`.
  - Frontend store/router/view separation: `frontend/src/router/index.js:4`, `frontend/src/stores/auth.js:10`, `frontend/src/stores/schedules.js:5`.
- Manual verification note: Not required.

#### 3.2 Maintainability and extensibility
- Conclusion: **Partial Pass**
- Rationale: Maintainable baseline exists, but consistency debt is visible (documentation drift; duplicated backup execution logic between route and scheduler).
- Evidence:
  - Backup execution logic duplicated in route and scheduler (`mysqldump/binlog handling`): `backend/src/routes/backups.js:123`, `backend/src/services/backupScheduler.js:102`.
  - Documentation drift examples: `docs/design.md:69`, `docs/api-spec.md:266`, `backend/src/routes/auth.js:145`.
- Manual verification note: Not required.

### 4. Engineering Details and Professionalism

#### 4.1 Error handling, logging, validation, API professionalism
- Conclusion: **Partial Pass**
- Rationale:
  - Strengths: structured error middleware, route/input validation, audit logging, request logging, route guards.
  - Weaknesses: session-cap control defect; active-session observability endpoints include non-active states.
- Evidence:
  - Structured errors: `backend/src/middleware/errorHandler.js:5`.
  - Request + server logging: `backend/src/index.js:65`, `backend/src/index.js:157`.
  - Validation examples: `backend/src/routes/auth.js:32`, `backend/src/routes/inventory.js:434`, `backend/src/routes/schedules.js:102`.
  - Session-cap defect: `backend/src/services/authService.js:173`, `backend/src/services/authService.js:238`.
  - Session listing/counting do not filter `state='active'`: `backend/src/routes/users.js:69`, `backend/src/routes/users.js:290`.
- Manual verification note: Not required for identified static defects.

#### 4.2 Product/service realism vs demo shape
- Conclusion: **Pass**
- Rationale: Delivery resembles a production-style service with RBAC, persistence, audit trails, operational modules, and non-trivial workflows.
- Evidence:
  - Role-enforced modules: `backend/src/routes/users.js:15`, `backend/src/routes/approvals.js:10`, `backend/src/routes/inventory.js:10`.
  - Operational workflows: `backend/src/routes/backups.js:86`, `backend/src/routes/dataQuality.js:257`, `backend/src/routes/audit.js:110`.
- Manual verification note: Runtime reliability still requires manual execution.

### 5. Prompt Understanding and Requirement Fit

#### 5.1 Business objective and constraints fit
- Conclusion: **Partial Pass**
- Rationale: The implementation strongly matches the operational/business scenario, but key security control fidelity is incomplete (active-session cap enforcement), and one transport/cookie runtime risk remains unresolved statically.
- Evidence:
  - Core business flows implemented across schedule/inventory/audit/backups: `backend/src/routes/schedules.js:924`, `backend/src/routes/inventory.js:428`, `backend/src/routes/backups.js:480`, `backend/src/routes/audit.js:156`.
  - Session-cap enforcement gap: `backend/src/services/authService.js:173`, `backend/src/services/authService.js:238`.
  - Cookie security mode + frontend HTTP topology mismatch risk: `backend/src/routes/auth.js:11`, `backend/src/routes/auth.js:16`, `frontend/package.json:7`, `README.md:50`.
- Manual verification note: Browser cookie behavior must be manually validated.

### 6. Aesthetics (Frontend)

#### 6.1 Visual/interaction quality fit
- Conclusion: **Pass** (with static boundary)
- Rationale: Frontend shows clear visual hierarchy, distinct functional regions, interaction feedback, and role-based navigation structure.
- Evidence:
  - Structured header/nav/role cues: `frontend/src/App.vue:14`, `frontend/src/App.vue:64`.
  - Search page hierarchy, empty-state guidance, and interaction controls: `frontend/src/views/TripSearch.vue:57`, `frontend/src/views/TripSearch.vue:108`, `frontend/src/views/TripSearch.vue:190`.
  - Approval/rejection feedback and required-comment UX: `frontend/src/views/ApprovalList.vue:57`, `frontend/src/views/ApprovalList.vue:60`.
- Manual verification note: Responsive behavior and rendering correctness on target devices are **Manual Verification Required**.

## 5. Issues / Suggestions (Severity-Rated)

### Issue 1
- Severity: **High**
- Title: Session-cap enforcement can evict non-active sessions and leave active sessions above policy cap
- Conclusion: **Fail**
- Evidence: `backend/src/services/authService.js:157`, `backend/src/services/authService.js:173`, `backend/src/services/authService.js:222`, `backend/src/services/authService.js:238`
- Impact:
  - Violates explicit prompt requirement to cap users at 2 active sessions unless exception.
  - Under mixed session states, oldest deletion can target non-active/pending rows while active sessions remain over cap.
- Minimum actionable fix:
  - In both login and verify-device paths, select eviction candidate from **active + unexpired** sessions only (`state='active' AND expires_at > now`), ordered by `last_active_at`.
  - Add regression tests that create mixed `pending_verification` and `active` sessions and assert oldest active eviction.

### Issue 2
- Severity: **High** (Suspected Risk)
- Title: Secure-cookie auth may conflict with HTTP frontend deployment topology
- Conclusion: **Cannot Confirm Statistically**
- Evidence: `backend/src/routes/auth.js:11`, `backend/src/routes/auth.js:16`, `frontend/package.json:7`, `frontend/vite.config.js:10`, `frontend/Dockerfile:7`, `README.md:46`, `README.md:50`
- Impact:
  - If target browsers enforce `Secure` strictly for non-HTTPS frontend origins, session cookies may not persist and login/session UX can fail.
- Minimum actionable fix:
  - Serve frontend over HTTPS in operational mode or place both SPA/API behind a single HTTPS reverse proxy.
  - Add explicit deployment-mode documentation and a browser compatibility verification checklist.

### Issue 3
- Severity: **Medium**
- Title: Documentation-to-code contract drift reduces auditability and operator confidence
- Conclusion: **Partial Fail**
- Evidence: `docs/api-spec.md:266`, `backend/src/routes/auth.js:145`, `docs/design.md:69`, `backend/src/index.js:118`, `README.md:170`, `API_tests/z_security.test.js:7`
- Impact:
  - Static reviewers and operators can validate against incorrect API fields/routes/test expectations.
  - Increases onboarding and operational misconfiguration risk.
- Minimum actionable fix:
  - Reconcile docs with implemented contracts (especially `/auth/me`, route taxonomy, session model).
  - Update README test inventory to current suites.

### Issue 4
- Severity: **Medium**
- Title: Admin session observability endpoints treat non-active sessions as active
- Conclusion: **Partial Fail**
- Evidence: `backend/src/routes/users.js:69`, `backend/src/routes/users.js:73`, `backend/src/routes/users.js:290`, `backend/src/routes/users.js:294`
- Impact:
  - Platform Ops may see inflated “active_sessions” and session lists containing pending/non-active entries, impairing security operations and incident response.
- Minimum actionable fix:
  - Filter session counts/listing by `state='active'` and unexpired timestamps.
  - Optionally return state explicitly for administrative clarity.

### Issue 5
- Severity: **Medium**
- Title: Critical session-cap behavior lacks direct test coverage
- Conclusion: **Fail (coverage gap)**
- Evidence: `API_tests/users.test.js:54`, `API_tests/users.test.js:78`, `API_tests/z_security.test.js:179`
- Impact:
  - Regressions in multi-session enforcement can pass current tests undetected.
- Minimum actionable fix:
  - Add API tests that create >2 active sessions for a user (with and without exception), then assert oldest active session eviction and final active count.

## 6. Security Review Summary

### Authentication entry points
- Conclusion: **Partial Pass**
- Evidence: `backend/src/routes/auth.js:29`, `backend/src/routes/auth.js:93`, `backend/src/services/authService.js:83`, `backend/src/middleware/auth.js:87`
- Reasoning: Local username/password, device challenge, recovery-code flow, inactivity/hard-expiry checks are present; session-cap bug remains.

### Route-level authorization
- Conclusion: **Pass**
- Evidence: `backend/src/routes/users.js:15`, `backend/src/routes/approvals.js:10`, `backend/src/routes/inventory.js:10`, `backend/src/routes/dataQuality.js:10`, `backend/src/routes/audit.js:9`
- Reasoning: Protected routes consistently apply `authenticate()` and role guards.

### Object-level authorization
- Conclusion: **Pass**
- Evidence: `backend/src/routes/schedules.js:16`, `backend/src/routes/schedules.js:24`, `backend/src/routes/inventory.js:493`, `backend/src/routes/stations.js:124`, `API_tests/authorization.test.js:119`
- Reasoning: Host station/schedule object scope checks are implemented and statically covered by API tests.

### Function-level authorization
- Conclusion: **Partial Pass**
- Evidence: `backend/src/routes/approvals.js:77`, `backend/src/routes/approvals.js:176`, `backend/src/services/authService.js:173`, `backend/src/services/authService.js:238`
- Reasoning: Business-rule guards exist (e.g., rejection comment required, self-approval block), but session-cap function-level control has a logic flaw.

### Tenant/user data isolation
- Conclusion: **Partial Pass**
- Evidence: `backend/src/routes/schedules.js:56`, `backend/src/routes/inventory.js:47`, `backend/src/routes/stations.js:75`, `API_tests/z_security.test.js:337`
- Reasoning: Host station scoping is enforced across core host operational routes; static review did not prove every possible read path under all auth states.

### Admin/internal/debug endpoint protection
- Conclusion: **Pass**
- Evidence: `backend/src/routes/backups.js:20`, `backend/src/routes/dataQuality.js:10`, `backend/src/routes/audit.js:9`, `API_tests/authorization.test.js:27`
- Reasoning: Sensitive admin/audit/backup endpoints require platform-ops role.

## 7. Tests and Logging Review

### Unit tests
- Conclusion: **Partial Pass**
- Rationale: Unit tests exist for validators/fuzzy/masks/auth/session lifecycle/backup-path, but are heavily mocked and miss certain critical auth policy branches.
- Evidence: `unit_tests/package.json:5`, `unit_tests/sessionLifecycle.test.js:37`, `unit_tests/auth.test.js:31`, `unit_tests/backupPath.test.js:7`

### API / integration tests
- Conclusion: **Partial Pass**
- Rationale: Broad endpoint coverage exists including many security cases; core session-cap runtime enforcement is not directly asserted.
- Evidence: `API_tests/package.json:5`, `API_tests/authorization.test.js:3`, `API_tests/z_security.test.js:567`, `API_tests/users.test.js:54`

### Logging categories / observability
- Conclusion: **Pass**
- Rationale: Request logging, 5xx error logging, and audit-event logging are implemented with structured fields.
- Evidence: `backend/src/index.js:65`, `backend/src/middleware/errorHandler.js:25`, `backend/src/services/auditService.js:7`

### Sensitive-data leakage risk in logs/responses
- Conclusion: **Partial Pass**
- Rationale: No request-body logging is present; phone masking/decryption controls are role-based. Audit details can still store operationally sensitive metadata (e.g., device fingerprints) by design.
- Evidence: `backend/src/index.js:69`, `backend/src/services/auditService.js:15`, `backend/src/routes/users.js:108`, `backend/src/routes/auth.js:150`

## 8. Test Coverage Assessment (Static Audit)

### 8.1 Test Overview
- Unit tests exist: Jest (`unit_tests/package.json:5`).
- API/integration tests exist: Jest (`API_tests/package.json:5`).
- Frontend tests exist: Vitest (`frontend/package.json:10`, `frontend/vitest.config.js:6`).
- Test entry points are documented: `README.md:141`, `README.md:155`.
- Documentation test inventory is stale for API suite count: `README.md:170`, `API_tests/z_security.test.js:7`.

### 8.2 Coverage Mapping Table

| Requirement / Risk Point | Mapped Test Case(s) (`file:line`) | Key Assertion / Fixture / Mock (`file:line`) | Coverage Assessment | Gap | Minimum Test Addition |
|---|---|---|---|---|---|
| Login input validation and status contracts | `API_tests/auth.test.js:23`, `API_tests/auth.test.js:46` | Asserts `401 INVALID_CREDENTIALS`, `400 VALIDATION_ERROR` | sufficient | None major | Keep regression cases when auth contract changes |
| Risky-device challenge and pending token path | `API_tests/auth.test.js:108`, `API_tests/z_security.test.js:567` | Requires `DEVICE_VERIFICATION_REQUIRED`; pending token rejected on protected routes | sufficient | None major | Add boundary test for pending-session expiry window |
| Session hard expiry + inactivity renewal logic | `unit_tests/sessionLifecycle.test.js:37`, `unit_tests/sessionLifecycle.test.js:64`, `API_tests/auth.test.js:87` | Reject expired/inactive sessions; renewal by repeated `/auth/me` | basically covered | No integration test for exact 8h edge with real DB clock | Add API test with controlled timestamps/fixtures for inactivity boundary |
| 2-session cap + exception behavior | `API_tests/users.test.js:54`, `API_tests/z_security.test.js:179` | Verifies `max_sessions` baseline and exception endpoint, not runtime eviction | **missing** | No test proves oldest active-session eviction or cap enforcement under mixed states | Add API suite creating 3+ sessions; assert active count and eviction target |
| 401/403 route authorization matrix | `API_tests/authorization.test.js:12`, `API_tests/authorization.test.js:43` | Host forbidden for admin routes; unauthenticated blocked | sufficient | None major | Keep matrix synced with new routes |
| Object-level station/schedule scope for hosts | `API_tests/authorization.test.js:101`, `API_tests/authorization.test.js:119`, `API_tests/z_security.test.js:355` | Out-of-scope station/schedule denied; assigned station allowed | basically covered | Limited checks for inventory object-level edge permutations | Add item/movement cross-station negative cases for host role |
| Schedule checklist/approval/rollback flows | `API_tests/schedules.test.js:76`, `API_tests/schedules.test.js:95`, `frontend/src/__tests__/views/PublishWorkflow.test.js:99` | Validation endpoint invoked; draft rollback rejected; role-UI flow assertions | insufficient | No explicit negative API test for trainset overlap rejection branch | Add API test constructing overlapping published schedules and expecting `VALIDATION_FAILED` |
| Inventory movement and stock-count workflows | `API_tests/inventory.test.js:51`, `API_tests/z_security.test.js:7` | Movement type validation; stock-count cross-station PATCH denied | insufficient | No API test for variance alert thresholds (`>2%` or `>$50`) on finalize | Add stock-count finalize test asserting `variance_alerts` content/thresholds |
| Backup path hardening and metadata shape | `API_tests/z_security.test.js:536`, `API_tests/backups.test.js:72` | Reject traversal/out-of-root/relative paths; verify response metadata keys | basically covered | Backup execution/restore chain behavior remains largely structural in tests | Add integration tests with controlled backup artifacts for restore-chain continuity |
| Audit/backtrack/corrective action endpoints | `API_tests/z_security.test.js:299`, `API_tests/z_security.test.js:687` | Audit logs query returns entries; corrective action binds `performed_by` to auth user | basically covered | No negative tests for malformed backtrack ranges | Add invalid date-range and missing-param backtrack tests |

### 8.3 Security Coverage Audit
- Authentication: **Partial Pass**
  - Covered: login validation, device challenge, pending-token rejection (`API_tests/auth.test.js:108`, `API_tests/z_security.test.js:567`).
  - Gap: no direct test for session-cap eviction correctness.
- Route authorization: **Pass**
  - Covered by broad 401/403 matrix (`API_tests/authorization.test.js:12`, `API_tests/authorization.test.js:43`).
- Object-level authorization: **Partial Pass**
  - Covered for station/schedule and stock-count cross-station line injection (`API_tests/authorization.test.js:119`, `API_tests/z_security.test.js:14`).
  - Gap: limited depth on all inventory object-level permutations.
- Tenant/data isolation: **Partial Pass**
  - Host station isolation tested on station endpoints (`API_tests/z_security.test.js:337`).
  - Severe defects could still hide in untested query combinations.
- Admin/internal protection: **Pass**
  - Host blocked from admin/audit/backup/data-quality endpoints (`API_tests/authorization.test.js:27`, `API_tests/authorization.test.js:32`).

### 8.4 Final Coverage Judgment
- **Partial Pass**
- Covered major risks:
  - Auth validation/challenge basics, route-level RBAC, core object-scope checks, key backup-path hardening, and baseline audit/backtrack contracts.
- Uncovered risks allowing severe defects to remain undetected:
  - Session-cap runtime enforcement under mixed session states.
  - Browser-level cookie transport behavior for secure-cookie auth topology.
  - Deep restore-chain execution correctness and inventory variance-threshold behavior.

## 9. Final Notes
- The implementation is substantively aligned with the prompt and is not a toy scaffold.
- The primary acceptance blocker for full pass is the **confirmed session-cap enforcement defect** in auth service logic.
- Static analysis cannot validate runtime performance, browser cookie acceptance, or backup command execution; those require controlled manual verification.
