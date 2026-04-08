# RailOps Offline Schedule & Inventory Control Suite -- REST API Specification

**Version:** 1.0.0
**Transport:** HTTPS (TLS) over local network
**Server framework:** Koa
**Base URL:** `https://<local-host>:<port>/api`
**Content-Type:** `application/json` for all request and response bodies

---

## Table of Contents

1. [Conventions](#conventions)
2. [Authentication & Sessions](#authentication--sessions)
3. [Users & Admin](#users--admin)
4. [Stations](#stations)
5. [Trainsets](#trainsets)
6. [Trip Search (Guest)](#trip-search-guest)
7. [Schedules](#schedules)
8. [Schedule Stops](#schedule-stops)
9. [Seat Classes](#seat-classes)
10. [Approvals](#approvals)
11. [Inventory Items](#inventory-items)
12. [Inventory Movements](#inventory-movements)
13. [Stock Counts](#stock-counts)
14. [Backup & Recovery](#backup--recovery)
15. [Data Quality](#data-quality)
16. [Audit & Backtracking](#audit--backtracking)

---

## Conventions

### Roles

| Role | Code | Description |
|---|---|---|
| Guest | `guest` | Unauthenticated visitor; read-only trip search only |
| Host | `host` | Station operator; scoped to their assigned station(s) |
| Platform Ops | `platform_ops` | System administrator with full access |

### Standard Success Response

```json
{
  "success": true,
  "data": { ... }
}
```

For list endpoints the `data` field wraps a `results` array with pagination metadata:

```json
{
  "success": true,
  "data": {
    "results": [ ... ],
    "total": 142,
    "page": 1,
    "pageSize": 25
  }
}
```

### Standard Error Response

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description of the problem.",
    "details": { ... }
  }
}
```

### Common Error Codes

| HTTP Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Request body or query params failed validation |
| 401 | `UNAUTHENTICATED` | Missing or expired session token |
| 403 | `FORBIDDEN` | Authenticated but insufficient role/permissions |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `CONFLICT` | Duplicate or state-transition conflict |
| 423 | `ACCOUNT_LOCKED` | User account is locked after too many failed attempts |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

### Pagination

List endpoints accept:

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number (1-based) |
| `pageSize` | integer | `25` | Items per page (max 100) |

### Authentication Header

All authenticated endpoints require:

```
Authorization: Bearer <session_token>
```

### Audit Logging

Every state-changing request (POST, PATCH, DELETE) is recorded in the audit log automatically. The log entry captures the actor, action, target entity, timestamp, and a before/after snapshot of changed fields.

---

## Authentication & Sessions

### POST /api/auth/login

Authenticate with local credentials and receive a session token.

**Required role:** none (public)

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `username` | string | yes | 3-64 chars, alphanumeric + underscore | Local username |
| `password` | string | yes | 8-128 chars | Account password |
| `deviceFingerprint` | string | yes | non-empty | Client-generated device fingerprint |

```json
{
  "username": "jdoe",
  "password": "s3cureP@ss",
  "deviceFingerprint": "abc123-def456"
}
```

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOi...",
    "expiresAt": "2026-04-03T20:00:00Z",
    "user": {
      "id": "usr_001",
      "username": "jdoe",
      "displayName": "Jane Doe",
      "role": "host",
      "assignedStationIds": ["stn_012"]
    }
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 401 | `INVALID_CREDENTIALS` | Wrong username or password |
| 423 | `ACCOUNT_LOCKED` | Account locked after repeated failures (body includes `lockedUntil`) |
| 403 | `DEVICE_VERIFICATION_REQUIRED` | Unrecognised device fingerprint; response includes `sessionToken` to use with `/api/auth/verify-device` |
| 401 | `ENROLLMENT_REQUIRED` | User has no recovery codes generated; admin must generate codes before login is possible |

**Notable behavior:**
- Failed login attempts are counted. After 5 consecutive failures in 10 minutes, the account is locked for 15 minutes (423).
- If the device fingerprint has not been seen before for this user, the server responds with 403 `DEVICE_VERIFICATION_REQUIRED` including a `sessionToken`.
- If the user has no recovery codes, the server responds with 401 `ENROLLMENT_REQUIRED`.
- Successful login sets an HttpOnly/Secure/SameSite session cookie AND returns a Bearer token for API compatibility.
- Successful login resets the failed-attempt counter.
- Audit log records login success/failure with IP and device fingerprint.

---

### POST /api/auth/logout

Invalidate the current session token.

**Required role:** any authenticated user

**Request body:** none

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "message": "Session invalidated."
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 401 | `UNAUTHENTICATED` | Token missing or already expired |

---

### POST /api/auth/verify-device

Submit a recovery code to authorize an unrecognised device.

**Required role:** none (public, but requires a valid `sessionToken` from a prior login attempt that returned `requireDeviceVerification: true`)

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `sessionToken` | string | yes | non-empty | Token received from the login response when device verification is required |
| `code` | string | yes | 8 chars, alphanumeric | One of the user's pre-generated recovery codes |
| `deviceFingerprint` | string | yes | non-empty | Browser/device fingerprint to register as trusted |

```json
{
  "sessionToken": "a1b2c3d4-e5f6-...",
  "code": "A1B2C3D4",
  "deviceFingerprint": "fp_abc123..."
}
```

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "success": true,
    "token": "d7e8f9a0-b1c2-...",
    "user": {
      "id": 1,
      "username": "jdoe",
      "display_name": "Jane Doe",
      "role": "host",
      "phone_last4": "1234"
    }
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing `code`, `sessionToken`, or `deviceFingerprint` |
| 401 | `VERIFICATION_FAILED` | Invalid/expired session token or invalid recovery code |

**Notable behavior:**
- Each recovery code is single-use; it is consumed on successful verification.
- The device fingerprint is stored as trusted for the user after successful verification.
- The pending verification session (created during login) is deleted after successful verification.

---

### GET /api/auth/me

Return the profile of the currently authenticated user.

**Required role:** any authenticated user

**Query params:** none

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "username": "jdoe",
    "display_name": "Jane Doe",
    "role": "host",
    "phone_last4": "1234",
    "assignedStationIds": [1, 2],
    "max_sessions": 2
  }
}
```

**Response fields:**

| Field | Type | Description |
|---|---|---|
| `id` | integer | User ID (auto-increment) |
| `username` | string | Login username |
| `display_name` | string or null | User's display name |
| `role` | string | `guest`, `host`, or `platform_ops` |
| `phone_last4` | string or null | Last 4 digits of phone |
| `assignedStationIds` | integer[] | Station IDs assigned to this user (populated for `host` role) |
| `max_sessions` | integer | Maximum concurrent active sessions (default 2) |

---

### POST /api/auth/recovery-codes

Generate a fresh set of recovery codes, replacing any unused codes.

**Required role:** any authenticated user

**Request body:** none

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "codes": [
      "A1B2C3D4",
      "E5F6G7H8",
      "J9K0L1M2",
      "N3P4Q5R6",
      "S7T8U9V0"
    ],
    "generatedAt": "2026-04-03T12:00:00Z",
    "warning": "Store these codes securely. They will not be shown again."
  }
}
```

**Notable behavior:**
- All previously unused recovery codes are invalidated when new ones are generated.
- Audit log records code regeneration.

---

## Users & Admin

### GET /api/users

List all user accounts.

**Required role:** `platform_ops`

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `pageSize` | integer | `25` | Items per page (max 100) |
| `role` | string | -- | Filter by role (`host`, `platform_ops`) |
| `q` | string | -- | Search by username or display name (case-insensitive substring) |
| `locked` | boolean | -- | Filter by lock status |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "usr_001",
        "username": "jdoe",
        "displayName": "Jane Doe",
        "role": "host",
        "assignedStationIds": ["stn_012"],
        "locked": false,
        "createdAt": "2025-06-15T10:00:00Z",
        "lastLoginAt": "2026-04-03T08:14:22Z"
      }
    ],
    "total": 12,
    "page": 1,
    "pageSize": 25
  }
}
```

---

### POST /api/users

Create a new user account.

**Required role:** `platform_ops`

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `username` | string | yes | 3-64 chars, alphanumeric + underscore, unique | Login name |
| `displayName` | string | yes | 1-128 chars | Full display name |
| `password` | string | yes | 8-128 chars, must contain upper, lower, digit, and special char | Initial password |
| `role` | string | yes | one of `host`, `platform_ops` | User role |
| `assignedStationIds` | string[] | no | valid station IDs | Stations the user can manage (relevant for `host` role) |

```json
{
  "username": "bsmith",
  "displayName": "Bob Smith",
  "password": "Str0ng!Pass",
  "role": "host",
  "assignedStationIds": ["stn_012"]
}
```

**Success response (201):**

```json
{
  "success": true,
  "data": {
    "id": "usr_002",
    "username": "bsmith",
    "displayName": "Bob Smith",
    "role": "host",
    "assignedStationIds": ["stn_012"],
    "locked": false,
    "createdAt": "2026-04-03T12:30:00Z"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing/invalid fields |
| 409 | `CONFLICT` | Username already exists |

---

### PATCH /api/users/:id

Update an existing user account.

**Required role:** `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | User ID |

**Request body (all fields optional):**

| Field | Type | Validation | Description |
|---|---|---|---|
| `displayName` | string | 1-128 chars | Updated display name |
| `role` | string | `host` or `platform_ops` | Updated role |
| `assignedStationIds` | string[] | valid station IDs | Updated station assignments |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "id": "usr_002",
    "username": "bsmith",
    "displayName": "Bob Smith",
    "role": "host",
    "assignedStationIds": ["stn_012", "stn_014"],
    "locked": false,
    "createdAt": "2026-04-03T12:30:00Z"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | User ID does not exist |

---

### GET /api/users/:id/sessions

List active sessions for a user.

**Required role:** `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | User ID |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "sessionId": "sess_abc123",
        "deviceFingerprint": "abc123-def456",
        "ipAddress": "192.168.1.42",
        "createdAt": "2026-04-03T08:14:22Z",
        "expiresAt": "2026-04-03T20:00:00Z",
        "lastActivityAt": "2026-04-03T11:45:00Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 25
  }
}
```

---

### DELETE /api/users/:id/sessions/:sessionId

Revoke a specific session for a user.

**Required role:** `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | User ID |
| `sessionId` | string | Session ID to revoke |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "message": "Session revoked."
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | User or session not found |

---

### POST /api/users/:id/session-exception

Grant a temporary session-limit exception, allowing the user to exceed the normal concurrent-session cap.

**Required role:** `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | User ID |

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `maxSessions` | integer | yes | 2-10 | Temporary maximum concurrent sessions |
| `expiresAt` | string (ISO 8601) | yes | must be in the future | When the exception expires |
| `reason` | string | yes | 1-500 chars | Justification for the exception |

```json
{
  "maxSessions": 5,
  "expiresAt": "2026-04-10T23:59:59Z",
  "reason": "User managing multiple terminals during holiday surge."
}
```

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "userId": "usr_002",
    "maxSessions": 5,
    "expiresAt": "2026-04-10T23:59:59Z",
    "grantedBy": "usr_001",
    "grantedAt": "2026-04-03T13:00:00Z"
  }
}
```

---

### POST /api/users/:id/unlock

Unlock a user account that was locked due to repeated failed login attempts.

**Required role:** `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | User ID |

**Request body:** none

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "userId": "usr_002",
    "locked": false,
    "unlockedBy": "usr_001",
    "unlockedAt": "2026-04-03T13:05:00Z"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | User ID does not exist |
| 409 | `CONFLICT` | Account is not currently locked |

**Notable behavior:**
- Resets the failed-login counter to zero.
- Audit log records the unlock action.

---

### POST /api/users/:id/reset-password

Reset a user's password administratively. The user will be required to change it on next login.

**Required role:** `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | User ID |

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `newPassword` | string | yes | 8-128 chars, complexity rules apply | The new temporary password |

```json
{
  "newPassword": "T3mpP@ss!2026"
}
```

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "userId": "usr_002",
    "mustChangePassword": true,
    "resetBy": "usr_001",
    "resetAt": "2026-04-03T13:10:00Z"
  }
}
```

**Notable behavior:**
- All active sessions for the target user are invalidated immediately.
- The user's `mustChangePassword` flag is set to `true`; the next login will enforce a password change before any other action is allowed.
- Audit log records the password reset (without capturing the password itself).

---

## Stations

### GET /api/stations

List stations.

**Required role:** any authenticated user

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `pageSize` | integer | `25` | Items per page (max 100) |
| `q` | string | -- | Fuzzy search by station name or code. Uses trigram similarity; results are ranked by match score. |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "stn_012",
        "code": "KGX",
        "name": "King's Cross",
        "timezone": "Europe/London",
        "platforms": 12,
        "coordinates": { "lat": 51.5320, "lng": -0.1240 },
        "active": true,
        "createdAt": "2025-01-10T08:00:00Z",
        "updatedAt": "2025-11-02T14:30:00Z"
      }
    ],
    "total": 48,
    "page": 1,
    "pageSize": 25
  }
}
```

---

### GET /api/stations/:id

Get full details for a single station.

**Required role:** any authenticated user

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Station ID |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "id": "stn_012",
    "code": "KGX",
    "name": "King's Cross",
    "timezone": "Europe/London",
    "platforms": 12,
    "coordinates": { "lat": 51.5320, "lng": -0.1240 },
    "active": true,
    "assignedHosts": [
      { "id": "usr_002", "displayName": "Bob Smith" }
    ],
    "createdAt": "2025-01-10T08:00:00Z",
    "updatedAt": "2025-11-02T14:30:00Z"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | Station ID does not exist |

---

### POST /api/stations

Create a new station.

**Required role:** `platform_ops`

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `code` | string | yes | 2-10 chars, uppercase alphanumeric, unique | Short station code |
| `name` | string | yes | 1-200 chars, unique | Full station name |
| `timezone` | string | yes | valid IANA timezone | Station's local timezone |
| `platforms` | integer | yes | 1-100 | Number of platforms |
| `coordinates` | object | no | `{ lat: number, lng: number }` | Geographic coordinates |

```json
{
  "code": "PAD",
  "name": "Paddington",
  "timezone": "Europe/London",
  "platforms": 14,
  "coordinates": { "lat": 51.5154, "lng": -0.1755 }
}
```

**Success response (201):**

```json
{
  "success": true,
  "data": {
    "id": "stn_049",
    "code": "PAD",
    "name": "Paddington",
    "timezone": "Europe/London",
    "platforms": 14,
    "coordinates": { "lat": 51.5154, "lng": -0.1755 },
    "active": true,
    "createdAt": "2026-04-03T14:00:00Z",
    "updatedAt": "2026-04-03T14:00:00Z"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing or invalid fields |
| 409 | `CONFLICT` | Station code or name already exists |

---

### PATCH /api/stations/:id

Update station details.

**Required role:** `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Station ID |

**Request body (all fields optional):**

| Field | Type | Validation | Description |
|---|---|---|---|
| `name` | string | 1-200 chars | Updated name |
| `timezone` | string | valid IANA timezone | Updated timezone |
| `platforms` | integer | 1-100 | Updated platform count |
| `coordinates` | object | `{ lat: number, lng: number }` | Updated coordinates |
| `active` | boolean | -- | Enable/disable station |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "id": "stn_049",
    "code": "PAD",
    "name": "London Paddington",
    "timezone": "Europe/London",
    "platforms": 14,
    "coordinates": { "lat": 51.5154, "lng": -0.1755 },
    "active": true,
    "createdAt": "2026-04-03T14:00:00Z",
    "updatedAt": "2026-04-03T14:10:00Z"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | Station ID does not exist |

---

## Trainsets

### GET /api/trainsets

List trainsets.

**Required role:** any authenticated user

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `pageSize` | integer | `25` | Items per page (max 100) |
| `status` | string | -- | Filter: `active`, `maintenance`, `retired` |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "ts_001",
        "code": "IC225-A",
        "name": "InterCity 225 Alpha",
        "type": "electric",
        "cars": 9,
        "totalSeats": 478,
        "status": "active",
        "homeStationId": "stn_012",
        "createdAt": "2025-03-01T09:00:00Z",
        "updatedAt": "2026-01-15T11:30:00Z"
      }
    ],
    "total": 24,
    "page": 1,
    "pageSize": 25
  }
}
```

---

### POST /api/trainsets

Create a new trainset.

**Required role:** `host` or `platform_ops`

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `code` | string | yes | 2-20 chars, unique | Trainset code |
| `name` | string | yes | 1-200 chars | Display name |
| `type` | string | yes | `electric`, `diesel`, `hybrid` | Propulsion type |
| `cars` | integer | yes | 1-30 | Number of cars |
| `totalSeats` | integer | yes | 1-2000 | Total seat capacity |
| `status` | string | no | `active`, `maintenance`, `retired` (default: `active`) | Operational status |
| `homeStationId` | string | yes | valid station ID | Home depot station |

**Success response (201):**

```json
{
  "success": true,
  "data": {
    "id": "ts_025",
    "code": "HST-B",
    "name": "High Speed Train Bravo",
    "type": "diesel",
    "cars": 8,
    "totalSeats": 400,
    "status": "active",
    "homeStationId": "stn_012",
    "createdAt": "2026-04-03T14:20:00Z",
    "updatedAt": "2026-04-03T14:20:00Z"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing or invalid fields |
| 409 | `CONFLICT` | Trainset code already exists |

---

### PATCH /api/trainsets/:id

Update trainset details.

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Trainset ID |

**Request body (all fields optional):**

| Field | Type | Validation | Description |
|---|---|---|---|
| `name` | string | 1-200 chars | Updated name |
| `type` | string | `electric`, `diesel`, `hybrid` | Updated propulsion type |
| `cars` | integer | 1-30 | Updated car count |
| `totalSeats` | integer | 1-2000 | Updated seat capacity |
| `status` | string | `active`, `maintenance`, `retired` | Updated status |
| `homeStationId` | string | valid station ID | Updated home station |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "id": "ts_025",
    "code": "HST-B",
    "name": "High Speed Train Bravo",
    "type": "diesel",
    "cars": 8,
    "totalSeats": 400,
    "status": "maintenance",
    "homeStationId": "stn_012",
    "createdAt": "2026-04-03T14:20:00Z",
    "updatedAt": "2026-04-03T15:00:00Z"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | Trainset ID does not exist |

---

## Trip Search (Guest)

These endpoints are publicly accessible and do not require authentication. They operate on published schedule data only.

### GET /api/trips/search

Search for published trips between two stations on a given date.

**Required role:** none (public/guest)

**Query params:**

| Param | Type | Required | Validation | Description |
|---|---|---|---|---|
| `origin` | string | yes | valid station ID or code | Departure station |
| `destination` | string | yes | valid station ID or code | Arrival station |
| `date` | string | yes | format `MM/DD/YYYY`, must not be in the past | Travel date |
| `seatClass` | string | no | valid seat class slug (e.g. `economy`, `business`, `first`) | Filter by seat class |
| `sort` | string | no | `departure` (default), `duration`, `price` | Sort field |
| `order` | string | no | `asc` (default), `desc` | Sort direction |
| `page` | integer | no | default `1` | Page number |
| `pageSize` | integer | no | default `25`, max 50 | Results per page |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "tripId": "trip_9a3f",
        "scheduleId": "sch_007",
        "trainsetCode": "IC225-A",
        "origin": {
          "stationId": "stn_012",
          "stationCode": "KGX",
          "stationName": "King's Cross",
          "departureTime": "2026-04-05T08:30:00Z",
          "platform": 3
        },
        "destination": {
          "stationId": "stn_020",
          "stationCode": "EDN",
          "stationName": "Edinburgh Waverley",
          "arrivalTime": "2026-04-05T12:55:00Z",
          "platform": 7
        },
        "durationMinutes": 265,
        "stops": 4,
        "seatClasses": [
          { "slug": "economy", "name": "Standard", "priceMinor": 4500, "currency": "GBP", "availableSeats": 120 },
          { "slug": "first", "name": "First Class", "priceMinor": 12000, "currency": "GBP", "availableSeats": 18 }
        ]
      }
    ],
    "total": 6,
    "page": 1,
    "pageSize": 25,
    "nearbyDateSuggestions": []
  }
}
```

When no results are found for the requested date, `results` is empty and `nearbyDateSuggestions` contains up to 3 alternate dates (within +/- 3 days) that have matching trips:

```json
{
  "success": true,
  "data": {
    "results": [],
    "total": 0,
    "page": 1,
    "pageSize": 25,
    "nearbyDateSuggestions": [
      { "date": "04/04/2026", "tripCount": 3 },
      { "date": "04/06/2026", "tripCount": 5 }
    ]
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing required params, invalid date format, origin equals destination |

---

### GET /api/trips/hot-searches

Get a list of popular recent search combinations for quick-access display.

**Required role:** none (public/guest)

**Query params:** none

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "origin": { "stationId": "stn_012", "stationCode": "KGX", "stationName": "King's Cross" },
        "destination": { "stationId": "stn_020", "stationCode": "EDN", "stationName": "Edinburgh Waverley" },
        "searchCount": 342
      },
      {
        "origin": { "stationId": "stn_049", "stationCode": "PAD", "stationName": "Paddington" },
        "destination": { "stationId": "stn_055", "stationCode": "BRI", "stationName": "Bristol Temple Meads" },
        "searchCount": 215
      }
    ]
  }
}
```

**Notable behavior:**
- Results are computed from aggregated anonymous search data over the last 7 days.
- Maximum of 10 entries returned, sorted by `searchCount` descending.

---

## Schedules

### GET /api/schedules

List schedules.

**Required role:** `host` or `platform_ops`

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `pageSize` | integer | `25` | Items per page (max 100) |
| `status` | string | -- | Filter: `draft`, `pending_approval`, `published`, `archived` |
| `stationId` | string | -- | Filter by station (Hosts are automatically scoped to their assigned stations) |
| `trainsetId` | string | -- | Filter by trainset |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "sch_007",
        "name": "KGX-EDN Morning Express",
        "trainsetId": "ts_001",
        "status": "published",
        "currentVersionId": "ver_014",
        "currentVersionNumber": 3,
        "effectiveFrom": "2026-03-01",
        "effectiveTo": "2026-06-30",
        "createdBy": "usr_001",
        "createdAt": "2025-12-01T10:00:00Z",
        "updatedAt": "2026-03-01T06:00:00Z"
      }
    ],
    "total": 34,
    "page": 1,
    "pageSize": 25
  }
}
```

**Notable behavior:**
- Host users only see schedules that include at least one stop at a station they are assigned to.

---

### POST /api/schedules

Create a new schedule (starts as a draft with version 1).

**Required role:** `host` or `platform_ops`

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `name` | string | yes | 1-200 chars | Schedule display name |
| `trainsetId` | string | yes | valid trainset ID | Assigned trainset |
| `effectiveFrom` | string | yes | `YYYY-MM-DD`, must be today or later | Start of effective period |
| `effectiveTo` | string | yes | `YYYY-MM-DD`, must be after `effectiveFrom` | End of effective period |
| `daysOfWeek` | integer[] | yes | array of 0-6 (0 = Sunday) | Days the schedule runs |

```json
{
  "name": "PAD-BRI Afternoon Service",
  "trainsetId": "ts_025",
  "effectiveFrom": "2026-05-01",
  "effectiveTo": "2026-08-31",
  "daysOfWeek": [1, 2, 3, 4, 5]
}
```

**Success response (201):**

```json
{
  "success": true,
  "data": {
    "id": "sch_035",
    "name": "PAD-BRI Afternoon Service",
    "trainsetId": "ts_025",
    "status": "draft",
    "currentVersionId": "ver_050",
    "currentVersionNumber": 1,
    "effectiveFrom": "2026-05-01",
    "effectiveTo": "2026-08-31",
    "daysOfWeek": [1, 2, 3, 4, 5],
    "createdBy": "usr_002",
    "createdAt": "2026-04-03T15:00:00Z",
    "updatedAt": "2026-04-03T15:00:00Z"
  }
}
```

---

### GET /api/schedules/:id

Get a schedule with its current (latest) version details.

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Schedule ID |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "id": "sch_007",
    "name": "KGX-EDN Morning Express",
    "trainsetId": "ts_001",
    "status": "published",
    "effectiveFrom": "2026-03-01",
    "effectiveTo": "2026-06-30",
    "daysOfWeek": [1, 2, 3, 4, 5, 6],
    "createdBy": "usr_001",
    "createdAt": "2025-12-01T10:00:00Z",
    "updatedAt": "2026-03-01T06:00:00Z",
    "currentVersion": {
      "id": "ver_014",
      "versionNumber": 3,
      "status": "published",
      "publishedAt": "2026-03-01T06:00:00Z",
      "publishedBy": "usr_001",
      "stops": [ ... ],
      "seatClasses": [ ... ]
    }
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | Schedule ID does not exist |
| 403 | `FORBIDDEN` | Host user not assigned to any station in this schedule |

---

### PATCH /api/schedules/:id

Update schedule-level metadata (not version content).

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Schedule ID |

**Request body (all fields optional):**

| Field | Type | Validation | Description |
|---|---|---|---|
| `name` | string | 1-200 chars | Updated name |
| `trainsetId` | string | valid trainset ID | Reassign trainset |
| `effectiveFrom` | string | `YYYY-MM-DD` | Updated start date |
| `effectiveTo` | string | `YYYY-MM-DD`, after `effectiveFrom` | Updated end date |
| `daysOfWeek` | integer[] | array of 0-6 | Updated running days |

**Success response (200):** returns the full updated schedule object (same shape as GET).

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | Schedule ID does not exist |
| 409 | `CONFLICT` | Cannot modify metadata of a published schedule without creating a new version |

---

### GET /api/schedules/:id/versions

List all versions of a schedule.

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Schedule ID |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "ver_014",
        "versionNumber": 3,
        "status": "published",
        "createdBy": "usr_001",
        "createdAt": "2026-02-25T09:00:00Z",
        "publishedAt": "2026-03-01T06:00:00Z"
      },
      {
        "id": "ver_010",
        "versionNumber": 2,
        "status": "superseded",
        "createdBy": "usr_001",
        "createdAt": "2026-01-15T11:00:00Z",
        "publishedAt": "2026-02-01T06:00:00Z",
        "supersededAt": "2026-03-01T06:00:00Z"
      },
      {
        "id": "ver_005",
        "versionNumber": 1,
        "status": "superseded",
        "createdBy": "usr_002",
        "createdAt": "2025-12-01T10:00:00Z",
        "publishedAt": "2025-12-15T06:00:00Z",
        "supersededAt": "2026-02-01T06:00:00Z"
      }
    ],
    "total": 3,
    "page": 1,
    "pageSize": 25
  }
}
```

---

### GET /api/schedules/:id/versions/:versionId

Get full details of a specific version including stops and seat classes.

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Schedule ID |
| `versionId` | string | Version ID |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "id": "ver_014",
    "scheduleId": "sch_007",
    "versionNumber": 3,
    "status": "published",
    "createdBy": "usr_001",
    "createdAt": "2026-02-25T09:00:00Z",
    "publishedAt": "2026-03-01T06:00:00Z",
    "stops": [
      {
        "id": "stop_001",
        "sequence": 1,
        "stationId": "stn_012",
        "stationCode": "KGX",
        "stationName": "King's Cross",
        "arrivalTime": null,
        "departureTime": "08:30",
        "platform": 3,
        "dwellMinutes": null
      },
      {
        "id": "stop_002",
        "sequence": 2,
        "stationId": "stn_018",
        "stationCode": "YRK",
        "stationName": "York",
        "arrivalTime": "10:15",
        "departureTime": "10:20",
        "platform": 5,
        "dwellMinutes": 5
      },
      {
        "id": "stop_003",
        "sequence": 3,
        "stationId": "stn_020",
        "stationCode": "EDN",
        "stationName": "Edinburgh Waverley",
        "arrivalTime": "12:55",
        "departureTime": null,
        "platform": 7,
        "dwellMinutes": null
      }
    ],
    "seatClasses": [
      {
        "id": "sc_001",
        "slug": "economy",
        "name": "Standard",
        "capacity": 350,
        "priceMinor": 4500,
        "currency": "GBP"
      },
      {
        "id": "sc_002",
        "slug": "first",
        "name": "First Class",
        "capacity": 48,
        "priceMinor": 12000,
        "currency": "GBP"
      }
    ]
  }
}
```

---

### POST /api/schedules/:id/versions

Create a new draft version, optionally cloning from an existing version.

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Schedule ID |

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `cloneFromVersionId` | string | no | valid version ID belonging to this schedule | Copy stops and seat classes from this version |

```json
{
  "cloneFromVersionId": "ver_014"
}
```

**Success response (201):**

```json
{
  "success": true,
  "data": {
    "id": "ver_051",
    "scheduleId": "sch_007",
    "versionNumber": 4,
    "status": "draft",
    "createdBy": "usr_001",
    "createdAt": "2026-04-03T15:30:00Z",
    "stops": [ ... ],
    "seatClasses": [ ... ]
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 409 | `CONFLICT` | A draft version already exists for this schedule (only one draft at a time) |

---

### PATCH /api/schedules/:id/versions/:versionId

Update a draft version's general notes or metadata.

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Schedule ID |
| `versionId` | string | Version ID |

**Request body (all fields optional):**

| Field | Type | Validation | Description |
|---|---|---|---|
| `notes` | string | 0-2000 chars | Internal notes about this version |

**Success response (200):** returns the updated version object.

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 409 | `CONFLICT` | Version is not in `draft` status |

---

### POST /api/schedules/:id/versions/:versionId/validate

Run the pre-publish validation checklist on a draft version.

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Schedule ID |
| `versionId` | string | Version ID |

**Request body:** none

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "valid": false,
    "checks": [
      { "name": "minimum_two_stops", "passed": true, "message": "Schedule has 3 stops." },
      { "name": "departure_before_arrival", "passed": true, "message": "All timing sequences are valid." },
      { "name": "at_least_one_seat_class", "passed": true, "message": "2 seat classes defined." },
      { "name": "total_capacity_matches_trainset", "passed": false, "message": "Total seat class capacity (398) does not match trainset capacity (478). Difference: 80 seats unassigned." },
      { "name": "no_overlapping_schedules", "passed": true, "message": "No conflicting schedules for this trainset in the effective period." },
      { "name": "platform_availability", "passed": true, "message": "All platforms are available at scheduled times." }
    ]
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 409 | `CONFLICT` | Version is not in `draft` status |

---

### POST /api/schedules/:id/versions/:versionId/publish

Directly publish a validated draft version (bypassing approval workflow).

**Required role:** `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Schedule ID |
| `versionId` | string | Version ID |

**Request body:** none

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "id": "ver_051",
    "scheduleId": "sch_007",
    "versionNumber": 4,
    "status": "published",
    "publishedAt": "2026-04-03T16:00:00Z",
    "publishedBy": "usr_001"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 409 | `CONFLICT` | Version is not in `draft` status |
| 422 | `VALIDATION_FAILED` | Pre-publish validation has not been run or has failing checks |

**Notable behavior:**
- The previously published version (if any) is moved to `superseded` status.
- The schedule's `status` field is updated to `published`.
- Audit log records the publish action.

---

### POST /api/schedules/:id/versions/:versionId/request-approval

Submit a draft version for Platform Ops approval.

**Required role:** `host`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Schedule ID |
| `versionId` | string | Version ID |

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `comment` | string | no | 0-2000 chars | Optional note for the reviewer |

```json
{
  "comment": "Updated York dwell time to 5 minutes per ops request."
}
```

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "approvalId": "apr_012",
    "scheduleId": "sch_007",
    "versionId": "ver_051",
    "status": "pending",
    "requestedBy": "usr_002",
    "requestedAt": "2026-04-03T16:10:00Z",
    "comment": "Updated York dwell time to 5 minutes per ops request."
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 409 | `CONFLICT` | Version is not in `draft` status or already has a pending approval |
| 422 | `VALIDATION_FAILED` | Pre-publish validation has not passed |

**Notable behavior:**
- The version status changes to `pending_approval`.
- The schedule status changes to `pending_approval`.

---

### GET /api/schedules/:id/versions/compare

Compare two versions of a schedule, returning a structured diff.

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Schedule ID |

**Query params:**

| Param | Type | Required | Description |
|---|---|---|---|
| `v1` | string | yes | First version ID (typically the older one) |
| `v2` | string | yes | Second version ID (typically the newer one) |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "scheduleId": 7,
    "v1": { "id": 10, "version_number": 2, "status": "published" },
    "v2": { "id": 14, "version_number": 3, "status": "draft" },
    "stops": [
      {
        "key": "stop-5",
        "change": "changed",
        "v1": { "sequence": 2, "station": 5, "departure_at": "2026-04-03T10:18:00", "arrival_at": "2026-04-03T10:15:00", "platform": "3" },
        "v2": { "sequence": 2, "station": 5, "departure_at": "2026-04-03T10:20:00", "arrival_at": "2026-04-03T10:17:00", "platform": "3" }
      }
    ],
    "seatClasses": [
      {
        "key": "class-economy",
        "change": "changed",
        "v1": { "class_code": "economy", "capacity": 200, "fare": 40.00 },
        "v2": { "class_code": "economy", "capacity": 200, "fare": 45.00 }
      }
    ]
  }
}
```

Each entry in `stops` and `seatClasses` has `key`, `change` (`added`, `removed`, or `changed`), `v1` (null if added), and `v2` (null if removed).

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing `v1` or `v2` param |
| 404 | `NOT_FOUND` | One or both version IDs do not exist or don't belong to this schedule |

---

### POST /api/schedules/:id/rollback

Rollback the published version to a prior version.

**Required role:** `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Schedule ID |

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `sourceVersionId` | string | yes | valid version ID belonging to this schedule | Version to restore as published |
| `reason` | string | yes | 1-2000 chars | Justification for the rollback |

```json
{
  "sourceVersionId": "ver_010",
  "reason": "New timetable caused platform conflicts at York. Reverting to prior version while investigating."
}
```

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "id": "ver_052",
    "scheduleId": "sch_007",
    "versionNumber": 5,
    "status": "published",
    "rolledBackFrom": "ver_014",
    "rolledBackTo": "ver_010",
    "reason": "New timetable caused platform conflicts at York. Reverting to prior version while investigating.",
    "publishedAt": "2026-04-03T17:00:00Z",
    "publishedBy": "usr_001"
  }
}
```

**Notable behavior:**
- A rollback creates a new version (cloned from the source) and publishes it immediately. It does not rewrite history.
- The previously published version moves to `superseded` status.
- Audit log records the rollback with the reason.

---

## Schedule Stops

All stop endpoints operate within a specific draft version. Stops cannot be modified on published or pending-approval versions.

### GET /api/schedules/:id/versions/:versionId/stops

List all stops in a version, ordered by sequence.

**Required role:** `host` or `platform_ops`

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "stop_001",
        "sequence": 1,
        "stationId": "stn_012",
        "stationCode": "KGX",
        "stationName": "King's Cross",
        "arrivalTime": null,
        "departureTime": "08:30",
        "platform": 3,
        "dwellMinutes": null
      }
    ]
  }
}
```

---

### POST /api/schedules/:id/versions/:versionId/stops

Add a stop to the draft version.

**Required role:** `host` or `platform_ops`

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `stationId` | string | yes | valid station ID | Station for this stop |
| `sequence` | integer | yes | >= 1, unique within version | Order position |
| `arrivalTime` | string | no | `HH:mm` 24-hour format; required for all stops except first | Arrival time (local to station timezone) |
| `departureTime` | string | no | `HH:mm` 24-hour format; required for all stops except last | Departure time (local to station timezone) |
| `platform` | integer | no | >= 1 | Assigned platform number |
| `dwellMinutes` | integer | no | >= 0 | Dwell time at station (auto-calculated from arrival/departure if omitted) |

```json
{
  "stationId": "stn_018",
  "sequence": 2,
  "arrivalTime": "10:15",
  "departureTime": "10:20",
  "platform": 5
}
```

**Success response (201):**

```json
{
  "success": true,
  "data": {
    "id": "stop_004",
    "sequence": 2,
    "stationId": "stn_018",
    "stationCode": "YRK",
    "stationName": "York",
    "arrivalTime": "10:15",
    "departureTime": "10:20",
    "platform": 5,
    "dwellMinutes": 5
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 409 | `CONFLICT` | Version is not in `draft` status; duplicate sequence number; duplicate station in version |

**Notable behavior:**
- If `dwellMinutes` is omitted and both arrival/departure times are provided, it is computed automatically.
- Adding a stop at an existing sequence shifts subsequent stops' sequences up by 1.

---

### PATCH /api/schedules/:id/versions/:versionId/stops/:stopId

Update a stop.

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Schedule ID |
| `versionId` | string | Version ID |
| `stopId` | string | Stop ID |

**Request body (all fields optional):**

| Field | Type | Validation | Description |
|---|---|---|---|
| `sequence` | integer | >= 1 | Updated sequence |
| `arrivalTime` | string | `HH:mm` | Updated arrival |
| `departureTime` | string | `HH:mm` | Updated departure |
| `platform` | integer | >= 1 | Updated platform |
| `dwellMinutes` | integer | >= 0 | Updated dwell time |

**Success response (200):** returns the updated stop object.

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | Stop not found in this version |
| 409 | `CONFLICT` | Version is not in `draft` status |

---

### DELETE /api/schedules/:id/versions/:versionId/stops/:stopId

Remove a stop from the draft version.

**Required role:** `host` or `platform_ops`

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "message": "Stop removed.",
    "deletedStopId": "stop_004"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | Stop not found |
| 409 | `CONFLICT` | Version is not in `draft` status |

**Notable behavior:**
- Remaining stops are re-sequenced automatically to close the gap.

---

## Seat Classes

All seat-class endpoints operate within a specific draft version.

### GET /api/schedules/:id/versions/:versionId/seat-classes

List seat classes for a version.

**Required role:** `host` or `platform_ops`

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "sc_001",
        "slug": "economy",
        "name": "Standard",
        "capacity": 350,
        "priceMinor": 4500,
        "currency": "GBP"
      }
    ]
  }
}
```

---

### POST /api/schedules/:id/versions/:versionId/seat-classes

Add a seat class to the draft version.

**Required role:** `host` or `platform_ops`

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `slug` | string | yes | 2-30 chars, lowercase alphanumeric + underscore, unique within version | Machine-friendly identifier |
| `name` | string | yes | 1-100 chars | Display name |
| `capacity` | integer | yes | >= 1 | Number of seats |
| `priceMinor` | integer | yes | >= 0 | Price in minor currency units (e.g. pence, cents) |
| `currency` | string | yes | ISO 4217 3-letter code | Currency code |

```json
{
  "slug": "business",
  "name": "Business Class",
  "capacity": 80,
  "priceMinor": 7500,
  "currency": "GBP"
}
```

**Success response (201):**

```json
{
  "success": true,
  "data": {
    "id": "sc_003",
    "slug": "business",
    "name": "Business Class",
    "capacity": 80,
    "priceMinor": 7500,
    "currency": "GBP"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 409 | `CONFLICT` | Version is not in `draft` status; duplicate slug within version |

---

### PATCH /api/schedules/:id/versions/:versionId/seat-classes/:classId

Update a seat class.

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Schedule ID |
| `versionId` | string | Version ID |
| `classId` | string | Seat class ID |

**Request body (all fields optional):**

| Field | Type | Validation | Description |
|---|---|---|---|
| `name` | string | 1-100 chars | Updated display name |
| `capacity` | integer | >= 1 | Updated seat count |
| `priceMinor` | integer | >= 0 | Updated price |
| `currency` | string | ISO 4217 | Updated currency |

**Success response (200):** returns the updated seat class object.

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | Seat class not found in this version |
| 409 | `CONFLICT` | Version is not in `draft` status |

---

### DELETE /api/schedules/:id/versions/:versionId/seat-classes/:classId

Remove a seat class from the draft version.

**Required role:** `host` or `platform_ops`

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "message": "Seat class removed.",
    "deletedClassId": "sc_003"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | Seat class not found |
| 409 | `CONFLICT` | Version is not in `draft` status |

---

## Approvals

### GET /api/approvals

List pending (and optionally historical) approval requests.

**Required role:** `platform_ops`

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `pageSize` | integer | `25` | Items per page (max 100) |
| `status` | string | `pending` | Filter: `pending`, `approved`, `rejected`, `all` |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "apr_012",
        "scheduleId": "sch_007",
        "scheduleName": "KGX-EDN Morning Express",
        "versionId": "ver_051",
        "versionNumber": 4,
        "status": "pending",
        "requestedBy": {
          "id": "usr_002",
          "displayName": "Bob Smith"
        },
        "requestedAt": "2026-04-03T16:10:00Z",
        "comment": "Updated York dwell time to 5 minutes per ops request.",
        "reviewedBy": null,
        "reviewedAt": null,
        "reviewComment": null
      }
    ],
    "total": 3,
    "page": 1,
    "pageSize": 25
  }
}
```

---

### POST /api/approvals/:id/approve

Approve a pending schedule version.

**Required role:** `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Approval ID |

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `comment` | string | no | 0-2000 chars | Optional reviewer note |

