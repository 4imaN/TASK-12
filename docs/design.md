# RailOps Offline Schedule & Inventory Control Suite -- Design Document

## 1. System Overview

RailOps is a LAN-only, offline-first application for managing train schedules, station inventory, and operational approvals. It is designed to run entirely on-site without any internet dependency.

### Technology Stack

| Layer    | Technology                                   |
|----------|----------------------------------------------|
| Frontend | Vue 3, Pinia, Vue Router, IndexedDB          |
| Backend  | Node.js, Koa, knex (query builder)           |
| Database | MySQL 8                                      |
| Auth     | Local username/password, bcrypt              |
| Infra    | Docker Compose, TLS on all internal endpoints|

### Roles

| Role                  | Access                                                                 |
|-----------------------|------------------------------------------------------------------------|
| Guest                 | Read-only search of published schedules. No login required.            |
| Host (Station Agent)  | Draft/edit schedules and manage inventory for assigned stations only.   |
| Platform Operations   | Approve/reject schedule changes, cross-site visibility, auditor role.  |

### Core Principles

- **Offline-first**: The entire stack runs on a LAN with zero calls to external services. DNS resolution, certificate validation, and time synchronization all happen locally.
- **TLS everywhere**: Every HTTP endpoint is served over TLS. Operators supply their own certificates; a self-signed dev certificate is generated during first-run setup for development environments.
- **Auditability**: Every mutation to schedules, inventory, and user accounts produces an audit log entry.

---

## 2. Architecture

### 2.1 Frontend

```
Vue 3 SPA
  +-- Vue Router (history mode)
  +-- Pinia stores
  |     +-- authStore        -- session state (server-managed cookie), role, device fingerprint
  |     +-- scheduleStore    -- draft workspace, version diffs
  |     +-- inventoryStore   -- movements, balances, alerts
  |     +-- searchStore      -- guest search state, cached results
  +-- IndexedDB (hot-search cache)
  +-- fetch API client (base URL from proxy, credentials: 'include' for cookie transport)
```

- **Vue Router** guards enforce role-based page access. Guest routes are public; Host and Platform Ops routes require an active session.
- **Pinia stores** hold application state and encapsulate API calls. Stores are modular and independently testable.
- **IndexedDB** powers the hot-search cache for Guest search (see Section 5). It stores denormalized schedule result sets keyed by normalized query parameters with a 1-hour TTL.

### 2.2 Backend

```
Koa application (backend/src/index.js)
  +-- TLS enforcement        -- server-level: HTTPS required at startup (see Section 4.9)
  +-- middleware (backend/src/middleware/)
  |     +-- errorHandler     -- structured JSON error responses (errorHandler.js)
  |     +-- rateLimiter      -- token-bucket on login endpoint (rateLimiter.js)
  |     +-- auth             -- session token validation, role guards (auth.js)
  |     +-- scopeFilter      -- row-level station scope for Host users (scopeFilter.js)
  +-- routes (backend/src/routes/)
  |     +-- /api/auth        -- login, logout, device challenge, recovery (auth.js)
  |     +-- /api/users       -- user management, sessions, station scopes (users.js)
  |     +-- /api/stations    -- station metadata, aliases (stations.js)
  |     +-- /api/trainsets   -- fleet management (trainsets.js)
  |     +-- /api/trips       -- public guest search endpoint (trips.js)
  |     +-- /api/schedules   -- CRUD, versioning, approval workflow (schedules.js)
  |     +-- /api/approvals   -- schedule approval workflow (approvals.js)
  |     +-- /api/inventory   -- movements, balances, counts, alerts (inventory.js)
  |     +-- /api/backups     -- backup operations, restore drills (backups.js)
  |     +-- /api/data-quality-- daily reports, issue tracking (dataQuality.js)
  |     +-- /api/audit       -- audit log queries (audit.js)
  +-- services (backend/src/services/)
  |     +-- authService      -- login logic, lockout, session cap, device verification
  |     +-- auditService     -- append-only audit log writes
  |     +-- backupScheduler  -- nightly full + 15-min incremental backup jobs
  |     +-- dqScheduler      -- daily data quality scan (05:00)
  +-- utils (backend/src/utils/)
        +-- validators       -- schedule, movement, seat-class validation rules
        +-- masks            -- phone/email masking by role
        +-- fuzzyMatch       -- station name matching (exact, prefix, Levenshtein)
```

- **knex** is the query builder and migration tool. No ORM. Raw SQL is used only where knex's builder cannot express the query. Route handlers query the database directly via knex; there is no separate models layer.
- **Middleware** handles cross-cutting concerns: authentication and role guards (`auth.js`), rate limiting (`rateLimiter.js`), station scope filtering (`scopeFilter.js`), and error formatting (`errorHandler.js`).
- **Services** handle business logic that is not request-scoped: login/lockout/session-cap logic (`authService.js`), audit log writes (`auditService.js`), and scheduled jobs (`backupScheduler.js`, `dqScheduler.js`).
- **Utils** provide shared helpers called from route handlers: input validation (`validators.js`), PII masking (`masks.js`), and fuzzy station matching (`fuzzyMatch.js`).
- **bcrypt** (cost factor 12) handles all password hashing.
- **Session tokens** are cryptographically random 256-bit values stored in the `sessions` table as SHA-256 hashes. The primary transport is an **HttpOnly, Secure, SameSite=strict** session cookie (`railops_session`). A **Bearer Authorization header** is accepted as a fallback for API tooling and tests. The frontend never reads or stores the raw token — session state is opaque to client JavaScript.

### 2.3 Database

MySQL 8 runs on-site. All operational data resides in a single database instance. Binary logging is enabled for point-in-time recovery (see Section 8).

### 2.4 Docker Compose

