# Phase 3: Production-Safe Customer Operations - Pattern Map

**Mapped:** 2026-09-11
**Files analyzed:** 24 likely new/modified files
**Analogs found:** 22 / 24
**Locked decisions applied:** D-01 through D-12 (`03-CONTEXT.md`)
**Plan decomposition applied:** 03-01 (durable authorized API foundation), 03-02 (server-backed console, archive and audit UI), 03-03 (production hardening, migration and verification)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `wrangler.jsonc` | config | deployment | same file (static assets Worker) | exact |
| `worker/src/index.ts` | route/entry | request-response | `src/app/router.tsx` (route composition) | role-match |
| `worker/src/auth/access-jwt.ts` | service/utility | deterministic transform | `src/domain/ledger-rules.ts` (pure validation module) | role-match |
| `worker/src/auth/identity.ts` | model | transform | `src/domain/types.ts` (serializable identity contract) | role-match |
| `worker/src/db/schema.sql` | config/fixture | batch construction | `src/data/seed-data.ts` (deterministic store construction) | role-match |
| `worker/src/db/statements.ts` | store/repository | synchronous CRUD | `src/data/local-storage-repository.ts` (typed read/write helpers) | role-match |
| `worker/src/routes/*.ts` | route/component | request-response mutation | `src/features/customers/pages/*.tsx` (purpose-built operation handlers) | role-match |
| `worker/src/audit/audit.ts` | service/utility | deterministic transform | `src/domain/commercial-rules.ts` (event/activity ID helpers) | role-match |
| `worker/src/errors.ts` | service/utility | transform | `src/features/customers/components/format.ts` (shared presentation/error helpers) | role-match |
| `worker/src/types.ts` | model | transform / CRUD contract | `src/domain/types.ts` (DTO contracts) | role-match |
| `worker/test/access-jwt.test.ts` | test | pure transform | `src/domain/ledger-rules.test.ts` (table-driven pure tests) | role-match |
| `worker/test/api.integration.test.ts` | test | CRUD/migration contract | `src/data/local-storage-repository.test.ts` (repository contract tests) | role-match |
| `src/domain/types.ts` | model | transform / CRUD contract | same file, `CustomerStatus`, `DataStore`, `STORE_SCHEMA_VERSION` | exact |
| `src/data/api-repository.ts` | store/repository | async request-response | `src/data/local-storage-repository.ts` (implements `HiveRepository`) | exact |
| `src/data/repository-context.tsx` | component/context | dependency injection | same file | exact |
| `src/data/local-storage-repository.ts` | store/repository | async CRUD + migration | same file | exact |
| `src/data/seed-data.ts` | fixture/config | batch construction | same file | exact |
| `src/features/customers/components/ArchiveCustomerDialog.tsx` | component/form | request-response mutation | `DeleteCustomerAction` in `CustomersPage.tsx:362-413` | exact |
| `src/features/customers/components/OperatorAuditTrail.tsx` | component | projection/collection | `ActivityTimeline.tsx` + `TokenStatement.tsx` | role-match |
| `src/features/customers/pages/CustomersPage.tsx` | route/component | aggregate read + CRUD actions | same file | exact |
| `src/features/customers/pages/CustomerProfilePage.tsx` | route/component | aggregate read + CRUD actions | same file | exact |
| `src/components/layout/Sidebar.tsx` | component | presentation | same file (Access logout link) | exact |
| `e2e/console.spec.ts` | browser test | end-to-end request-response | same file | exact |
| `.planning/phases/03-production-safe-customer-operations/VERIFICATION.md` | doc | phase evidence | Phase 1/2 `VERIFICATION.md` | exact |

The Worker file names are planner-level recommendations, not a requirement to create parallel abstractions. Keep the Worker under `worker/` with relative imports into `src/domain/` for the shared pure rules, and do not introduce a generic CRUD framework, a second design system, or a new top-level SPA route.

## Pattern Assignments

### `wrangler.jsonc` (Plan 03-01)

**Analog:** same file.

**Worker + D1 binding pattern** (`wrangler.jsonc:1-8`): keep the static-assets configuration (`assets.directory: "./dist"`, `not_found_handling: "single-page-application"`) and add the D1 binding (e.g. `d1_databases: [{ binding: "DB", database_name: "hivarium-operator-console", database_id: "<id>" }]`) plus the Worker entry (`main: "worker/src/index.ts"`). The single Worker serves both `/api/*` and the SPA assets, preserving Cloudflare static-SPA compatibility while deliberately introducing the backend (D-01, AGENTS.md deployment constraint).