```json
{
  "comment": "Looks good. Approved for publication."
}
```

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "id": "apr_012",
    "status": "approved",
    "reviewedBy": {
      "id": "usr_001",
      "displayName": "Jane Doe"
    },
    "reviewedAt": "2026-04-03T17:00:00Z",
    "reviewComment": "Looks good. Approved for publication."
  }
}
```

**Notable behavior:**
- On approval, the associated version is automatically published; any previously published version becomes `superseded`.
- The schedule's `status` field is updated to `published`.
- Audit log records the approval and publish.

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | Approval ID does not exist |
| 409 | `CONFLICT` | Approval is not in `pending` status |

---

### POST /api/approvals/:id/reject

Reject a pending schedule version.

**Required role:** `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Approval ID |

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `comment` | string | yes | 1-2000 chars | Reason for rejection (required) |

```json
{
  "comment": "Platform 5 at York is under maintenance during this period. Please reassign."
}
```

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "id": "apr_012",
    "status": "rejected",
    "reviewedBy": {
      "id": "usr_001",
      "displayName": "Jane Doe"
    },
    "reviewedAt": "2026-04-03T17:05:00Z",
    "reviewComment": "Platform 5 at York is under maintenance during this period. Please reassign."
  }
}
```

**Notable behavior:**
- The associated version reverts to `draft` status so the Host can make corrections.
- The schedule's `status` reverts to `draft`.

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Comment is required but missing |
| 404 | `NOT_FOUND` | Approval ID does not exist |
| 409 | `CONFLICT` | Approval is not in `pending` status |

---

## Inventory Items

### GET /api/inventory/items

List inventory items.

**Required role:** `host` or `platform_ops`

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `pageSize` | integer | `25` | Items per page (max 100) |
| `stationId` | string | -- | Filter by station (Hosts are auto-scoped to assigned stations) |
| `q` | string | -- | Search by item name or SKU (case-insensitive substring) |
| `belowReorder` | boolean | -- | If `true`, return only items whose current balance is at or below their reorder point |
| `trackingMode` | string | -- | Filter: `batch`, `serial`, `none` |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "itm_001",
        "sku": "BRKPAD-001",
        "name": "Brake Pad Set - Type A",
        "description": "Standard brake pads for IC225 bogies",
        "unit": "set",
        "trackingMode": "batch",
        "stationId": "stn_012",
        "stationName": "King's Cross",
        "currentBalance": 42,
        "reorderPoint": 20,
        "createdAt": "2025-06-01T09:00:00Z",
        "updatedAt": "2026-04-02T16:30:00Z"
      }
    ],
    "total": 156,
    "page": 1,
    "pageSize": 25
  }
}
```

