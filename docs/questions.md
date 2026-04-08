# questions.md

## Business Logic Questions Log

### 1. Is the Guest role authenticated or anonymous?
- **Question:** The prompt defines a Guest role for read-only trip search, while the authentication section says auth is strictly local username and password. It does not explicitly say whether Guests must sign in.
- **My Understanding:** Guest search should be available as a read-only local kiosk / unauthenticated mode limited to published trip search only. All mutating actions and all operational consoles require authenticated Host or Platform Operations accounts.
- **Solution:** Treat Guest as a restricted public-facing search mode on the local network. Expose only published-search endpoints to Guests, and require local username/password login for Host and Platform Operations features.

### 2. What does “offline-first” mean in this local-network system?
- **Question:** The prompt says the dispatch office may have no internet, but it does not specify whether the frontend must function with full client-side offline writes or simply without external dependencies.
- **My Understanding:** The server on the local network remains the source of truth. “Offline-first” means no internet dependency, resilient LAN operation, cached read/search data, and draft preservation for short interruptions, not independent client-side write authority.
- **Solution:** Keep all authoritative writes on the Koa backend + MySQL stack. Add local caching for hot trip searches and in-progress UI drafts so the interface stays usable during brief connection issues.

### 3. How should fuzzy station matching, abbreviations, and “nearby dates” suggestions work?
- **Question:** The prompt requires typo handling, common station abbreviations, and “No matches—try nearby dates,” but it does not define the matching or suggestion rules.
- **My Understanding:** Stations should have canonical IDs plus aliases/abbreviations, and the search layer should normalize user input before fuzzy matching. Nearby-date suggestions should be simple and predictable.
- **Solution:** Add station aliases (for example, short codes and common abbreviations), normalize inputs, use fuzzy matching against canonical station names/aliases, and when no result exists, suggest the same route on nearby dates such as ±3 days.

### 4. How should cached “hot searches” be defined and stored locally?
- **Question:** The prompt says hot searches are cached locally to keep repeated queries under 200 ms, but it does not define how they are chosen, stored, or expired.
- **My Understanding:** Hot searches should be normalized recent/popular queries stored on the client so repeat lookups do not always require a fresh round trip.
- **Solution:** Cache normalized search keys and recent results in local browser storage (prefer IndexedDB, with localStorage fallback), apply a short TTL, and use the cache first for repeated identical trip searches to hit the under-200 ms UX target on normal local hardware.

### 5. How should schedule times and overnight trips be represented?
- **Question:** The prompt requires valid time sequence checks, but it does not say whether overnight trips are allowed or whether times are stored as local times only.
- **My Understanding:** Regional rail trips can cross midnight, so validation should use full local datetimes, not stop times detached from dates.
- **Solution:** Store stop departure/arrival values as full datetimes in the operator’s local timezone. Validate that stop times are strictly increasing in absolute order, allowing overnight trips when the datetimes still advance correctly.

### 6. What counts as “no overlap on the same trainset”?
- **Question:** The prompt requires no overlap on the same trainset, but it does not define whether overlap means identical departure windows only or any intersecting service window.
- **My Understanding:** The safest operational rule is that the same trainset cannot be assigned to overlapping service windows for active or publishable schedules.
- **Solution:** Reject publish/checklist completion when two schedules for the same trainset have intersecting active service windows. Use origin departure to final arrival as the schedule occupancy window unless the repo already contains a stronger compatible segment model.

### 7. How should seats, seat classes, fares, and capacity be modeled?
- **Question:** The prompt says Guests search by seat class and Hosts manage seats and fares, while the checklist examples mention seat capacity and price, but it does not define the data model.
- **My Understanding:** A schedule version should carry one or more seat-class allocations, each with capacity and fare rules.
- **Solution:** Model seat inventory and pricing at the schedule-version + seat-class level. Require at least one seat-class row per schedule, validate each seat-class capacity to 1–500 and fare to $1.00–$999.00, and use those rows to drive Guest search filtering and price sorting.

### 8. When is approval required for publishing a schedule?
- **Question:** The prompt says Hosts can request approval “when required,” but it does not define the rule for when approval is mandatory versus when a Host can publish directly.
- **My Understanding:** Approval should be policy-driven rather than ad hoc. By default, Hosts should submit a publish request unless they hold an explicit direct-publish permission in their station scope.
- **Solution:** Add a publish policy/permission check. Hosts without direct-publish rights create approval requests; Platform Operations approves or rejects them. Hosts with explicit direct-publish rights can release directly, but the action is still audited.

### 9. What exactly happens during rollback?
- **Question:** The prompt allows rollback to any prior published version, but it does not specify whether the old version becomes active directly or whether rollback creates a new current version.
- **My Understanding:** For auditability, rollback should not erase history or simply flip a pointer silently.
- **Solution:** Implement rollback as creation of a new published version cloned from the selected historical version, with its own version number, activation timestamp, actor, reason, and linkage to the source historical version.

### 10. How should inventory workflows update stock and prevent invalid balances?
- **Question:** The prompt lists receiving, shipping, material return, customer return, and stock counts, but it does not define whether negative stock is allowed or how corrections are represented.
- **My Understanding:** A ledger-style inventory model is the safest fit. Normal issue/shipping flows should not drive on-hand below zero, while stock counts can create controlled adjustment events.
- **Solution:** Record each inventory workflow as a typed movement ledger entry. Block movements that would make on-hand negative, except stock-count reconciliation, which posts an auditable adjustment event from book quantity to counted quantity.