**Conventions to preserve:** SPA fallback intact; no secrets in the committed file — Access AUD/team domain arrive via environment bindings/secrets.

### `worker/src/index.ts` (Plans 03-01, 03-03)

**Analog:** `src/app/router.tsx` (route composition).

**Route composition pattern** (`src/app/router.tsx:40-113`): a single `fetch` handler that (1) routes `/api/*` to the purpose-built handlers, (2) serves static assets for everything else, and (3) applies the auth middleware to every `/api/*` request before any route logic. Route matching is explicit and small — no generic CRUD router (D-02).

**Auth middleware pattern** (`worker/src/auth/access-jwt.ts`): every `/api/*` request must carry `Cf-Access-Jwt-Assertion`; missing header → `401`; verify signature against the cached Access JWKS, check `iss`/`aud`/`exp`/`nbf`, then attach `OperatorIdentity` to the request context (D-03, D-04).

**Conventions to preserve:** deterministic behavior, stable human-readable errors, no secrets in code, explicit route table that maps one-to-one to console workflows.

### `worker/src/auth/access-jwt.ts` (Plan 03-01)

**Analog:** `src/domain/ledger-rules.ts` (pure validation module).

**Pure verification module pattern** (`src/domain/ledger-rules.ts:1-9`): export pure functions that take explicit inputs and return a typed result: `verifyAccessJwt(token, { jwks, issuer, audience, now })` returning `{ ok: true, identity } | { ok: false, reason }`. Signature verification uses `crypto.subtle.verify` (RS256) against the matching JWKS key; claims checks cover `iss`, `aud`, `exp`, and `nbf`. The JWKS fetch is cached with a short TTL (e.g. 5 minutes) and refreshed on failure. No React imports, no `Date.now()` inside the pure check — the current time is passed in for testability.

**Conventions to preserve:** deterministic, table-testable, stable error reasons (`missing-header`, `invalid-signature`, `expired`, `wrong-audience`, `wrong-issuer`).

### `worker/src/auth/identity.ts` (Plan 03-01)

**Analog:** `src/domain/types.ts` (serializable contracts).

**Identity contract pattern** (`src/domain/types.ts:28-37`): define `OperatorIdentity { email: string; sub: string; name: string }` as a plain serializable interface with JSDoc. The identity is derived only from verified JWT claims and is attached to every request context; it feeds the audit writer (D-04, D-06).

**Conventions to preserve:** plain JSON-compatible values, `import type` where practical, JSDoc on public types.

### `worker/src/db/schema.sql` (Plans 03-01, 03-03)

**Analog:** `src/data/seed-data.ts` (deterministic store construction).

**Versioned schema pattern** (`src/domain/types.ts:347-359`): one D1 migration per schema change. Tables mirror the canonical `DataStore` collections: `customers` (with `status` including `archived`), `commercial_arrangements`, `agent_access_grants`, `activity_events`, `ledger_transactions`, `usage_records`, `audit_entries`, `feature_entitlements`, and `agent_products`. Ledger and usage tables are append-only by convention (no UPDATE/DELETE paths in the API) (D-12). `audit_entries` carries `operator_email`, `operator_sub`, `action`, `subject_type`, `subject_id`, `summary`, `before_json`, `after_json` (D-06).

**Conventions to preserve:** deterministic IDs as primary keys, ISO-8601 timestamps as TEXT, JSON columns only for before/after audit snapshots, no stored balance counter anywhere.

### `worker/src/db/statements.ts` (Plans 03-01, 03-02, 03-03)

**Analog:** `src/data/local-storage-repository.ts` (typed read/write helpers).

**Typed statement pattern** (`src/data/local-storage-repository.ts:169-364`): small typed helper functions wrapping D1 prepared statements (`getCustomerById`, `listCustomers`, `insertCustomer`, `insertLedgerTransaction`, `insertAuditEntry`, etc.). All mutation helpers are used inside `env.DB.batch()` so the mutation rows and the audit row commit atomically (D-06).