---

### POST /api/inventory/items

Create a new inventory item.

**Required role:** `host` or `platform_ops`

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `sku` | string | yes | 1-50 chars, unique per station | Stock keeping unit code |
| `name` | string | yes | 1-200 chars | Item name |
| `description` | string | no | 0-2000 chars | Detailed description |
| `unit` | string | yes | 1-30 chars (e.g. `each`, `set`, `litre`, `kg`) | Unit of measure |
| `trackingMode` | string | yes | `batch`, `serial`, `none` | How this item is tracked |
| `stationId` | string | yes | valid station ID; Hosts must be assigned to this station | Owning station |
| `reorderPoint` | integer | no | >= 0, default `0` | Balance at which a low-stock alert fires |
| `initialBalance` | integer | no | >= 0, default `0` | Opening stock balance |

```json
{
  "sku": "OIL-5W30-20L",
  "name": "Engine Oil 5W-30 (20L drum)",
  "unit": "each",
  "trackingMode": "batch",
  "stationId": "stn_012",
  "reorderPoint": 5,
  "initialBalance": 12
}
```

**Success response (201):**

```json
{
  "success": true,
  "data": {
    "id": "itm_157",
    "sku": "OIL-5W30-20L",
    "name": "Engine Oil 5W-30 (20L drum)",
    "description": null,
    "unit": "each",
    "trackingMode": "batch",
    "stationId": "stn_012",
    "stationName": "King's Cross",
    "currentBalance": 12,
    "reorderPoint": 5,
    "createdAt": "2026-04-03T18:00:00Z",
    "updatedAt": "2026-04-03T18:00:00Z"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 409 | `CONFLICT` | SKU already exists at this station |

---

### PATCH /api/inventory/items/:id

Update an inventory item's metadata.

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Item ID |

**Request body (all fields optional):**

| Field | Type | Validation | Description |
|---|---|---|---|
| `name` | string | 1-200 chars | Updated name |
| `description` | string | 0-2000 chars | Updated description |
| `reorderPoint` | integer | >= 0 | Updated reorder threshold |
| `trackingMode` | string | `batch`, `serial`, `none` | Updated tracking mode (only allowed when current balance is 0) |

**Success response (200):** returns the updated item object.

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | Item not found |
| 409 | `CONFLICT` | Cannot change `trackingMode` while balance is non-zero |

**Notable behavior:**
- Changing `reorderPoint` triggers an immediate alert evaluation; if the current balance is at or below the new threshold, a low-stock alert is created.

---

### GET /api/inventory/items/:id

Get full details for a single inventory item, including current balance and recent movements.

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Item ID |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "id": "itm_001",
    "sku": "BRKPAD-001",
    "name": "Brake Pad Set - Type A",
    "description": "Standard brake pads for IC225 bogies",
    "unit": "set",
    "trackingMode": "batch",
    "stationId": "stn_012",
    "stationName": "King's Cross",
    "currentBalance": 42,
    "reorderPoint": 20,
    "recentMovements": [
      {
        "id": "mov_301",
        "type": "receiving",
        "quantity": 10,
        "batchNumber": "BP-2026-0401",
        "createdAt": "2026-04-01T14:00:00Z",
        "createdBy": "usr_002"
      }
    ],
    "createdAt": "2025-06-01T09:00:00Z",
    "updatedAt": "2026-04-02T16:30:00Z"
  }
}
```