### 11. How should count variance alerts be calculated?
- **Question:** The prompt says alerts appear when count variance exceeds 2% or $50.00 in extended cost, but it does not define the baseline quantity or the zero-book-quantity case.
- **My Understanding:** Variance should be measured against book quantity and book unit cost at count time.
- **Solution:** Trigger an alert when the absolute quantity delta exceeds 2% of book quantity or the absolute extended-cost delta exceeds $50.00. When book quantity is zero, treat any non-zero counted quantity as a variance alert.

### 12. How should optional batch/serial capture work?
- **Question:** The prompt says batch/serial capture is optional for controlled items like radios or medical kits, but it does not define when the capture is required.
- **My Understanding:** Tracking should be item-configurable.
- **Solution:** Add an item tracking mode: `none`, `batch`, or `serial`. For batch-tracked items, require lot/batch identifiers on relevant movements and counts. For serial-tracked items, require unique serial numbers per unit on receiving, shipping, returns, and stock counts.

### 13. How should row-level station scoping work across roles?
- **Question:** The prompt says Hosts see only assigned stations and Platform Operations can cross-site audit, but it does not define search visibility or cross-station behaviors.
- **My Understanding:** Hosts should be constrained to the stations they manage for schedule and inventory mutations. Platform Operations should be global. Guests should only see published schedules marked as guest-visible.
- **Solution:** Enforce station-based scoping in both the UI and API. Limit Host actions and queries to assigned stations, allow Platform Operations cross-station access, and restrict Guest search results to published/public trip views only.

### 14. How should the 2-active-session cap and exceptions behave?
- **Question:** The prompt caps users at 2 active sessions unless Platform Operations grants an exception, but it does not define the exception model.
- **My Understanding:** Exceptions should be explicit, auditable, and time-bounded where possible.
- **Solution:** Enforce a default max of 2 active sessions per user. Add a Platform Operations override that can raise the limit with a reason and optional expiry. When over the limit and no override exists, deny the new login and show existing session context rather than silently evicting sessions.

### 15. How should risky-device verification be implemented offline in a web app?
- **Question:** The prompt describes a device fingerprint of browser + OS + machine identifier, but standard browser apps do not have access to a stable hardware machine ID.
- **My Understanding:** The practical offline equivalent is a browser/OS fingerprint plus a locally generated persistent device key tied to the workstation/browser profile.
- **Solution:** Build the risky-device signal from browser family, OS/platform hints, and a client-generated persistent device key stored locally. Treat a previously unseen fingerprint as risky and require a one-time recovery-code challenge before marking the device trusted.

### 16. How should recovery codes and lockouts interact?
- **Question:** The prompt requires one-time recovery codes stored as salted hashes and also requires progressive lockouts, but it does not say whether recovery-code failures count toward lockouts.
- **My Understanding:** Recovery-code abuse is also a security-sensitive authentication failure path and should be rate-limited.
- **Solution:** Store recovery codes only as salted hashes, consume them on successful use, and count both password-auth failures and risky-device challenge failures toward lockout controls where appropriate.

### 17. How should TLS work on internal offline endpoints?
- **Question:** The prompt requires TLS on internal endpoints, but it does not say how certificates are provisioned in an isolated local environment.
- **My Understanding:** The system should support administrator-provided local certificates and also allow a documented development/testing path.
- **Solution:** Support configurable local cert/key paths for production-like deployment. If the repo does not already provide them, add a script-based self-signed certificate path for local/dev verification and document it clearly.

### 18. What should backup, restore drills, and point-in-time recovery look like in-app?
- **Question:** The prompt requires nightly full backups, 15-minute binlog increments, removable-drive targets, and quarterly restore drills, but it does not define how intrusive restore drills should be.
- **My Understanding:** Restore drills should verify recoverability without risking the live operational database.
- **Solution:** Back up to an admin-configured removable path, track manifests/checksums, and implement restore drills as guided restore validation into a scratch database/schema with a recorded success/failure report. Keep actual production restore as an explicit privileged action.

### 19. What data-quality and lineage checks are required at write time and daily reporting?
- **Question:** The prompt names completeness, uniqueness, and freshness checks for schedules and inventory events, but it does not define the concrete rules.
- **My Understanding:** The checks should focus on operationally meaningful integrity failures rather than generic data-profiling.
- **Solution:** For schedules, validate required fields, unique stop sequence ordering, non-overlapping trainset assignments, and effective-date freshness. For inventory events, validate required item/station references, non-duplicate event references where applicable, event timestamp freshness, and consistent quantity/cost fields. Log issues with severity, owner, due date, and status, and generate a daily report.

### 20. What does point-in-time backtracking and replay need to support?
- **Question:** The prompt requires replay of a sample of transactions, diffing two points in time, and documenting corrective actions, but it does not specify whether the whole system must be event-sourced.
- **My Understanding:** Full event sourcing is not required as long as the system can reconstruct meaningful operational history from audit/version/movement records.
- **Solution:** Use schedule version history, audit trails, and inventory movement logs to provide read-only replay of sampled transactions, diff views between two timestamps, and corrective-action records linked to the affected schedule/inventory events.