```yaml
services:
  mysql:       # MySQL 8 with persistent volume (port 3307 mapped to host for admin access)
  backend:     # Node.js Koa application (HTTPS on port 3443)
  frontend:    # Vue SPA served via Vite/nginx (HTTPS on port 8443)
```

All containers share a Docker bridge network (`railops-net`). Both the **frontend** (port 8443) and **backend** (port 3443) expose HTTPS ports to the LAN for direct access. The **MySQL** service maps port 3307 to the host for administrative access. Backup and data-quality scheduling run as in-process services within the backend container, not as separate sidecar containers.

---

## 3. Data Model

All tables use `id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY` unless noted otherwise. Timestamps are `DATETIME` in UTC. Soft deletes (`deleted_at`) are used where business rules require historical record retention.

### 3.1 Identity & Access

**users**

| Column          | Type             | Notes                                       |
|-----------------|------------------|---------------------------------------------|
| id              | INT              | PK, auto-increment                          |
| username        | VARCHAR(100)     | Unique, case-insensitive                    |
| password_hash   | VARCHAR(255)     | bcrypt output (cost 12)                     |
| display_name    | VARCHAR(200)     |                                             |
| phone_encrypted | VARCHAR(255)     | AES-256-CBC encrypted phone number          |
| phone_last4     | VARCHAR(4)       | Last 4 digits for display masking           |
| role            | ENUM             | `guest`, `host`, `platform_ops`             |
| is_active       | BOOLEAN          | Soft disable without deletion               |
| max_sessions    | INT              | Default 2; overridable via session_exceptions |
| created_at      | TIMESTAMP        |                                             |
| updated_at      | TIMESTAMP        |                                             |

**user_station_scopes**

| Column     | Type            | Notes                                     |
|------------|-----------------|-------------------------------------------|
| id         | BIGINT UNSIGNED | PK                                        |
| user_id    | BIGINT UNSIGNED | FK to users                               |
| station_id | BIGINT UNSIGNED | FK to stations                            |

Hosts are assigned one or more stations. Platform Ops users have no rows here; their role grants cross-site access implicitly.

### 3.2 Session & Device Security

**sessions**

| Column            | Type            | Notes                                       |
|-------------------|-----------------|---------------------------------------------|
| id                | VARCHAR(128)    | PK — SHA-256 hash of the raw session token  |
| user_id           | INT             | FK to users                                 |
| device_fingerprint| VARCHAR(255)    | Browser + OS + machine key                  |
| ip_address        | VARCHAR(45)     | IPv4 or IPv6 of the client                  |
| state             | VARCHAR(30)     | `active` or `pending_verification`          |
| last_active_at    | TIMESTAMP       | Updated on each authenticated request       |
| expires_at        | TIMESTAMP       | Hard expiry, 30 days from creation          |
| created_at        | TIMESTAMP       |                                             |

**trusted_devices**

| Column            | Type            | Notes                                       |
|-------------------|-----------------|---------------------------------------------|
| id                | BIGINT UNSIGNED | PK                                          |
| user_id           | BIGINT UNSIGNED | FK to users                                 |
| device_fingerprint| VARCHAR(256)    | Browser + OS + machine key                  |
| label             | VARCHAR(128)    | User-friendly device name                   |
| trusted_at        | DATETIME        |                                             |

**recovery_codes**

| Column     | Type            | Notes                                         |
|------------|-----------------|-----------------------------------------------|
| id         | BIGINT UNSIGNED | PK                                            |
| user_id    | BIGINT UNSIGNED | FK to users                                   |
| code_hash  | CHAR(60)        | bcrypt hash of the recovery code              |
| is_used    | BOOLEAN         |                                                |
| used_at    | DATETIME        | Nullable                                      |
| created_at | DATETIME        |                                                |

**login_attempts**

| Column            | Type            | Notes                              |
|-------------------|-----------------|------------------------------------|
| id                | BIGINT UNSIGNED | PK                                 |
| username          | VARCHAR(64)     | As submitted (may not match a user)|
| ip_address        | VARCHAR(45)     | IPv4 or IPv6                       |
| device_fingerprint| VARCHAR(256)    | Nullable                           |
| success           | BOOLEAN         |                                    |
| attempted_at      | DATETIME        |                                    |

**lockouts**

| Column              | Type            | Notes                                         |
|---------------------|-----------------|-----------------------------------------------|
| id                  | INT             | PK                                            |
| username            | VARCHAR(100)    | Username of the locked account                |
| locked_at           | TIMESTAMP       | When the lockout started                      |
| unlocked_at         | TIMESTAMP       | Nullable; NULL means still locked             |
| unlock_reason       | VARCHAR(255)    | `admin_reset` or `auto_expired`               |
| unlocked_by         | INT             | FK to users (admin who unlocked), nullable    |
| lockout_count_24h   | INT             | Number of lockouts in the last 24 hours       |
| requires_admin_reset| BOOLEAN         | True after 3+ lockouts in 24 hours            |

**session_exceptions**

| Column      | Type            | Notes                                         |
|-------------|-----------------|-----------------------------------------------|
| id          | INT             | PK, auto-increment                            |
| user_id     | INT             | FK to users                                   |
| granted_by  | INT             | FK to users (admin who granted)               |
| max_sessions| INT             | Overridden session limit                      |
| reason      | VARCHAR(500)    | Justification                                 |
| expires_at  | TIMESTAMP       | Nullable; NULL means permanent override       |
| created_at  | TIMESTAMP       |                                               |

### 3.3 Stations

**stations**