---

## Inventory Movements

### GET /api/inventory/movements

List inventory movements.

**Required role:** `host` or `platform_ops`

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `pageSize` | integer | `25` | Items per page (max 100) |
| `itemId` | string | -- | Filter by item |
| `type` | string | -- | Filter: `receiving`, `shipping`, `material_return`, `customer_return`, `adjustment` |
| `dateFrom` | string | -- | ISO 8601 date; filter movements on or after this date |
| `dateTo` | string | -- | ISO 8601 date; filter movements on or before this date |
| `stationId` | string | -- | Filter by station (Hosts are auto-scoped) |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "mov_301",
        "type": "receiving",
        "itemId": "itm_001",
        "itemSku": "BRKPAD-001",
        "itemName": "Brake Pad Set - Type A",
        "quantity": 10,
        "balanceBefore": 32,
        "balanceAfter": 42,
        "batchNumber": "BP-2026-0401",
        "serialNumbers": null,
        "notes": "Quarterly restock from supplier.",
        "createdBy": {
          "id": "usr_002",
          "displayName": "Bob Smith"
        },
        "createdAt": "2026-04-01T14:00:00Z"
      }
    ],
    "total": 245,
    "page": 1,
    "pageSize": 25
  }
}
```

---

### POST /api/inventory/movements

Record a new inventory movement. This is the primary mechanism for changing item balances.

**Required role:** `host` or `platform_ops`

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `type` | string | yes | `receiving`, `shipping`, `material_return`, `customer_return` | Movement type |
| `itemId` | string | yes | valid item ID | Target inventory item |
| `quantity` | integer | yes | >= 1 | Number of units moved |
| `batchNumber` | string | conditional | required if item `trackingMode` is `batch`; 1-50 chars | Batch identifier |
| `serialNumbers` | string[] | conditional | required if item `trackingMode` is `serial`; array length must equal `quantity` | Serial numbers for each unit |
| `notes` | string | no | 0-2000 chars | Free-text notes |

```json
{
  "type": "shipping",
  "itemId": "itm_001",
  "quantity": 4,
  "batchNumber": "BP-2026-0401",
  "notes": "Shipped to maintenance depot for HST-B overhaul."
}
```

**Success response (201):**

```json
{
  "success": true,
  "data": {
    "id": "mov_302",
    "type": "shipping",
    "itemId": "itm_001",
    "quantity": 4,
    "balanceBefore": 42,
    "balanceAfter": 38,
    "batchNumber": "BP-2026-0401",
    "serialNumbers": null,
    "notes": "Shipped to maintenance depot for HST-B overhaul.",
    "createdBy": {
      "id": "usr_002",
      "displayName": "Bob Smith"
    },
    "createdAt": "2026-04-03T18:30:00Z"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing required fields, batch/serial mismatch with tracking mode |
| 409 | `INSUFFICIENT_STOCK` | `shipping` movement would reduce balance below zero |

**Notable behavior:**
- Balance is updated atomically. For `receiving` and return types, balance increases. For `shipping`, balance decreases.
- If the resulting balance falls at or below the item's `reorderPoint`, a low-stock alert is generated automatically.
- Audit log records the movement with before/after balances.

---

### GET /api/inventory/movements/:id

Get full details for a specific movement.

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Movement ID |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "id": "mov_302",
    "type": "shipping",
    "itemId": "itm_001",
    "itemSku": "BRKPAD-001",
    "itemName": "Brake Pad Set - Type A",
    "quantity": 4,
    "balanceBefore": 42,
    "balanceAfter": 38,
    "batchNumber": "BP-2026-0401",
    "serialNumbers": null,
    "notes": "Shipped to maintenance depot for HST-B overhaul.",
    "createdBy": {
      "id": "usr_002",
      "displayName": "Bob Smith"
    },
    "createdAt": "2026-04-03T18:30:00Z"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | Movement not found |

---

## Stock Counts

Stock counts are periodic physical inventory verifications. They allow operators to count items on hand and reconcile with system balances.

### GET /api/inventory/stock-counts

List stock counts.

**Required role:** `host` or `platform_ops`

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `pageSize` | integer | `25` | Items per page (max 100) |
| `status` | string | -- | Filter: `in_progress`, `finalized` |
| `stationId` | string | -- | Filter by station |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "sc_010",
        "stationId": "stn_012",
        "stationName": "King's Cross",
        "status": "in_progress",
        "lineCount": 12,
        "createdBy": {
          "id": "usr_002",
          "displayName": "Bob Smith"
        },
        "createdAt": "2026-04-03T08:00:00Z",
        "finalizedAt": null
      }
    ],
    "total": 8,
    "page": 1,
    "pageSize": 25
  }
}
```

---

### POST /api/inventory/stock-counts

Create a new stock count session.

**Required role:** `host` or `platform_ops`

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `stationId` | string | yes | valid station ID | Station being counted |
| `notes` | string | no | 0-2000 chars | Optional notes (e.g. "Monthly cycle count - Zone A") |

```json
{
  "stationId": "stn_012",
  "notes": "Monthly cycle count - Zone A"
}
```

**Success response (201):**

```json
{
  "success": true,
  "data": {
    "id": "sc_011",
    "stationId": "stn_012",
    "status": "in_progress",
    "notes": "Monthly cycle count - Zone A",
    "lines": [],
    "createdBy": {
      "id": "usr_002",
      "displayName": "Bob Smith"
    },
    "createdAt": "2026-04-03T19:00:00Z",
    "finalizedAt": null
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 409 | `CONFLICT` | An in-progress stock count already exists for this station |

---

### GET /api/inventory/stock-counts/:id

Get stock count with all lines.

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Stock count ID |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "id": "sc_010",
    "stationId": "stn_012",
    "stationName": "King's Cross",
    "status": "in_progress",
    "notes": "Monthly cycle count - Zone A",
    "lines": [
      {
        "id": "scl_001",
        "itemId": "itm_001",
        "itemSku": "BRKPAD-001",
        "itemName": "Brake Pad Set - Type A",
        "systemBalance": 42,
        "countedQuantity": 40,
        "variance": -2,
        "notes": "2 sets appear damaged; set aside for inspection."
      }
    ],
    "createdBy": {
      "id": "usr_002",
      "displayName": "Bob Smith"
    },
    "createdAt": "2026-04-03T08:00:00Z",
    "finalizedAt": null
  }
}
```

---

### PATCH /api/inventory/stock-counts/:id

Update a stock count: add or edit count lines.

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Stock count ID |

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `lines` | array | yes | non-empty array | Count lines to add or update |
| `lines[].itemId` | string | yes | valid item ID at this station | Item being counted |
| `lines[].countedQuantity` | integer | yes | >= 0 | Physical count result |
| `lines[].notes` | string | no | 0-500 chars | Line-level notes |

```json
{
  "lines": [
    { "itemId": "itm_001", "countedQuantity": 40, "notes": "2 sets appear damaged." },
    { "itemId": "itm_002", "countedQuantity": 100 }
  ]
}
```

**Success response (200):** returns the updated stock count object with all lines.

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 409 | `CONFLICT` | Stock count is already finalized |

**Notable behavior:**
- If a line for the same `itemId` already exists, it is updated (upsert behavior).
- `systemBalance` and `variance` are computed automatically.

---

### POST /api/inventory/stock-counts/:id/finalize

Finalize the stock count, locking it from further edits and generating adjustment movements.

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Stock count ID |

**Request body:** none

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "id": "sc_010",
    "status": "finalized",
    "finalizedAt": "2026-04-03T20:00:00Z",
    "finalizedBy": {
      "id": "usr_002",
      "displayName": "Bob Smith"
    },
    "adjustments": [
      {
        "movementId": "mov_303",
        "itemId": "itm_001",
        "type": "adjustment",
        "quantity": -2,
        "balanceBefore": 42,
        "balanceAfter": 40
      }
    ],
    "totalVariances": 1,
    "alertsGenerated": 0
  }
}
```