**Conventions to preserve:** repository is the only data boundary; mutations throw descriptive errors; deterministic timestamps passed in.

### `worker/src/routes/*.ts` (Plans 03-01, 03-02, 03-03)

**Analog:** `src/features/customers/pages/*.tsx` (purpose-built operation handlers).

**Purpose-built handler pattern** (`src/features/customers/pages/CustomersPage.tsx:362-413`): one handler per console workflow (customers, commercial, access, ledger, usage, audit, agents, me, health). Each mutation handler: validates the typed DTO, loads current rows, runs the shared pure rules (`src/domain/commercial-rules.ts`, `src/domain/ledger-rules.ts` via relative imports), produces next-state rows plus the audit entry, and commits via `env.DB.batch()`. No generic resource CRUD (D-02).

**Archive handler pattern** (`CustomersPage.tsx:362-413` analog): `POST /api/customers/:id/archive` validates the customer exists and is not already archived, flips `status` to `archived`, and appends activity + audit rows in the same transaction — dependent tables are never touched (D-05, SAFE-01).

**Conventions to preserve:** server-authoritative validation (D-07), one transaction per mutation, stable error envelope, `401` for unauthenticated requests.

### `worker/src/audit/audit.ts` (Plans 03-01, 03-02, 03-03)

**Analog:** `src/domain/commercial-rules.ts` (deterministic event/activity ID helpers).

**Deterministic audit writer pattern** (`src/domain/commercial-rules.ts:690-737`): `auditEntryId(action, subjectId, occurredAt)` derives a deterministic ID; `buildAuditEntry({ identity, action, customerId, subjectType, subjectId, summary, before, after, occurredAt })` returns the row. The writer is called inside the same D1 batch as the mutation; audit rows are never updated or deleted (D-06, SAFE-05).

**Conventions to preserve:** deterministic IDs, explicit timestamps, stable human-readable summaries, no React imports.

### `worker/src/errors.ts` (Plans 03-01, 03-03)

**Analog:** `src/features/customers/components/format.ts` (shared helpers).

**Error envelope pattern** (`src/features/customers/components/format.ts:12-14`): `ApiError` with `status` and `code`; `errorResponse(error)` returns `{ error: { code, message } }` with the right HTTP status (`400` validation, `401` auth, `404` missing, `409` conflict/idempotency, `500` unexpected). The SPA maps these codes to the existing toast/error copy.

**Conventions to preserve:** stable machine-readable codes, human-readable messages, no stack traces in responses.

### `worker/src/types.ts` (Plan 03-01)

**Analog:** `src/domain/types.ts` (DTO contracts).

**DTO contract pattern** (`src/domain/types.ts:28-37`): request/response DTOs for every endpoint (`CreateCustomerRequest`, `ArchiveCustomerRequest`, `AddCreditRequest`, `RecordUsageRequest`, `AuditEntryDto`, etc.). DTOs are plain serializable interfaces; validation happens server-side against them (D-07).

**Conventions to preserve:** plain JSON-compatible values, string unions over loose strings, JSDoc on public types.

### `src/domain/types.ts` (Plans 03-01, 03-02)

**Analog:** same file.

**Lifecycle union extension** (`src/domain/types.ts:14,440-453`): add `"archived"` to `CustomerStatus` and `CUSTOMER_STATUSES`; extend `normalizeCustomerStatus` to pass `archived` through while keeping legacy aliases. Bump `STORE_SCHEMA_VERSION` to `4` and add the v3→v4 migration defaulting (archived status absent → unchanged) so the demo adapter stays consistent (D-05).

**Conventions to preserve:** plain JSON-compatible values; deterministic stable IDs; string unions; JSDoc; no behavior in types.

### `src/data/api-repository.ts` (Plan 03-02)

**Analog:** `src/data/local-storage-repository.ts` (implements `HiveRepository`).

**Async adapter pattern** (`src/data/local-storage-repository.ts:169-364`): `ApiRepository implements HiveRepository` where every method returns a `Promise`. Reads call the corresponding `GET` endpoint and map DTOs back to domain records; mutations call the purpose-built endpoints and map errors from the envelope to descriptive `Error`s. The `Cf-Access-Jwt-Assertion` header is attached by the browser when behind Access; the adapter reads identity through `GET /api/me` (A2 in `03-RESEARCH.md`).