| Column          | Type            | Notes                                    |
|-----------------|-----------------|------------------------------------------|
| id              | BIGINT UNSIGNED | PK                                       |
| code            | VARCHAR(10)     | Unique short code (e.g. NYP)             |
| name            | VARCHAR(128)    | Canonical display name                   |
| normalized_name | VARCHAR(128)    | Lowercase, stripped of accents/punctuation|
| timezone        | VARCHAR(64)     | IANA timezone identifier                 |
| is_active       | BOOLEAN         |                                          |
| created_at      | DATETIME        |                                          |
| updated_at      | DATETIME        |                                          |

**station_aliases**

| Column           | Type            | Notes                                   |
|------------------|-----------------|-----------------------------------------|
| id               | BIGINT UNSIGNED | PK                                      |
| station_id       | BIGINT UNSIGNED | FK to stations                          |
| alias            | VARCHAR(128)    | Alternate name or abbreviation          |
| normalized_alias | VARCHAR(128)    | For fuzzy matching                      |

### 3.4 Trainsets

**trainsets**

| Column      | Type            | Notes                            |
|-------------|-----------------|----------------------------------|
| id          | BIGINT UNSIGNED | PK                               |
| code        | VARCHAR(20)     | Unique fleet identifier          |
| description | VARCHAR(256)    |                                  |
| total_seats | INT UNSIGNED    |                                  |
| is_active   | BOOLEAN         |                                  |
| created_at  | DATETIME        |                                  |
| updated_at  | DATETIME        |                                  |

### 3.5 Schedules & Versioning

**schedules**

| Column          | Type            | Notes                                    |
|-----------------|-----------------|------------------------------------------|
| id              | BIGINT UNSIGNED | PK                                       |
| train_number    | VARCHAR(20)     | Public-facing train identifier           |
| trainset_id     | BIGINT UNSIGNED | FK to trainsets                          |
| origin_station  | BIGINT UNSIGNED | FK to stations                           |
| dest_station    | BIGINT UNSIGNED | FK to stations                           |
| active_version  | BIGINT UNSIGNED | FK to schedule_versions, nullable        |
| created_by      | BIGINT UNSIGNED | FK to users                              |
| created_at      | DATETIME        |                                          |
| updated_at      | DATETIME        |                                          |

**schedule_versions**

| Column         | Type            | Notes                                     |
|----------------|-----------------|-------------------------------------------|
| id             | BIGINT UNSIGNED | PK                                        |
| schedule_id    | BIGINT UNSIGNED | FK to schedules                           |
| version_number | INT UNSIGNED    | Monotonically increasing per schedule     |
| status         | ENUM            | draft, pending_approval, published, archived |
| effective_from | DATETIME        | When this version becomes live            |
| effective_until| DATETIME        | Nullable; null means open-ended           |
| created_by     | BIGINT UNSIGNED | FK to users                               |
| created_at     | DATETIME        |                                           |
| published_at   | DATETIME        | Nullable                                  |
| archived_at    | DATETIME        | Nullable                                  |

**schedule_stops**

| Column       | Type            | Notes                                       |
|--------------|-----------------|---------------------------------------------|
| id           | BIGINT UNSIGNED | PK                                          |
| version_id   | BIGINT UNSIGNED | FK to schedule_versions                     |
| station_id   | BIGINT UNSIGNED | FK to stations                              |
| stop_sequence| INT UNSIGNED    | Order of the stop within the schedule       |
| arrival_time | TIME            | Nullable for origin                         |
| departure_time| TIME           | Nullable for terminus                       |
| dwell_minutes| INT UNSIGNED    | Planned dwell time at this stop             |

**seat_classes**

| Column     | Type            | Notes                                         |
|------------|-----------------|-----------------------------------------------|
| id         | BIGINT UNSIGNED | PK                                            |
| version_id | BIGINT UNSIGNED | FK to schedule_versions                       |
| name       | VARCHAR(32)     | e.g. Economy, Business, First                 |
| capacity   | INT UNSIGNED    | 1 to 500                                      |
| price      | DECIMAL(7,2)    | $1.00 to $999.00                              |

### 3.6 Approval & Rollback

**approval_requests**

| Column       | Type            | Notes                                        |
|--------------|-----------------|----------------------------------------------|
| id           | BIGINT UNSIGNED | PK                                           |
| version_id   | BIGINT UNSIGNED | FK to schedule_versions                      |
| requested_by | BIGINT UNSIGNED | FK to users (Host)                           |
| reviewed_by  | BIGINT UNSIGNED | FK to users (Platform Ops), nullable         |
| status       | ENUM            | pending, approved, rejected                  |
| comment      | TEXT            | Mandatory on rejection                       |
| requested_at | DATETIME        |                                              |
| reviewed_at  | DATETIME        | Nullable                                     |

**rollback_history**

| Column            | Type            | Notes                                  |
|-------------------|-----------------|----------------------------------------|
| id                | BIGINT UNSIGNED | PK                                     |
| schedule_id       | BIGINT UNSIGNED | FK to schedules                        |
| from_version_id   | BIGINT UNSIGNED | FK to schedule_versions                |
| to_version_id     | BIGINT UNSIGNED | FK to schedule_versions (newly created)|
| source_version_id | BIGINT UNSIGNED | Historical version being cloned        |
| rolled_back_by    | BIGINT UNSIGNED | FK to users                            |
| reason            | TEXT            |                                        |
| created_at        | DATETIME        |                                        |

### 3.7 Inventory

**inventory_items**

| Column        | Type            | Notes                                       |
|---------------|-----------------|---------------------------------------------|
| id            | BIGINT UNSIGNED | PK                                          |
| station_id    | BIGINT UNSIGNED | FK to stations                              |
| sku           | VARCHAR(64)     | Unique per station                          |
| description   | VARCHAR(256)    |                                             |
| unit_of_measure| VARCHAR(16)    | e.g. each, case, kg                         |
| tracking_mode | ENUM            | none, batch, serial                         |
| reorder_point | INT UNSIGNED    | Default 20                                  |
| unit_cost     | DECIMAL(10,2)   |                                             |
| is_active     | BOOLEAN         |                                             |
| created_at    | DATETIME        |                                             |
| updated_at    | DATETIME        |                                             |