**Notable behavior:**
- For each line with a non-zero variance, an `adjustment` movement is created automatically.
- If any adjustment causes a balance to fall at or below the reorder point, a low-stock alert is generated.
- Variance alerts are created for items with variance exceeding a configurable threshold (default: 5% of system balance).
- The stock count and all associated adjustment movements are recorded in the audit log.

---

### GET /api/inventory/alerts

Get current inventory alerts (low-stock and variance alerts).

**Required role:** `host` or `platform_ops`

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `pageSize` | integer | `25` | Items per page (max 100) |
| `type` | string | -- | Filter: `low_stock`, `variance` |
| `stationId` | string | -- | Filter by station |
| `acknowledged` | boolean | -- | Filter by acknowledgement status |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "alert_045",
        "type": "low_stock",
        "itemId": "itm_015",
        "itemSku": "WIPER-BLD-L",
        "itemName": "Wiper Blade - Left",
        "stationId": "stn_012",
        "stationName": "King's Cross",
        "currentBalance": 3,
        "reorderPoint": 5,
        "acknowledged": false,
        "createdAt": "2026-04-03T18:35:00Z"
      },
      {
        "id": "alert_046",
        "type": "variance",
        "itemId": "itm_001",
        "itemSku": "BRKPAD-001",
        "itemName": "Brake Pad Set - Type A",
        "stationId": "stn_012",
        "stationName": "King's Cross",
        "expectedBalance": 42,
        "countedBalance": 40,
        "variancePercent": 4.76,
        "stockCountId": "sc_010",
        "acknowledged": false,
        "createdAt": "2026-04-03T20:00:00Z"
      }
    ],
    "total": 7,
    "page": 1,
    "pageSize": 25
  }
}
```

---

## Backup & Recovery

### GET /api/backups

List backup records.

**Required role:** `platform_ops`

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `pageSize` | integer | `25` | Items per page (max 100) |
| `status` | string | -- | Filter: `completed`, `failed`, `in_progress` |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "bkp_100",
        "type": "scheduled",
        "status": "completed",
        "sizeMB": 245.8,
        "drivePath": "/mnt/backup-drive/railops/",
        "fileName": "railops_backup_20260403_020000.enc",
        "startedAt": "2026-04-03T02:00:00Z",
        "completedAt": "2026-04-03T02:03:45Z",
        "checksum": "sha256:a1b2c3d4e5f6..."
      }
    ],
    "total": 365,
    "page": 1,
    "pageSize": 25
  }
}
```