**Conventions to preserve:** `HiveRepository` is the only feature-layer read/write boundary; pages call `useRepository()`; mutations throw descriptive errors; no storage access from components.

### `src/data/repository-context.tsx` (Plan 03-02)

**Analog:** same file.

**Async injection pattern** (`src/data/repository-context.tsx:5-27`): keep `RepositoryProvider`/`useRepository()`; the context value becomes the async `HiveRepository`. Pages that need a synchronous demo fallback may keep `LocalStorageRepository` behind the same async signature for tests (D-10).

**Conventions to preserve:** dependency injection for pages and tests; no direct storage access.

### `src/data/local-storage-repository.ts` (Plans 03-02, 03-03)

**Analog:** same file.

**Async signature conversion** (`src/data/local-storage-repository.ts:169-364`): every `HiveRepository` method becomes `Promise`-returning; `LocalStorageRepository` resolves immediately (or via a microtask) so component tests stay fast. `deleteCustomer` is removed from the contract and replaced by `archiveCustomer(customerId, reason, occurredAt)` which flips status to `archived` and appends activity rows — dependent records are retained (D-05). Extend `migrateStore` for v3→v4 (archived status defaulting).

**Migration seam** (`src/data/local-storage-repository.ts:584-639`): keep `STORAGE_KEY` and `MIGRATION_TIMESTAMP` stable; the v3→v4 migration is deterministic and idempotent.

**Conventions to preserve:** repository is the only feature-layer read/write boundary; mutations throw descriptive errors; deterministic timestamps; one-write commits.

### `src/data/seed-data.ts` (Plans 03-02, 03-03)

**Analog:** same file.

**Seed builder pattern** (`src/data/seed-data.ts:901`): keep the deterministic six-customer baseline; add one archived customer fixture (e.g. `cust_sablefin` archived) so the archived list filter, banner, and read-only profile are visible in the demo. `buildSeedStore` remains the canonical source for the D1 seed and the import path (D-11).

**Conventions to preserve:** explicit timestamps for repeatable rendering/tests; stable deterministic IDs; fictional data only.

### `src/features/customers/components/ArchiveCustomerDialog.tsx` (Plan 03-02)

**Analog:** `DeleteCustomerAction` in `CustomersPage.tsx:362-413`.

**Named-customer confirmation pattern** (`CustomersPage.tsx:391-410`): an `AlertDialog` titled `Archive {customer.name}?` whose description states `All contracts, agent-access history, ledger transactions, and usage records will be retained and remain available.` Actions are `Cancel` and `Archive customer`; the final action is enabled only when the form is valid; pending verb `Archiving…` disables double submission. On success, the row leaves the default list, the toast announces the archive, and the profile becomes read-only (D-05, SAFE-01, SAFE-02).

**Conventions to preserve:** named subject + explicit consequence; focus restore to the invoking control; warm minimal visual language; no destructive red for archive (retention is not destruction).

### `src/features/customers/components/OperatorAuditTrail.tsx` (Plan 03-02)

**Analog:** `ActivityTimeline.tsx` + `TokenStatement.tsx`.

**Chronological projection** (`ActivityTimeline.tsx:14-85`): render newest-first inside the existing Activity tab, below the token statement and commercial/access history, as a distinct `Operator audit trail` section. Rows expose `When`, `Operator` (email), `Action`, `Subject`, and `Summary`; the section is read-only and never duplicates ledger or activity events (D-06, Phase 2 D-13).

**Table pattern** (`CustomerProfilePage.tsx:402-413`): use `DataTable`/`DataTableColumn` with a caption `Operator audit trail for {customer}` and semantic headers; bounded horizontal scroll; `tabular-nums` for timestamps.

**Data flow through `HiveRepository`:** `repo.listAuditEntries(customerId)` read via `useMemo`; empty state uses the exact UI-SPEC copy.

**Conventions to preserve:** newest-first deterministic ordering; `tabular-nums`; monospace stable references; empty states with exact copy; no charts/KPI grids; no fifth profile tab.

### `src/features/customers/pages/CustomersPage.tsx` (Plan 03-02)

**Analog:** same file.

