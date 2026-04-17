# Test Coverage Audit

## Project Type
- Declared in `README.md` as `fullstack`.

## Current Score
- **96 / 100**

## Coverage Summary
- Backend/API coverage remains strong with real HTTP integration tests in `API_tests/`.
- Frontend coverage is now present across:
  - store state management
  - cache utility logic
  - route configuration
  - view rendering
  - basic component behavior
- E2E coverage exists for guest search, login, route guards, and API proxy behavior in `e2e/railops.e2e.js`.

## Evidence

### Real API Coverage
- `API_tests/setup.js` uses direct HTTP/HTTPS requests.
- `API_tests/auth.test.js`, `trips.test.js`, `schedules.test.js`, `schedule-workflow.test.js`, `inventory.test.js`, `inventory-detail.test.js`, `users.test.js`, `backups.test.js`, `authorization.test.js`, `session-cap.test.js`, `z_security.test.js` all target real backend routes.

### Frontend Unit Coverage
- `frontend/src/__tests__/cache.test.js`
- `frontend/src/__tests__/router.test.js`
- `frontend/src/__tests__/stores.test.js`
- `frontend/src/__tests__/views.test.js`

### E2E Coverage
- `e2e/railops.e2e.js`

## Remaining Gaps
- Some frontend tests still use minimal API stubs to allow rendering, so they are not full FE↔BE behavioral tests.
- Some API suites remain shallower than ideal on response-contract detail, especially admin/list-oriented checks.
- Frontend tests cover many surfaces, but most assertions are still render/visibility/basic interaction checks rather than deeper stateful workflows.

## Verdict
- **Test coverage: very strong**
- Not a perfect score only because the remaining gaps are about test depth, not missing broad coverage surfaces.

# README Audit

## Current Verdict
- **PASS**

## Evidence
- Docker-contained startup is documented in `README.md`.
- Docker-contained testing is documented in `README.md`.
- No host-side `npm install` is required by the README anymore.
- Access URLs and ports are explicit.
- Verification steps are explicit.
- Demo credentials are present for authenticated roles.
- Guest access is explicitly documented as unauthenticated.
- Project structure matches the repo contents, including `Dockerfile.test` and test directories.

## Evidence References
- Startup: `README.md`
- Test flow: `README.md`
- Docker-contained runner: `run_tests.sh`

## Residual Notes
- README now satisfies the strict audit gate.
- Any further improvement would be editorial polish, not compliance recovery.

# Final Summary

- **Overall score: 96 / 100**
- **README: PASS**
- **Primary reason not 100:** remaining depth/rigor gaps in frontend/view/API contract assertions rather than missing test surfaces or documentation failures.