---

### POST /api/backups/run

Trigger an immediate manual backup.

**Required role:** `platform_ops`

**Request body:** none

**Success response (202):**

```json
{
  "success": true,
  "data": {
    "id": "bkp_101",
    "type": "manual",
    "status": "in_progress",
    "startedAt": "2026-04-03T20:30:00Z",
    "triggeredBy": "usr_001"
  }
}
```

**Notable behavior:**
- Returns 202 (Accepted) because the backup runs asynchronously.
- A subsequent GET to `/api/backups` or polling the backup ID will show completion status.
- Only one backup can run at a time; a second request while one is in progress returns 409.

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 409 | `CONFLICT` | A backup is already in progress |
| 500 | `BACKUP_FAILED` | Drive not mounted or insufficient space |

---

### GET /api/backups/config

Get the current backup configuration.

**Required role:** `platform_ops`

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "drivePath": "/mnt/backup-drive/railops/",
    "schedule": "0 2 * * *",
    "retentionDays": 90,
    "encryptionEnabled": true,
    "lastTestedAt": "2026-03-15T10:00:00Z"
  }
}
```

---

### PATCH /api/backups/config

Update backup configuration.

**Required role:** `platform_ops`

**Request body (all fields optional):**

| Field | Type | Validation | Description |
|---|---|---|---|
| `drivePath` | string | valid filesystem path | Backup destination directory |
| `schedule` | string | valid cron expression | Backup schedule (cron format) |
| `retentionDays` | integer | 1-365 | Days to retain backups before auto-deletion |
| `encryptionEnabled` | boolean | -- | Enable/disable backup encryption |

```json
{
  "drivePath": "/mnt/new-backup-drive/railops/",
  "retentionDays": 60
}
```

**Success response (200):** returns the updated config object.

**Notable behavior:**
- Changing the `drivePath` triggers a write-test to the new path; the request fails if the path is not writable.
- Audit log records configuration changes.

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid cron expression or path not writable |

---

### POST /api/restore-drills

Start a restore drill to verify backup integrity and recoverability.

**Required role:** `platform_ops`

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `backup_id` | integer | yes | valid backup ID with `completed` status | Backup to test |

```json
{
  "backup_id": 100
}
```

A scratch database schema is created automatically and cleaned up after the drill.

**Success response (202):**

```json
{
  "success": true,
  "data": {
    "id": "drill_015",
    "backupId": "bkp_100",
    "status": "running",
    "startedAt": "2026-04-03T21:00:00Z",
    "startedBy": "usr_001"
  }
}
```

Status values: `running`, `passed`, `failed`.

**Notable behavior:**
- Runs asynchronously. The drill restores the backup to the target path, verifies data integrity (checksums, row counts), and cleans up.
- The drill does NOT affect the production database.

---

### GET /api/restore-drills

List restore drill records.

**Required role:** `platform_ops`

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `pageSize` | integer | `25` | Items per page (max 100) |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "drill_015",
        "backupId": "bkp_100",
        "status": "passed",
        "startedAt": "2026-04-03T21:00:00Z",
        "completedAt": "2026-04-03T21:05:30Z",
        "startedBy": "usr_001"
      }
    ],
    "total": 12,
    "page": 1,
    "pageSize": 25
  }
}
```