**inventory_balances**

| Column     | Type            | Notes                                          |
|------------|-----------------|-------------------------------------------------|
| id         | BIGINT UNSIGNED | PK                                             |
| item_id    | BIGINT UNSIGNED | FK to inventory_items                          |
| on_hand    | INT             | Computed from ledger; cached for read performance |
| as_of      | DATETIME        | Timestamp of last recomputation                |

This table is a materialized cache. The authoritative balance is always the sum of all movements for a given item. A scheduled job reconciles this cache periodically.

**inventory_movements**

| Column        | Type            | Notes                                        |
|---------------|-----------------|----------------------------------------------|
| id            | BIGINT UNSIGNED | PK                                           |
| item_id       | BIGINT UNSIGNED | FK to inventory_items                        |
| type          | ENUM            | receiving, shipping, material_return, customer_return, adjustment |
| quantity      | INT             | Positive for inbound, negative for outbound  |
| unit_cost     | DECIMAL(10,2)   |                                              |
| reference_number| VARCHAR(64)   | PO number, shipment ID, etc.                 |
| notes         | TEXT            |                                              |
| performed_by  | BIGINT UNSIGNED | FK to users                                  |
| created_at    | DATETIME        |                                              |

Business rule: a movement that would take `on_hand` below zero is rejected for all types except `adjustment`.

**stock_counts**

| Column     | Type            | Notes                                          |
|------------|-----------------|-------------------------------------------------|
| id         | BIGINT UNSIGNED | PK                                             |
| station_id | BIGINT UNSIGNED | FK to stations                                 |
| status     | ENUM            | in_progress, completed, cancelled              |
| started_by | BIGINT UNSIGNED | FK to users                                    |
| started_at | DATETIME        |                                                |
| completed_at| DATETIME       | Nullable                                       |

**count_lines**

| Column          | Type            | Notes                                     |
|-----------------|-----------------|-------------------------------------------|
| id              | BIGINT UNSIGNED | PK                                        |
| count_id        | BIGINT UNSIGNED | FK to stock_counts                        |
| item_id         | BIGINT UNSIGNED | FK to inventory_items                     |
| expected_qty    | INT             | System on_hand at count start             |
| counted_qty     | INT             | Physical count entered by user            |
| variance_qty    | INT             | counted_qty - expected_qty                |
| variance_cost   | DECIMAL(10,2)   | variance_qty * unit_cost                  |
| resolved        | BOOLEAN         | Whether an adjustment movement was created|

**batch_records**

| Column       | Type            | Notes                                       |
|--------------|-----------------|---------------------------------------------|
| id           | BIGINT UNSIGNED | PK                                          |
| movement_id  | BIGINT UNSIGNED | FK to inventory_movements                   |
| batch_number | VARCHAR(64)     |                                             |
| expiry_date  | DATE            | Nullable                                    |
| quantity     | INT             |                                             |

**serial_records**

| Column       | Type            | Notes                                       |
|--------------|-----------------|---------------------------------------------|
| id           | BIGINT UNSIGNED | PK                                          |
| movement_id  | BIGINT UNSIGNED | FK to inventory_movements                   |
| serial_number| VARCHAR(128)    | Unique per item                             |
| status       | ENUM            | in_stock, shipped, returned, disposed       |

### 3.8 Backup & Recovery

**backups**

| Column       | Type            | Notes                                        |
|--------------|-----------------|----------------------------------------------|
| id           | BIGINT UNSIGNED | PK                                           |
| type         | ENUM            | full, incremental                            |
| file_path    | VARCHAR(512)    | Path on the removable drive                  |
| file_size    | BIGINT UNSIGNED | Bytes                                        |
| checksum     | CHAR(64)        | SHA-256 of the backup file                   |
| started_at   | DATETIME        |                                              |
| completed_at | DATETIME        | Nullable                                     |
| status       | ENUM            | running, completed, failed                   |
| error_message| TEXT            | Nullable                                     |

**restore_drills**

| Column         | Type            | Notes                                     |
|----------------|-----------------|-------------------------------------------|
| id             | BIGINT UNSIGNED | PK                                        |
| backup_id      | BIGINT UNSIGNED | FK to backups                             |
| target_schema  | VARCHAR(64)     | Scratch schema name                       |
| started_at     | DATETIME        |                                           |
| completed_at   | DATETIME        | Nullable                                  |
| success        | BOOLEAN         |                                           |
| row_count_match| BOOLEAN         | Whether restored row counts match source  |
| report         | JSON            | Detailed comparison results               |
| performed_by   | BIGINT UNSIGNED | FK to users                               |

### 3.9 Data Quality

**data_quality_issues**

| Column       | Type            | Notes                                        |
|--------------|-----------------|----------------------------------------------|
| id           | BIGINT UNSIGNED | PK                                           |
| table_name   | VARCHAR(64)     | Table where the issue was found              |
| record_id    | BIGINT UNSIGNED | PK of the affected row                       |
| field_name   | VARCHAR(64)     | Nullable (row-level issues)                  |
| severity     | ENUM            | critical, high, medium, low                  |
| rule_name    | VARCHAR(128)    | e.g. completeness_check, uniqueness_check    |
| description  | TEXT            |                                              |
| owner_id     | BIGINT UNSIGNED | FK to users, nullable                        |
| due_date     | DATE            | Nullable                                     |
| status       | ENUM            | open, in_progress, resolved, wont_fix        |
| resolution   | TEXT            | Corrective action documentation              |
| detected_at  | DATETIME        |                                              |
| resolved_at  | DATETIME        | Nullable                                     |