**Collection projection** (`CustomersPage.tsx:58-99`): extend the lifecycle filter with an `Archived` option; archived customers are excluded from the default list; the summary strip's `Archived` count now counts the archived status (currently it counts churned — correct it). Replace `DeleteCustomerAction` with `ArchiveCustomerAction` (D-05).

**Conventions to preserve:** restrained summary strip; no KPI cards, global banners, or new routes; `tabular-nums`; warm minimal visual language.

### `src/features/customers/pages/CustomerProfilePage.tsx` (Plan 03-02)

**Analog:** same file.

**Aggregate query pattern** (`CustomerProfilePage.tsx:54-79`): keep the four-tab composition and revision-counter refresh, now over async repository reads. Add loading skeletons and an error state with retry in the existing visual language (D-10). For archived customers, render a banner (`This customer is archived. Records are retained and read-only.`) and hide all mutation actions while keeping every tab readable (D-05). Compose `OperatorAuditTrail` inside the Activity tab.

**Conventions to preserve:** exactly four top-level tabs; `useRepository()` only; `useMemo` projections; `data-testid` for stable product entities; missing-customer empty state.

### `src/components/layout/Sidebar.tsx` (Plan 03-02)

**Analog:** same file.

**Identity display pattern** (`Sidebar.tsx` Access logout link): show `Signed in as {email}` (from `GET /api/me`) near the existing Cloudflare Access logout link; when the API returns `401`, show the sign-in-required state instead of the console (D-04).

**Conventions to preserve:** Cloudflare Access logout link retained; warm minimal visual language; no new navigation items.

### `e2e/console.spec.ts` (Plans 03-02, 03-03)

**Analog:** same file.

**Deterministic reset pattern** (`console.spec.ts:17-24`): replace the localStorage init script with a D1 reset path (test-only reset endpoint or `wrangler d1 execute` before the suite) so every scenario starts from the canonical seed (Pitfall 6 in `03-RESEARCH.md`). Keep role/label/testid queries and reload-persistence assertions. Do **not** copy conditional skip behavior.

**Conventions to preserve:** strict no-skip flows; exact high-impact copy; persisted results survive reload.

## Test Pattern Assignments

### `worker/test/access-jwt.test.ts` (new)

**Analog:** `src/domain/ledger-rules.test.ts` (table-driven pure tests).

Cover: missing header; invalid signature; expired token; wrong audience; wrong issuer; valid token returns the expected identity; JWKS cache refresh behavior.

### `worker/test/api.integration.test.ts` (new)

**Analog:** `src/data/local-storage-repository.test.ts` + `createInMemoryRepository`.

Cover: authenticated round-trip persists in D1 and writes one audit entry; unauthenticated/unauthorized requests return `401` for every mutation route; archive retains all dependent records; audit rows are immutable; ledger arithmetic and idempotent usage enforced server-side; v3→v4 and D1 seed/import idempotency.

### `src/data/api-repository.test.ts` (new)

**Analog:** `src/data/local-storage-repository.test.ts`.

Cover: mocked `fetch` mapping for every method; error-envelope mapping to descriptive `Error`s; identity header handling; async contract (all methods return Promises).

### `src/data/local-storage-repository.test.ts` (extended)

**Analog:** same file.

Cover: async signature; `archiveCustomer` retains dependent records and appends activity rows; `deleteCustomer` removed from the contract; v3→v4 migration defaulting; existing Phase 1/2 invariants remain green.

### `src/features/customers/pages/CustomersPage.test.tsx` (extended)

**Analog:** same file.

Cover: archive confirmation copy; archived rows excluded by default and visible under the Archived filter; summary strip counts archived correctly; async loading/error states.

### `src/features/customers/pages/CustomerProfilePage.test.tsx` (extended)

**Analog:** same file, `renderProfilePath` helper.

Cover: archived banner and read-only profile; audit trail rows render newest-first; async loading/error states; existing four-tab flows remain green.

### `e2e/console.spec.ts` (extended)

**Analog:** same file.

Keep the deterministic reset path, role/label/testid queries, and reload-persistence assertions. Add strict no-skip flows: one authenticated archive journey (archive → leaves default list → archived filter → read-only profile with retained records); one audit trail journey (commercial change, credit operation, and archive each appear with operator identity); one permission-failure journey (unauthenticated request rejected); and the full existing console regression against the API-backed SPA.

## Shared Patterns

### Repository injection

