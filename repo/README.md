Project Type: fullstack

# RailOps Offline Schedule & Inventory Control Suite

A self-contained, offline-first web application for regional rail operators to plan trips, manage seats and fares, and track onboard supplies with full auditability — no internet required.

## Architecture

| Layer     | Technology            | Purpose                            |
|-----------|-----------------------|------------------------------------|
| Frontend  | Vue 3 + Pinia + Router| Role-based SPA                     |
| Backend   | Koa (Node 18)         | REST API with TLS                  |
| Database  | MySQL 8.0             | System of record, audit trails     |
| Runtime   | Docker Compose        | Full-stack orchestration           |

All services run via Docker Compose. The backend serves HTTPS on port 3443; the frontend serves HTTPS on port 8443. TLS certificates are auto-generated inside the backend container at startup.

## Roles

| Role               | Access                                                       |
|--------------------|--------------------------------------------------------------|
| Guest              | Read-only trip search on published schedules (no login required) |
| Host               | Schedule management, inventory workflows (station-scoped)    |
| Platform Operations| Approvals, audit, user admin, backups, cross-site access     |

Guest access is unauthenticated — the trip search page (`/search`) is publicly accessible without credentials.

## Quick Start

```bash
docker compose up --build
```

This starts all three services (MySQL, backend, frontend) with zero manual configuration. No `.env` file, no host-side installs, no certificate generation needed.

### Verify it works

1. **Check backend health:**
   ```bash
   curl -sk https://localhost:3443/api/health
   ```
   Expected: `{"success":true,"data":{"status":"ok",...}}`

2. **Guest trip search (no login):**
   Open https://localhost:8443/search in a browser (accept the self-signed certificate).
   Enter "New York" as origin and "Washington" as destination. Click Search.
   Confirm trip results appear with departure times, durations, and fare classes.

3. **Admin login:**
   Open https://localhost:8443/login. Enter `admin` / `admin123`.
   After login, confirm the navigation shows Schedules, Inventory, Approvals, Audit, Users, and More.

4. **Host login:**
   Log out, then log in as `host1` / `host123`.
   Confirm the navigation shows Schedules and Inventory but NOT Approvals or Users.

### URLs

- **Frontend**: https://localhost:8443
- **API Health**: https://localhost:3443/api/health
- **Guest Trip Search**: https://localhost:8443/search (no login required)

## Default Credentials

| Username | Password  | Role               |
|----------|-----------|--------------------|
| admin    | admin123  | Platform Operations|
| host1    | host123   | Host               |

Guest access (trip search) requires no login.

## Testing

All tests run inside Docker containers. No host-side `npm install` or tooling is required.

```bash
# Start app + run all tests
docker compose up --build -d
./run_tests.sh
```

The test runner builds a dedicated test container with all dependencies pre-installed, then executes tests inside it against the Docker-hosted services.

Test categories:

- **Unit tests** (`unit_tests/`): Pure logic tests for validators, fuzzy matching, masking, and backup path validation
- **Frontend tests** (`frontend/`): Pinia store state management, cache utilities, route config, view rendering, component behavior via Vitest
- **API tests** (`API_tests/`): Real HTTP integration tests against the Docker-hosted backend — auth, trips, schedules, inventory, stations, users, backups, data quality, authorization, security
- **E2E tests** (`e2e/`): Playwright browser tests against real frontend + real backend — guest search, login, navigation, view auth guards, API proxy

## Performance Verification

The spec requires cached repeated trip searches to return in under 200ms on local network hardware.

**Pass criteria:** Warm (repeated) search runs complete in under 200ms. The benchmark script runs 3 warm iterations and prints per-run timing.

## Project Structure

```
repo/
├── README.md
├── docker-compose.yml
├── Dockerfile.test          # Test runner container
├── run_tests.sh             # Docker-contained test runner
├── frontend/                # Vue 3 SPA
├── backend/                 # Koa REST API
├── unit_tests/              # Jest unit tests
├── API_tests/               # Jest API integration tests
├── e2e/                     # Playwright E2E tests
└── scripts/                 # Helper scripts
```