**data_quality_reports**

| Column            | Type            | Notes                                  |
|-------------------|-----------------|----------------------------------------|
| id                | BIGINT UNSIGNED | PK                                     |
| report_date       | DATE            | One report per day                     |
| total_issues      | INT UNSIGNED    |                                        |
| critical_count    | INT UNSIGNED    |                                        |
| high_count        | INT UNSIGNED    |                                        |
| tables_scanned    | INT UNSIGNED    |                                        |
| records_scanned   | BIGINT UNSIGNED |                                        |
| pass_rate         | DECIMAL(5,2)    | Percentage of records passing all rules|
| report_payload    | JSON            | Full breakdown by table and rule       |
| generated_at      | DATETIME        |                                        |

### 3.10 Audit Logs

**audit_logs**

| Column        | Type            | Notes                                       |
|---------------|-----------------|---------------------------------------------|
| id            | BIGINT UNSIGNED | PK                                          |
| user_id       | BIGINT UNSIGNED | FK to users, nullable (system actions)      |
| action        | VARCHAR(64)     | e.g. schedule.publish, inventory.receive    |
| table_name    | VARCHAR(64)     | Affected table                              |
| record_id     | BIGINT UNSIGNED | PK of affected row                          |
| old_values    | JSON            | Snapshot before mutation, nullable for creates |
| new_values    | JSON            | Snapshot after mutation                     |
| ip_address    | VARCHAR(45)     |                                             |
| session_id    | BIGINT UNSIGNED | FK to sessions, nullable                    |
| created_at    | DATETIME        |                                             |

The audit_logs table is append-only. No UPDATE or DELETE operations are permitted. A database trigger enforces this constraint.

---

## 4. Security Design

### 4.1 Authentication

- **Local credentials only.** No SSO, LDAP, or OAuth. Each user has a username and password stored as a bcrypt hash with cost factor 12.
- **No plaintext password storage or transmission.** Passwords are hashed server-side immediately upon receipt. TLS protects them in transit.

### 4.2 Session Management

| Parameter              | Value                                                    |
|------------------------|----------------------------------------------------------|
| Token format           | 256-bit cryptographically random, stored as SHA-256 hash |
| Inactivity timeout     | 8 hours since last authenticated request                 |
| Hard expiry            | 30 days from session creation                            |
| Max active sessions    | 2 per user (Platform Ops can override for specific users)|
| Token transport         | HttpOnly + Secure + SameSite=strict session cookie (Bearer header accepted as fallback for API tools) |

Sessions use a `state` field (`active` or `pending_verification`). When a new login or device verification would exceed the session cap, the request is **denied** with a `SESSION_CAP_EXCEEDED` error (HTTP 409). The user must log out of an existing session before creating a new one. Only sessions with `state='active'` and `expires_at > now` count toward the cap. `pending_verification` and expired sessions do not count. Platform Ops can grant per-user overrides via the `session_exceptions` table, raising the cap for specific users with an auditable reason.

### 4.3 Device Fingerprinting

#### Device Identity (Browser + OS + Machine Identifier)

The device fingerprint combines browser, operating-system, and hardware-correlated signals to implement the required browser + OS + machine identifier for risky-device detection:

| Signal category | Signals collected |
|-----------------|-------------------|
| **Browser** | User-Agent string, language preference |
| **OS** | `navigator.platform`, timezone |
| **Machine** | Screen geometry + color depth, logical CPU core count, WebGL GPU renderer (via `WEBGL_debug_renderer_info`), canvas rendering fingerprint |
| **Persistent key** | Random UUID stored in **IndexedDB** (primary) and **localStorage** (fallback) |

All signals are concatenated and hashed with **SHA-256** (via `crypto.subtle`) to produce a fixed-length, non-reversible device token. A mismatch against the user's `trusted_devices` records triggers the recovery-code device-verification challenge.

**Durability:** The persistent device UUID is stored in both IndexedDB and localStorage. Clearing one storage layer does not lose the device identity as long as the other is intact. This makes the identifier resilient to routine browser cache clears. In incognito mode, where both stores are ephemeral, a new-device challenge is correctly triggered — this is the safe default.

**Hardware correlation:** The WebGL renderer string and canvas rendering fingerprint provide machine-specific entropy that differs across physical hardware (GPU, driver, rendering pipeline) even when browser version and OS are identical.

**Deployment context:** RailOps operates on a closed LAN with physically present station operators. The device fingerprint is one layer in a defense-in-depth chain: username + password + device check + single-use recovery code. The threat model targets credential sharing and stolen passwords in a controlled physical environment, not adversarial fingerprint evasion from external attackers.

On login, the submitted fingerprint is compared against the user's `trusted_devices` records.

- **Known device**: Login proceeds normally.
- **New device**: The user is challenged to enter one of their pre-generated recovery codes. On success, the device is added to `trusted_devices`.

### 4.4 Recovery Codes

- Generated at user enrollment: a set of 10 single-use alphanumeric codes.
- Each code is stored as a bcrypt hash in the `recovery_codes` table.
- Codes are displayed once at enrollment and never shown again. Users are instructed to print or securely store them.
- A used code is marked `is_used = true` and cannot be reused.
- When fewer than 3 codes remain, the user is warned to request new codes from Platform Ops.

### 4.5 Progressive Lockout

| Threshold                              | Action                                      |
|----------------------------------------|---------------------------------------------|
| 5 failed attempts within 10 minutes    | Account locked for 15 minutes               |
| 3 lockouts within 24 hours             | Account locked until admin (Platform Ops) manually resets |

Lockout evaluation is per-user and per-IP. A locked IP cannot attempt login for any account. A locked user cannot log in from any IP.

### 4.6 Rate Limiting