**Source:** `src/data/repository-context.tsx:5-27`

Apply to all feature pages/components. Accept the repository through `RepositoryProvider`; call `useRepository()` inside the feature. Do not access storage or fetch from components.

### Error handling

**Source:** `CommercialArrangementSheet.tsx:402-417`

Repository methods throw descriptive `Error`s; UI catches them, retains form state, and shows `toast.error`. API error codes map to the UI-SPEC copy (sign-in required, archive conflict, server validation, etc.) and never partially persist.

### Accessible overlays

**Source:** `components/ui/sheet.tsx`, `components/ui/alert-dialog.tsx`

Use Radix-owned portal/focus/escape behavior and semantic titles/descriptions. Never hand-roll an overlay. Block closing only while a mutation is committing; return focus to the invoking control.

### Status, labels, and visual tone

**Source:** `seed-data.ts:36-55`, `CustomerProfilePage.tsx:423-469`

Centralize labels/classes, pair every color with text, use `tabular-nums` for amounts/dates/counts, keep IDs/references monospace and subordinate to human names, and retain warm card/border tokens. Archived uses neutral/sage, never destructive red; audit rows are neutral metadata.

### Deterministic ordering

**Source:** `CustomersPage.tsx:58-70`, `local-storage-repository.ts:916-920`

Compute filtered/joined projections with `useMemo`, sort explicitly, and construct lookup maps before rendering. Audit rows render newest first; statement rows keep full-account running balances.

### Server-authoritative rules

**Source:** `src/domain/commercial-rules.ts:1-8`, `src/domain/ledger-rules.ts:1-9`

The Worker imports the shared pure rules via relative paths and enforces them before any D1 write; the SPA uses the same rules only for deterministic previews. Never duplicate rule logic in route handlers or components (D-07).

## No Analog Found

| File | Role | Data Flow | Reason / Planner Guidance |
|---|---|---|---|
| `worker/src/auth/access-jwt.ts` | service/utility | deterministic transform | No JWT verification exists in the repo. Model it as a pure verification module mirroring `ledger-rules.ts`; use Web Crypto `crypto.subtle.verify` against the cached Access JWKS. |
| `worker/src/db/schema.sql` | config/fixture | batch construction | No SQL schema exists. Mirror the canonical `DataStore` collections one-to-one; keep ledger/usage append-only and audit immutable. |
| `worker/test/api.integration.test.ts` | test | CRUD/migration contract | No Worker integration tests exist. Use a local D1 binding (`wrangler dev --local` or an in-memory D1 test binding) and mirror `local-storage-repository.test.ts` structure. |

There is also no existing async repository or audit trail. Compose the existing `HiveRepository` contract, Radix primitives, `DataTable`, and `ActivityTimeline` patterns; do not use the unrelated Refine-generated forms/layouts.

## Anti-Patterns to Avoid

- Do not build a generic CRUD API, a Refine data provider against the API, or endpoints that do not map to a console workflow (D-02).
- Do not authorize mutations in the browser; the Worker enforces every mutation through shared pure rules (D-07).
- Do not hard-delete customers; archive flips the lifecycle status and retains every dependent record (D-05, SAFE-01).
- Do not store a balance counter in D1; balances are always derived from append-only ledger rows (D-12).
- Do not introduce session cookies or a server-side session store; identity is per-request from the verified JWT (D-04).
- Do not add Stripe, payment, invoice, or tax language, endpoints, or UI (D-09).
- Do not redesign the console, add new top-level routes, or add a fifth profile tab (D-08).
- Do not write audit entries outside the mutation transaction or allow audit rows to be edited/deleted (D-06).
- Do not duplicate ledger events into `ActivityEvent` or audit rows into the commercial/access timeline (Phase 2 D-13).
- Do not add conditional E2E skips, sleeps, or weakened assertions; the API-backed suite must fail loudly.
- Do not grow the SPA dependency tree; Worker-side additions are limited to what the D1/JWT integration requires.

## Metadata

**Analog search scope:** `src/domain`, `src/data`, `src/features/customers`, `src/components`, `src/app`, `e2e`, `wrangler.jsonc`

**Primary files read:** 24 planning/source/test files plus the Phase 3 CONTEXT/RESEARCH/UI-SPEC contracts

**Pattern extraction date:** 2026-09-11