# RailOps Prior-Issue Fix Review

Date: 2026-04-08
Source issues reviewed: [.tmp/railops-static-audit-2026-04-08.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/.tmp/railops-static-audit-2026-04-08.md)

## Verdict

- Overall conclusion: **Most prior issues are fixed**
- Fixed: 2 of 3 listed issues
- Still open: 0 confirmed defects
- Not a fixable static defect: 1 manual-verification boundary item remains inherently runtime-dependent

## Issue-by-Issue Status

### 1. Design doc referenced a `tlsEnforce` middleware that was not present in the backend

- Previous status: `Medium`, `Partial Pass`
- Current status: **Fixed**
- Rationale: the design doc no longer claims a `tlsEnforce` middleware exists. It now describes TLS enforcement as server-level HTTPS startup enforcement and lists only the middleware files that actually exist.
- Previous evidence:
  - [.tmp/railops-static-audit-2026-04-08.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/.tmp/railops-static-audit-2026-04-08.md#L147)
- Current evidence:
  - [docs/design.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/docs/design.md#L56)
  - [docs/design.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/docs/design.md#L57)
  - [backend/src/middleware/auth.js](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/backend/src/middleware/auth.js)
  - [backend/src/middleware/errorHandler.js](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/backend/src/middleware/errorHandler.js)
  - [backend/src/middleware/rateLimiter.js](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/backend/src/middleware/rateLimiter.js)
  - [backend/src/middleware/scopeFilter.js](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/backend/src/middleware/scopeFilter.js)

### 2. Design doc said station scoping and masking were enforced in a service layer, but code enforced them in middleware and route handlers

- Previous status: `Medium`, `Partial Pass`
- Current status: **Fixed**
- Rationale: the design doc now explicitly describes a two-layer enforcement model using middleware plus route-handler query scoping, which matches the code. The prior inaccurate “service layer” statement is gone from the reviewed section.
- Previous evidence:
  - [.tmp/railops-static-audit-2026-04-08.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/.tmp/railops-static-audit-2026-04-08.md#L158)
- Current evidence:
  - [docs/design.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/docs/design.md#L577)
  - [docs/design.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/docs/design.md#L579)
  - [docs/design.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/docs/design.md#L581)
  - [docs/design.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/docs/design.md#L582)
  - [backend/src/middleware/scopeFilter.js](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/backend/src/middleware/scopeFilter.js#L13)
  - [backend/src/routes/users.js](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/backend/src/routes/users.js#L108)

### 3. Backup/restore and performance acceptance remained manual-verification items

- Previous status: `Low`, `Cannot Confirm Statistically`
- Current status: **Still requires manual verification**
- Rationale: this was not a conventional code defect. It was a static-audit boundary note. The repository now provides better verification instructions, but static review still cannot prove runtime performance, TLS deployment, or backup/restore success.
- Previous evidence:
  - [.tmp/railops-static-audit-2026-04-08.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/.tmp/railops-static-audit-2026-04-08.md#L172)
- Current evidence:
  - [README.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/README.md#L131)
  - [README.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/README.md#L174)
  - [README.md](/Users/aimanmengesha/Desktop/eagle%20point/Slopering/w2t12/repo/README.md#L182)
- Interpretation: improved documentation support exists, but the acceptance boundary remains runtime/manual by nature.

## Summary

- Fixed:
  - `docs/design.md` no longer claims a non-existent `tlsEnforce` middleware
  - `docs/design.md` now matches the actual middleware + route-handler station-scope enforcement model
- Still not statically sign-off-able:
  - hot-search performance under 200 ms
  - live HTTPS behavior
  - backup completion and restore drill success

## Final Judgment

- The prior documented defects are **resolved**.
- The remaining item from the earlier report is a **manual verification requirement**, not an unresolved code/documentation defect.