The `/api/auth/login` endpoint is rate-limited using a token-bucket algorithm:
- **Bucket size**: 10 requests
- **Refill rate**: 1 request per 3 seconds
- Scoped per IP address
- Returns `429 Too Many Requests` with a `Retry-After` header

### 4.7 Row-Level Data Scope

All data-access queries for Host users include a station scope filter derived from `user_station_scopes`. This is enforced via a two-layer mechanism:

1. **Middleware** (`backend/src/middleware/scopeFilter.js`): Runs on every authenticated request. For Host users, it loads assigned station IDs from `user_station_scopes` and sets `ctx.state.stationScope`. Platform Ops users get `null` (no filter). Hosts with no station assignments receive a `403 Forbidden`.
2. **Route handlers** (`backend/src/routes/*.js`): Call the `applyStationScope(query, ctx.state.stationScope)` helper to add `WHERE station_id IN (...)` clauses to knex queries. This ensures data access is restricted to the stations set by the middleware.

The request flow is:

```
Request → Auth Middleware → Scope Filter Middleware → Route Handler (applies scope to queries) → Response
```

- **Hosts**: See schedules, inventory, and movements for their assigned stations only. Exception: the station lookup endpoint supports a `scope=network` query parameter that returns all active network stations for route authoring (adding stops to multi-stop routes). This does **not** grant operational access to unassigned stations' schedules or inventory.
- **Platform Ops**: No station scope filter is applied; they have cross-site visibility.
- **Guests**: See only published schedule versions through the public search endpoint.

### 4.8 Sensitive Field Masking

Fields containing personally identifiable information are masked in API responses based on the caller's role:

| Field       | Guest        | Host                       | Platform Ops |
|-------------|-------------|----------------------------|--------------|
| user.phone  | Not visible | Last 4 digits (***-**-1234)| Full value   |

Masking is applied by utility functions in `backend/src/utils/masks.js` (`maskPhone`, `maskEmail`), which are called directly from route handlers (e.g., `backend/src/routes/users.js`). The route handler passes the caller's role to the masking function, which returns the appropriately redacted value. The raw value is never sent to unauthorized roles.

### 4.9 TLS Configuration

TLS is enforced at the **server startup level** in `backend/src/index.js`, not via middleware:

1. If `TLS_CERT_PATH` and `TLS_KEY_PATH` are set, the backend creates an `https.createServer` instance with `minVersion: 'TLSv1.2'`. Only HTTPS connections are accepted.
2. If the certificates are missing and `SECURITY_MODE` is not `test`, the process exits immediately with a fatal error. **No HTTP server is started.**
3. HTTP fallback is permitted **only** when `SECURITY_MODE=test` (set automatically when `NODE_ENV=test`), for isolated test runs.

This means plain HTTP connections are impossible in any operational mode — the server either starts as HTTPS or does not start at all. There is no middleware-level HTTP rejection; TLS is a precondition of the process running.

Additional details:
- Administrators provide a TLS certificate and private key via environment variables (`TLS_CERT_PATH`, `TLS_KEY_PATH`) or mounted files.
- For development, `scripts/generate-certs.sh` (run by `npm run bootstrap`) generates a self-signed certificate into `backend/certs/`.
- The `/api/health` endpoint reports TLS status via a `tls` field (`"active"` or `"inactive"`) by inspecting `ctx.req.socket.encrypted`.

---

## 5. Guest Search Design

### 5.1 Search Interface

Guests can search published schedules without logging in. The search form provides the following filters:

| Filter       | Input                   | Required |
|-------------|-------------------------|----------|
| Origin       | Station name autocomplete| Yes      |
| Destination  | Station name autocomplete| Yes      |
| Date         | Date picker (MM/DD/YYYY)| Yes      |
| Seat class   | Dropdown (multi-select) | No       |

### 5.2 Sort Options

- Departure time (default, ascending)
- Trip duration (ascending)
- Price (ascending, based on cheapest available seat class)

### 5.3 Fuzzy Station Matching

Station name input uses a three-tier matching strategy:

1. **Exact match** on `stations.normalized_name` or `station_aliases.normalized_alias`.
2. **Prefix match** using `LIKE 'input%'` on normalized columns.
3. **Levenshtein distance** (threshold <= 2) for typo tolerance. Computed in application code against the full station + alias list (which is small enough to hold in memory).

Normalization rules: lowercase, strip accents (NFD decomposition, remove combining marks), remove punctuation, collapse whitespace.

### 5.4 Hot Search Cache (IndexedDB)

To meet the target of repeated queries completing under 200ms, the frontend caches search results in IndexedDB.

- **Cache key**: A normalized string built from sorted query parameters: `origin|destination|date|seatClasses|sort`.
- **TTL**: 1 hour from the time the result was cached.
- **Eviction**: On every cache read, entries older than TTL are deleted. A maximum of 200 entries are retained; LRU eviction applies when the limit is reached.
- **Cache invalidation**: The backend includes a `Last-Modified` header on search responses. The frontend stores this value and sends it as `If-Modified-Since` on subsequent requests. A `304 Not Modified` response means the cache is still valid.

### 5.5 Empty State

When no results match the query, the UI displays:

> "No matches found. Try nearby dates."

Below this message, the UI shows clickable date links for +/- 3 days from the searched date. Each link pre-fills the search form and runs the query. Days that also have no results are grayed out (determined by a lightweight count-only API call).

### 5.6 Performance Target

| Scenario               | Target Response Time |
|------------------------|---------------------|
| Cache hit (IndexedDB)  | < 50ms              |
| Cache miss, warm server| < 200ms             |
| Cold server start      | < 500ms             |

The backend search query is optimized with a composite index on `(origin_station, dest_station, status, effective_from)` in the `schedule_versions` table.