---

### GET /api/restore-drills/:id

Get detailed report for a specific restore drill.

**Required role:** `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Drill ID |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "id": "drill_015",
    "backup_id": 100,
    "status": "passed",
    "scratch_schema": "restore_drill_1712178000000",
    "started_at": "2026-04-03T21:00:00Z",
    "completed_at": "2026-04-03T21:05:30Z",
    "performed_by": 1,
    "report": {
      "checks": [
        { "name": "file_exists", "passed": true, "message": "Backup file found." },
        { "name": "checksum_verification", "passed": true, "message": "SHA-256 checksum matches." },
        { "name": "restore", "passed": true, "message": "Backup restored to scratch schema." },
        { "name": "cleanup", "passed": true, "message": "Scratch schema dropped." }
      ]
    },
    "duration_seconds": 330
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | Drill ID does not exist |

---

## Data Quality

### GET /api/data-quality/issues

List data quality issues.

**Required role:** `host` or `platform_ops`

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `pageSize` | integer | `25` | Items per page (max 100) |
| `severity` | string | -- | Filter: `low`, `medium`, `high`, `critical` |
| `status` | string | -- | Filter: `open`, `in_progress`, `resolved`, `dismissed` |
| `ownerId` | string | -- | Filter by assigned owner user ID |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "dqi_042",
        "title": "Duplicate station code detected",
        "description": "Station code 'YRK' is assigned to two station records.",
        "severity": "high",
        "status": "open",
        "entity": "station",
        "entityId": "stn_018",
        "owner": {
          "id": "usr_001",
          "displayName": "Jane Doe"
        },
        "correctiveNotes": null,
        "createdAt": "2026-04-02T09:00:00Z",
        "updatedAt": "2026-04-02T09:00:00Z",
        "resolvedAt": null
      }
    ],
    "total": 15,
    "page": 1,
    "pageSize": 25
  }
}
```

---

### POST /api/data-quality/issues

Create a data quality issue manually.

**Required role:** `host` or `platform_ops`

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `title` | string | yes | 1-200 chars | Short issue title |
| `description` | string | yes | 1-2000 chars | Detailed description |
| `severity` | string | yes | `low`, `medium`, `high`, `critical` | Issue severity |
| `entity` | string | no | e.g. `station`, `schedule`, `item`, `movement` | Related entity type |
| `entityId` | string | no | -- | Related entity ID |
| `ownerId` | string | no | valid user ID | Assigned owner |

```json
{
  "title": "Inventory balance mismatch at KGX",
  "description": "Physical count of BRKPAD-001 consistently shows 2 fewer than system balance.",
  "severity": "medium",
  "entity": "item",
  "entityId": "itm_001",
  "ownerId": "usr_002"
}
```

**Success response (201):**

```json
{
  "success": true,
  "data": {
    "id": "dqi_043",
    "title": "Inventory balance mismatch at KGX",
    "description": "Physical count of BRKPAD-001 consistently shows 2 fewer than system balance.",
    "severity": "medium",
    "status": "open",
    "entity": "item",
    "entityId": "itm_001",
    "owner": {
      "id": "usr_002",
      "displayName": "Bob Smith"
    },
    "correctiveNotes": null,
    "createdAt": "2026-04-03T21:30:00Z",
    "updatedAt": "2026-04-03T21:30:00Z",
    "resolvedAt": null
  }
}
```

---

### PATCH /api/data-quality/issues/:id

Update a data quality issue (change status, add corrective notes, reassign).

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Issue ID |

**Request body (all fields optional):**

| Field | Type | Validation | Description |
|---|---|---|---|
| `status` | string | `open`, `in_progress`, `resolved`, `dismissed` | Updated status |
| `severity` | string | `low`, `medium`, `high`, `critical` | Updated severity |
| `correctiveNotes` | string | 0-5000 chars | Notes on corrective actions taken |
| `ownerId` | string | valid user ID | Reassign owner |

**Success response (200):** returns the updated issue object.

**Notable behavior:**
- Setting status to `resolved` automatically sets `resolvedAt` to the current timestamp.
- Audit log records all status transitions.

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | Issue not found |

---

### GET /api/data-quality/reports

List daily data quality reports.

**Required role:** `host` or `platform_ops`

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `pageSize` | integer | `25` | Items per page (max 100) |
| `dateFrom` | string | -- | ISO 8601 date |
| `dateTo` | string | -- | ISO 8601 date |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "dqr_090",
        "date": "2026-04-03",
        "totalIssues": 15,
        "openIssues": 8,
        "resolvedIssues": 5,
        "dismissedIssues": 2,
        "criticalCount": 1,
        "highCount": 3,
        "mediumCount": 7,
        "lowCount": 4,
        "generatedAt": "2026-04-03T23:00:00Z"
      }
    ],
    "total": 90,
    "page": 1,
    "pageSize": 25
  }
}
```

---

### GET /api/data-quality/reports/:id

Get detailed data quality report.

**Required role:** `host` or `platform_ops`

**Path params:**

| Param | Type | Description |
|---|---|---|
| `id` | string | Report ID |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "id": "dqr_090",
    "date": "2026-04-03",
    "summary": {
      "totalIssues": 15,
      "openIssues": 8,
      "resolvedIssues": 5,
      "dismissedIssues": 2,
      "criticalCount": 1,
      "highCount": 3,
      "mediumCount": 7,
      "lowCount": 4
    },
    "issuesByEntity": [
      { "entity": "station", "count": 2 },
      { "entity": "schedule", "count": 5 },
      { "entity": "item", "count": 6 },
      { "entity": "movement", "count": 2 }
    ],
    "newIssues": [
      { "id": "dqi_043", "title": "Inventory balance mismatch at KGX", "severity": "medium" }
    ],
    "resolvedIssues": [
      { "id": "dqi_038", "title": "Missing platform assignment on schedule ver_049", "severity": "low" }
    ],
    "generatedAt": "2026-04-03T23:00:00Z"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | Report not found |

---

### POST /api/data-quality/reports/generate

Trigger generation of a data quality report for the current day.

**Required role:** `platform_ops`

**Request body:** none

**Success response (202):**

```json
{
  "success": true,
  "data": {
    "id": "dqr_091",
    "date": "2026-04-03",
    "status": "generating",
    "triggeredBy": "usr_001",
    "triggeredAt": "2026-04-03T21:45:00Z"
  }
}
```

**Notable behavior:**
- Reports are normally generated automatically at end of day (23:00 local time). This endpoint allows on-demand generation.
- If a report for today already exists, it is regenerated (replaced).

---

## Audit & Backtracking

### GET /api/audit-logs

Query the immutable audit log.

**Required role:** `platform_ops`

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `pageSize` | integer | `25` | Items per page (max 100) |
| `entity` | string | -- | Filter by entity type (e.g. `schedule`, `item`, `user`, `movement`) |
| `entityId` | string | -- | Filter by specific entity ID |
| `action` | string | -- | Filter by action (e.g. `create`, `update`, `delete`, `publish`, `login`, `logout`) |
| `actorId` | string | -- | Filter by the user who performed the action |
| `dateFrom` | string | -- | ISO 8601 datetime; entries on or after |
| `dateTo` | string | -- | ISO 8601 datetime; entries on or before |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "log_50012",
        "entity": "schedule",
        "entityId": "sch_007",
        "action": "publish",
        "actor": {
          "id": "usr_001",
          "displayName": "Jane Doe"
        },
        "timestamp": "2026-04-03T16:00:00Z",
        "metadata": {
          "versionId": "ver_051",
          "versionNumber": 4,
          "previousVersionId": "ver_014"
        },
        "changes": null
      },
      {
        "id": "log_50010",
        "entity": "item",
        "entityId": "itm_001",
        "action": "update",
        "actor": {
          "id": "usr_002",
          "displayName": "Bob Smith"
        },
        "timestamp": "2026-04-03T15:45:00Z",
        "metadata": null,
        "changes": {
          "reorderPoint": { "from": 15, "to": 20 }
        }
      }
    ],
    "total": 50012,
    "page": 1,
    "pageSize": 25
  }
}
```

**Notable behavior:**
- Audit logs are append-only and cannot be modified or deleted through the API.
- Results are ordered by timestamp descending (newest first) by default.

---

### GET /api/backtrack/diff

Compare the state of an entity at two points in time.

**Required role:** `platform_ops`

**Query params:**

| Param | Type | Required | Description |
|---|---|---|---|
| `entity` | string | yes | Entity type (e.g. `schedule`, `item`, `user`, `station`) |
| `id` | string | yes | Entity ID |
| `from` | string | yes | ISO 8601 datetime -- starting point |
| `to` | string | yes | ISO 8601 datetime -- ending point |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "entity": "item",
    "entityId": "itm_001",
    "from": "2026-04-01T00:00:00Z",
    "to": "2026-04-03T23:59:59Z",
    "stateAtFrom": {
      "currentBalance": 32,
      "reorderPoint": 15,
      "name": "Brake Pad Set - Type A"
    },
    "stateAtTo": {
      "currentBalance": 40,
      "reorderPoint": 20,
      "name": "Brake Pad Set - Type A"
    },
    "diff": {
      "currentBalance": { "from": 32, "to": 40 },
      "reorderPoint": { "from": 15, "to": 20 }
    }
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing required params or `from` is after `to` |
| 404 | `NOT_FOUND` | Entity does not exist |

---

### GET /api/backtrack/replay

Replay the sequence of changes (transactions) for an entity within a time range.

**Required role:** `platform_ops`

**Query params:**

| Param | Type | Required | Description |
|---|---|---|---|
| `entity` | string | yes | Entity type |
| `id` | string | yes | Entity ID |
| `from` | string | yes | ISO 8601 datetime -- start of range |
| `to` | string | yes | ISO 8601 datetime -- end of range |
| `page` | integer | no | Page number (default `1`) |
| `pageSize` | integer | no | Items per page (default `50`, max 200) |

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "entity": "item",
    "entityId": "itm_001",
    "from": "2026-04-01T00:00:00Z",
    "to": "2026-04-03T23:59:59Z",
    "transactions": [
      {
        "auditLogId": "log_49800",
        "action": "update",
        "timestamp": "2026-04-01T14:00:00Z",
        "actor": { "id": "usr_002", "displayName": "Bob Smith" },
        "changes": {
          "currentBalance": { "from": 32, "to": 42 }
        },
        "relatedEntity": { "type": "movement", "id": "mov_301" }
      },
      {
        "auditLogId": "log_50010",
        "action": "update",
        "timestamp": "2026-04-03T15:45:00Z",
        "actor": { "id": "usr_002", "displayName": "Bob Smith" },
        "changes": {
          "reorderPoint": { "from": 15, "to": 20 }
        },
        "relatedEntity": null
      },
      {
        "auditLogId": "log_50015",
        "action": "update",
        "timestamp": "2026-04-03T18:30:00Z",
        "actor": { "id": "usr_002", "displayName": "Bob Smith" },
        "changes": {
          "currentBalance": { "from": 42, "to": 38 }
        },
        "relatedEntity": { "type": "movement", "id": "mov_302" }
      },
      {
        "auditLogId": "log_50020",
        "action": "update",
        "timestamp": "2026-04-03T20:00:00Z",
        "actor": { "id": "usr_002", "displayName": "Bob Smith" },
        "changes": {
          "currentBalance": { "from": 42, "to": 40 }
        },
        "relatedEntity": { "type": "stock_count", "id": "sc_010" }
      }
    ],
    "total": 4,
    "page": 1,
    "pageSize": 50
  }
}
```

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing required params or `from` is after `to` |
| 404 | `NOT_FOUND` | Entity does not exist |

---

### POST /api/backtrack/corrective-actions

Document a corrective action taken in response to an issue discovered through audit or backtracking.

**Required role:** `platform_ops`

**Request body:**

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `entity` | string | yes | valid entity type | Related entity type |
| `entityId` | string | yes | valid entity ID | Related entity ID |
| `description` | string | yes | 1-5000 chars | Description of what was found and what corrective action was taken |
| `relatedAuditLogIds` | string[] | no | valid audit log IDs | Links to audit log entries that prompted this action |
| `relatedDataQualityIssueId` | string | no | valid issue ID | Link to a data quality issue if applicable |

```json
{
  "entity": "item",
  "entityId": "itm_001",
  "description": "Discovered persistent -2 variance on BRKPAD-001 at King's Cross. Root cause identified as damaged items being discarded without recording a shipping movement. Corrective actions: (1) Adjusted balance via stock count sc_010. (2) Retrained station staff on damage disposal procedure. (3) Created data quality issue dqi_043 for tracking.",
  "relatedAuditLogIds": ["log_50020"],
  "relatedDataQualityIssueId": "dqi_043"
}
```

**Success response (201):**

```json
{
  "success": true,
  "data": {
    "id": "ca_008",
    "entity": "item",
    "entityId": "itm_001",
    "description": "Discovered persistent -2 variance on BRKPAD-001 at King's Cross. Root cause identified as damaged items being discarded without recording a shipping movement. Corrective actions: (1) Adjusted balance via stock count sc_010. (2) Retrained station staff on damage disposal procedure. (3) Created data quality issue dqi_043 for tracking.",
    "relatedAuditLogIds": ["log_50020"],
    "relatedDataQualityIssueId": "dqi_043",
    "createdBy": {
      "id": "usr_001",
      "displayName": "Jane Doe"
    },
    "createdAt": "2026-04-03T22:00:00Z"
  }
}
```

**Notable behavior:**
- Corrective actions are immutable once created (no update/delete endpoints).
- They are recorded in the audit log and linked to the referenced entities for traceability.

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing required fields |
| 404 | `NOT_FOUND` | Referenced entity, audit log, or data quality issue does not exist |