---

## 6. Schedule Management Design

### 6.1 Draft Workspace

Hosts create and edit schedule versions in a draft workspace. A schedule may have at most one draft version at a time. Drafts are private to the creating Host until submitted for approval.

The draft workspace supports:
- Adding, reordering, and removing stops
- Setting arrival/departure times per stop
- Defining seat classes with capacity and price
- Assigning a trainset

### 6.2 Pre-Publish Validation Checklist

Before a draft can be submitted for approval, the following validations must pass:

| Rule                      | Constraint                                              |
|---------------------------|---------------------------------------------------------|
| Minimum stops             | At least 1 intermediate stop (origin + destination + 1) |
| Time sequence             | Each stop's departure >= arrival; each stop's arrival > previous stop's departure |
| Capacity per seat class   | Between 1 and 500 inclusive                             |
| Price per seat class      | Between $1.00 and $999.00 inclusive                     |
| Trainset availability     | The assigned trainset has no overlapping published schedule for the same time window |

Validation errors are displayed inline next to the relevant field. All errors must be resolved before the "Submit for Approval" button becomes active.

### 6.3 Version Comparison

When reviewing a pending version, both Hosts and Platform Ops can open a side-by-side diff view comparing the pending version against the currently published version (or any two historical versions).

The diff highlights:
- **Added stops** in green
- **Removed stops** in red
- **Modified fields** with both old and new values highlighted in amber
- Summary statistics: number of changes, affected stops, price delta

### 6.4 Approval Flow

```
Host creates draft
  --> Host submits for approval (status: pending_approval)
    --> Platform Ops reviews
      --> Approve: status becomes published, schedule.active_version updated, previous version archived
      --> Reject: status reverts to draft, rejection comment is mandatory and stored in approval_requests
```

- Only Platform Ops users can approve or reject.
- A Host cannot approve their own submission (enforced even if a user somehow holds both roles).
- Approval and rejection create audit log entries.

### 6.5 Rollback

Platform Ops can roll back to any previously published version. The rollback process:

1. The historical version is cloned into a new `schedule_versions` row with the next version number.
2. The new version's status is set to `published` and becomes the `active_version`.
3. The previously active version is archived.
4. A `rollback_history` record is created linking the old, new, and source versions.
5. An audit log entry records the rollback, the user, and the stated reason.

Rollback does not delete any data. The full version history is always preserved.

### 6.6 Active Version Display

The currently active (published) version is clearly labeled in the UI with:
- A "LIVE" badge
- The effective-from timestamp
- The version number and who published it

---

## 7. Inventory Design

### 7.1 Movement Types

| Type             | Direction | Description                                |
|------------------|-----------|--------------------------------------------|
| receiving        | Inbound   | Goods received from a supplier             |
| shipping         | Outbound  | Goods shipped out to a destination         |
| material_return  | Inbound   | Materials returned from internal use       |
| customer_return  | Inbound   | Items returned by a customer               |
| stock_count      | Either    | Adjustment resulting from a physical count |
| adjustment       | Either    | Manual correction by authorized user       |

### 7.2 Ledger-Based Balances

Inventory balances are computed from the movement ledger, not maintained as a mutable counter. This provides a complete audit trail and enables point-in-time balance queries.

```
Balance(item, t) = SUM(movements.quantity) WHERE item_id = item AND created_at <= t
```

The `inventory_balances` table is a materialized cache that is recomputed:
- After each movement is recorded
- On a scheduled reconciliation job (every 15 minutes)

If a discrepancy between the cache and the ledger sum is detected during reconciliation, a `data_quality_issue` is raised automatically.

### 7.3 No-Negative-On-Hand Rule

For all movement types except `adjustment`, the system rejects any movement that would bring the computed on-hand quantity below zero. Adjustments are exempt because they exist specifically to correct known discrepancies.

This check is performed inside a database transaction that locks the relevant `inventory_balances` row to prevent race conditions.

### 7.4 Reorder Alerts

When a movement causes an item's on-hand balance to fall at or below its `reorder_point`, an alert is surfaced:
- In the inventory dashboard as a highlighted row
- In a dedicated "Reorder Alerts" panel accessible to Hosts

The default reorder point is 20 units. It is configurable per item by the Host.

### 7.5 Variance Alerts

During stock counts, variances are flagged when they exceed either threshold:

| Threshold         | Value                  |
|-------------------|------------------------|
| Quantity variance  | Greater than 2% of expected quantity |
| Cost variance      | Greater than $50.00 extended cost (variance_qty * unit_cost) |

Flagged variances require review before the stock count can be marked as completed. The reviewer can accept the variance (creating an adjustment movement) or recount.

### 7.6 Batch and Serial Tracking

Each inventory item has a `tracking_mode`:

- **none**: No sub-item tracking. Only quantities are recorded.
- **batch**: Each movement must include a batch number and optional expiry date via `batch_records`. Useful for consumables and dated materials.
- **serial**: Each unit must have a unique serial number via `serial_records`. The serial number's lifecycle (in_stock, shipped, returned, disposed) is tracked individually.

The tracking mode is set when the item is created and cannot be changed after the first movement is recorded (to preserve ledger integrity).

---

## 8. Backup & Recovery

### 8.1 Backup Schedule

| Type        | Frequency       | Method                        |
|-------------|-----------------|-------------------------------|
| Full backup | Nightly (02:00) | `mysqldump` with `--single-transaction --routines --triggers` |
| Incremental | Every 15 min    | MySQL binary log archival     |

### 8.2 Backup Target

Backups are written to an admin-designated removable drive path (configured via environment variable `BACKUP_TARGET_PATH`). The backup sidecar container mounts this path as a volume.

Each backup file is:
- Named with a timestamp: `railops_full_20260403_020000.sql.gz` or `railops_binlog_20260403_021500.bin`
- Compressed with gzip (full backups only)
- Checksummed with SHA-256; the checksum is stored in the `backups` table

### 8.3 Retention

- Full backups are retained for 90 days on the removable drive.
- Binary logs are retained for 30 days.
- The backup sidecar prunes expired files during each nightly run.

### 8.4 Quarterly Restore Drills

Every quarter, an administrator must perform a restore drill:

1. Select a recent full backup from the `backups` table.
2. Initiate the drill, which restores the backup into a temporary scratch schema (e.g., `railops_drill_20260403`).
3. The system compares row counts per table between the live database and the restored schema.
4. A `restore_drills` record is created with the comparison results.
5. The scratch schema is dropped after the drill completes.

The drill is logged in the audit trail. Platform Ops users receive a reminder if no drill has been performed in the current quarter.

---

## 9. Data Quality & Lineage

### 9.1 Write-Time Validations

Every write operation passes through validation functions defined in `backend/src/utils/validators.js` (e.g., `validateScheduleForPublish`, `validateMovement`, `validateSeatClass`) and called from route handlers. These validators check:

| Rule          | Description                                                    |
|---------------|----------------------------------------------------------------|
| Completeness  | Required fields are non-null and non-empty                     |
| Uniqueness    | Unique constraints are checked before insert (with a user-friendly error message, not a raw SQL error) |
| Freshness     | Timestamps are within acceptable bounds (e.g., schedule dates not more than 2 years in the past) |
| Referential   | Foreign key targets exist and are active                       |
| Domain        | Values fall within defined ranges (capacity 1-500, price $1-$999, etc.) |

Validation failures return structured error responses with field-level detail.

### 9.2 Daily Quality Reports

A scheduled job runs daily at 05:00 and scans all operational tables for quality issues:

- Missing required fields that were nullable at the database level but required by business rules
- Orphaned foreign key references (defensive check)
- Stale records (e.g., draft schedule versions older than 30 days)
- Duplicate detection on business keys
- Inventory balance cache drift from the ledger

Results are written to `data_quality_reports` and individual issues to `data_quality_issues`. The report is visible to Platform Ops on the admin dashboard.

### 9.3 Issue Tracking

Each data quality issue has:
- **Severity**: critical, high, medium, low
- **Owner**: Assigned user responsible for resolution (nullable initially, must be assigned for critical/high)
- **Due date**: Expected resolution date
- **Status**: open, in_progress, resolved, wont_fix
- **Resolution**: Free-text documentation of the corrective action taken

Platform Ops can filter, sort, and export the issues list. Issues unresolved past their due date are surfaced as overdue alerts.

### 9.4 Point-in-Time Diff and Replay

Using the `audit_logs` table (which stores old and new JSON snapshots for every mutation), the system supports:

- **Point-in-time diff**: Select two timestamps and view all changes to a specific record between them.
- **Replay view**: Step through mutations to a record chronologically, showing the state after each change.

These views are read-only and available to Platform Ops. They are useful for investigating discrepancies and understanding how a record reached its current state.

### 9.5 Corrective Action Documentation

When a data quality issue is resolved, the resolver must document:
- What was wrong
- What was done to fix it
- Whether a process change is needed to prevent recurrence

This documentation is stored in the `resolution` field of `data_quality_issues` and is included in the quarterly data quality summary report.

---

## Appendix A: Key API Endpoints

| Method | Path                                | Auth Required | Role          |
|--------|-------------------------------------|---------------|---------------|
| POST   | /api/auth/login                     | No            | Any           |
| POST   | /api/auth/logout                    | Yes           | Any           |
| POST   | /api/auth/device-challenge          | Partial       | Any           |
| GET    | /api/search                         | No            | Guest+        |
| GET    | /api/schedules                      | Yes           | Host+         |
| POST   | /api/schedules/:id/versions         | Yes           | Host          |
| POST   | /api/schedules/:id/submit           | Yes           | Host          |
| POST   | /api/schedules/:id/approve          | Yes           | Platform Ops  |
| POST   | /api/schedules/:id/reject           | Yes           | Platform Ops  |
| POST   | /api/schedules/:id/rollback         | Yes           | Platform Ops  |
| GET    | /api/inventory/items                | Yes           | Host+         |
| POST   | /api/inventory/movements            | Yes           | Host          |
| POST   | /api/inventory/counts               | Yes           | Host          |
| GET    | /api/admin/backups                  | Yes           | Platform Ops  |
| POST   | /api/admin/backups/drill            | Yes           | Platform Ops  |
| GET    | /api/admin/data-quality/reports     | Yes           | Platform Ops  |
| GET    | /api/admin/audit-logs               | Yes           | Platform Ops  |

## Appendix B: Environment Variables

| Variable             | Description                                   | Default              |
|----------------------|-----------------------------------------------|----------------------|
| DB_HOST              | MySQL hostname                                | db                   |
| DB_PORT              | MySQL port                                    | 3306                 |
| DB_NAME              | Database name                                 | railops              |
| DB_USER              | Database user                                 | railops_app          |
| DB_PASSWORD          | Database password                             | (none, required)     |
| TLS_CERT_PATH        | Path to TLS certificate file                  | /certs/server.crt    |
| TLS_KEY_PATH         | Path to TLS private key file                  | /certs/server.key    |
| BACKUP_TARGET_PATH   | Mount path for removable backup drive         | /backups             |
| SESSION_INACTIVITY_TIMEOUT | Inactivity timeout in hours              | 8                    |
| SESSION_HARD_EXPIRY  | Hard session expiry in days                   | 30                   |
| BCRYPT_COST          | bcrypt cost factor                            | 12                   |
| LOG_LEVEL            | Application log level                         | info                 |
