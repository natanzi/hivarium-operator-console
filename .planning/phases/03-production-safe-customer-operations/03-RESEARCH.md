# Phase 3: Production-Safe Customer Operations - Research

**Researched:** 2026-09-11  
**Domain:** Cloudflare D1 durable storage, Cloudflare Access JWT verification, purpose-built Worker API, non-destructive archival, immutable operator audit, async repository boundary  
**Confidence:** HIGH for repository seams, pure-rule sharing, and locked product behavior; MEDIUM for Cloudflare Access JWT/JWKS specifics and D1 local-testing ergonomics

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Durable storage and API shape
- **D-01:** Real customer, contract, entitlement, ledger, usage, and audit records persist in a Cloudflare D1 (SQLite) database owned by the Worker API. D1 is the single durable source of truth; browser localStorage is demoted to the deterministic demo/test adapter and is never the source of truth for production records (SAFE-03).
- **D-02:** The API is a small, purpose-built Cloudflare Worker API exposing exactly the operations the console needs: customer list/get/create/update/archive, commercial snapshot/save/terminate, agent-access snapshot/grant/revoke, ledger statement/credit/usage/adjustment/reversal/threshold, usage summary, agent catalog reads, audit reads, and operator identity. No generic resource CRUD framework, no Refine data provider against the API, no auto-generated endpoints, and no endpoint that does not map to a console workflow.
- **D-03:** Authentication is Cloudflare Access JWT verification. Every API request must carry a valid `Cf-Access-Jwt-Assertion` header; the Worker verifies the JWT signature against the Access team's public JWKS, checks issuer, audience (the Access application AUD), and expiry, and rejects missing/invalid tokens with `401`. Cloudflare Access remains the perimeter; no new public login surface is introduced (SAFE-04).
- **D-04:** Operator identity and session come from the verified JWT claims (`email`, `sub`, `name`). The API is stateless per request — no session cookies, no server-side session store, no refresh-token machinery. `GET /api/me` returns the current operator identity so the SPA can display `Signed in as {email}` and fail closed when unauthenticated.

#### Retention and audit
- **D-05:** Archive replaces delete. Customer deletion is removed from the product. `archiveCustomer` transitions a customer to the `archived` lifecycle state while retaining every contract, agent-access grant, ledger transaction, usage record, and activity event. Archived customers are excluded from the default list, appear under an `Archived` lifecycle filter, and their profile is read-only with an archived banner (SAFE-01).
- **D-06:** Audit entries are server-written and immutable. Every commercial-model change, agent-access change, credit operation (credit grant, usage debit, manual adjustment, reversal, threshold change), and customer archival appends an audit entry recording the verified operator identity, action, timestamp, subject, and a before/after summary. The audit entry is written in the same D1 transaction as the mutation and is never editable or deletable (SAFE-05).
- **D-07:** The server is the authoritative enforcement point. All commercial-model validation, ledger arithmetic, source-reference idempotency, no-negative-balance guards, and lifecycle invariants are enforced by the Worker using the same pure rules the SPA already uses (`src/domain/commercial-rules.ts`, `src/domain/ledger-rules.ts`, imported by the Worker via relative paths). The SPA may preview results (e.g., resulting balance) but the server is authoritative; a client can never bypass validation (SAFE-04, SAFE-06).

#### UI and data-layer contract
- **D-08:** The UI is preserved. The existing React SPA, four profile tabs, warm minimal visual language, Radix confirmation patterns, copy conventions, and responsive behavior remain. Phase 3 changes the data layer (async repository adapter), replaces delete with archive, adds audit visibility inside the existing Activity tab, and adds operator identity display — it does not redesign the console or add new top-level routes.
- **D-09:** No payment processing. Stripe, card processing, invoicing, tax, and money movement remain out of scope. Token credit remains an operator-confirmed ledger action, not a payment.
- **D-10:** The repository boundary becomes asynchronous. `HiveRepository` methods become `Promise`-returning; an `ApiRepository` adapter calls the Worker API; `LocalStorageRepository` remains as the deterministic demo/test adapter. Pages render loading skeletons and error states while preserving the existing visual language.
- **D-11:** Data migration is deterministic and idempotent. A one-time, operator-triggered, authenticated import path moves the deterministic localStorage demo store into D1 with stable IDs and timestamps; re-running the import never duplicates records. Fresh deployments seed D1 directly from the canonical deterministic seed. Migrating arbitrary real-world browser payloads is out of scope — the console starts from the canonical seed in D1.
- **D-12:** The ledger remains immutable and derived. D1 stores ledger transactions and usage records as append-only rows; balances and statements are always derived server-side from those rows. No stored balance counter exists anywhere (SAFE-06).

### the agent's Discretion
- Exact Worker file layout, route naming, D1 table/column names, JWT cache TTL, skeleton shapes, and fixture values may follow existing project conventions and Cloudflare best practice.
- The planner may split Phase 3 into up to three sequential vertical plans as long as each completed plan leaves the console working and testable.
- The planner may add a small number of Worker-side packages (e.g., `wrangler` D1 tooling) only if required for the D1/JWT integration; the SPA dependency tree must not grow.

### Deferred Ideas (OUT OF SCOPE)
- Automatic usage ingestion from trusted Hivarium runtime events (`AUTO-01`) remains deferred; Phase 3 keeps manual deterministic usage entry.
- Email or in-app low-balance and renewal notifications (`AUTO-02`) remain deferred.
- Statement export, invoicing, card processing, taxes, and general-ledger accounting remain out of scope (`AUTO-03`, out-of-scope table).
- Catalog product creation/edition/versioning (`AUTO-04`) remains out of scope; the agent catalog stays read-only.
- Role-based permissions and two-operator approval (`TEAM-01`, `TEAM-02`) remain out of scope; Phase 3 authorizes any verified Access operator.
- Cross-customer search/reporting (`TEAM-03`) remains out of scope.
- Runtime governance controls, public customer portal, CRM, and ERP features remain out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SAFE-01 | "Operator can archive a customer while retaining contracts, access history, ledger transactions, and usage records" | `archived` lifecycle status plus retention-preserving archive command; delete path removed. [VERIFIED: `.planning/REQUIREMENTS.md:47`; `src/features/customers/pages/CustomersPage.tsx:362-413`] |
| SAFE-03 | "Real customer, contract, entitlement, and ledger records persist in durable server-owned storage rather than browser localStorage" | Cloudflare D1 database owned by the Worker API; localStorage demoted to demo/test adapter. [VERIFIED: `.planning/REQUIREMENTS.md:49`; `wrangler.jsonc:1-8`; `.planning/codebase/CONCERNS.md:7-14`] |
| SAFE-04 | "Server-side authorization restricts all customer and financial mutations to an authenticated operator" | Per-request Cloudflare Access JWT verification (`Cf-Access-Jwt-Assertion`) with JWKS signature, issuer, audience, and expiry checks; every mutation route rejects unauthenticated requests with `401`. [VERIFIED: `.planning/REQUIREMENTS.md:50`; `.planning/codebase/INTEGRATIONS.md:7-12`] |
| SAFE-05 | "System records an audit entry for commercial-model changes, agent-access changes, credit operations, and customer archival" | Immutable `audit_entries` table written in the same D1 transaction as each mutation, carrying verified operator identity, action, timestamp, subject, and before/after summary. [VERIFIED: `.planning/REQUIREMENTS.md:51`] |
| SAFE-06 | "Automated tests verify commercial-model validation, ledger arithmetic, idempotent usage, permissions, and principal operator flows" | Shared pure rules unit tests, Worker integration tests against a local D1, permission-failure tests, and API-backed Playwright E2E. [VERIFIED: `.planning/REQUIREMENTS.md:52`; `package.json:94-102`] |

## Summary

Phase 3 should be built as a small durable backend behind the existing `HiveRepository` seam, not as a generic platform. The codebase already has the correct architectural seams: pure domain rules with relative-only imports (`src/domain/commercial-rules.ts:10-26`, `src/domain/ledger-rules.ts:11-19`), a single repository boundary (`src/data/local-storage-repository.ts:169-364`), a repository injection context (`src/data/repository-context.tsx:5-27`), deterministic fixtures (`src/data/seed-data.ts:901`), a static-assets Worker deployment (`wrangler.jsonc:1-8`), Vitest, and Playwright. [VERIFIED: `src/domain/commercial-rules.ts:10-26`; `src/domain/ledger-rules.ts:11-19`; `src/data/local-storage-repository.ts:169-364`; `src/data/repository-context.tsx:5-27`; `src/data/seed-data.ts:901`; `wrangler.jsonc:1-8`; `package.json:94-102`]

The required change is a real architectural shift. The current `HiveRepository` is entirely synchronous and pages assume immediate reads after writes; `wrangler.jsonc` deploys only static assets with no D1 binding; and `CustomersPage.tsx` still hard-deletes customers through `deleteCustomer` with a confirmation that promises permanent removal. [VERIFIED: `src/data/local-storage-repository.ts:169-183`; `wrangler.jsonc:1-8`; `src/features/customers/pages/CustomersPage.tsx:362-413`] Phase 3 must introduce D1, a JWT-verifying Worker API, an async repository adapter, archive semantics, and server-written audit entries while keeping every Phase 1/2 workflow visually intact.

Use one shared pure-rules module set for both sides: the Worker imports `src/domain/commercial-rules.ts` and `src/domain/ledger-rules.ts` via relative paths and enforces them authoritatively before any D1 write; the SPA keeps using them for deterministic previews (resulting balance, low-balance state) but never as the enforcement boundary. [VERIFIED: `src/domain/commercial-rules.ts:1-8`; `src/domain/ledger-rules.ts:1-9`; D-07]

**Primary recommendation:** Implement three sequential vertical plans: (1) D1 schema + JWT-verifying Worker API + authoritative rules + audit writer + authenticated tracer, (2) async repository adapter + archive workflow + audit trail UI + identity display, and (3) deterministic D1 seed/import + hardening + full API-backed verification.

## Project Constraints (from AGENTS.md)

- Keep the product an internal customer-operations console; do not expand into CRM, ERP, or runtime governance. [VERIFIED: `AGENTS.md:13-16`]
- Cloudflare Access remains the perimeter; Phase 3 adds server-side authorization before multi-user use. [VERIFIED: `AGENTS.md:16-18`]
- Balances must be derived from immutable transactions; `localStorage` is acceptable only for deterministic demo flows — real records require durable server-owned storage. [VERIFIED: `AGENTS.md:17-18`]
- Deliver visible vertical slices that remain testable, preserve the warm minimal accessible UI, and retain Cloudflare static-SPA compatibility until a backend deployment is deliberately introduced — Phase 3 is that deliberate introduction. [VERIFIED: `AGENTS.md:19-21`]
- Work must stay inside a GSD workflow; direct repository changes outside it are forbidden unless explicitly bypassed. [VERIFIED: `AGENTS.md:219-231`]
- No project-local skills were found. [VERIFIED: `AGENTS.md:212-216`]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Commercial/ledger validation, arithmetic, idempotency, reversal, and lifecycle invariants | Worker (authoritative) | Shared `src/domain` pure rules | D-07 locks server-side enforcement; the pure rules are already side-effect-free with relative-only imports. [VERIFIED: `src/domain/commercial-rules.ts:1-8`; `src/domain/ledger-rules.ts:1-9`] |
| Durable persistence and transactional writes | Cloudflare D1 | Worker API | D-01 locks D1 as the single source of truth; audit entries commit in the same transaction as mutations (D-06). |
| Authentication and operator identity | Worker auth middleware | Cloudflare Access JWT | D-03/D-04 lock per-request JWT verification and stateless identity from verified claims. |
| Archive lifecycle and retention | Worker API + D1 | SPA presentation | D-05 locks archive-replaces-delete with full record retention. |
| Audit entry recording | Worker API + D1 | SPA read-only presentation | D-06 locks server-written immutable audit entries; the SPA only renders them. |
| Async repository boundary and UI states | SPA data layer | SPA presentation | D-10 locks the async `HiveRepository`; pages render skeletons/errors in the existing visual language. |
| Deterministic seed/import into D1 | Worker migration path | D1 seed SQL | D-11 locks deterministic, idempotent migration; arbitrary real payloads are out of scope. |
| Payment processing, invoicing, tax, runtime ingestion, notifications | — | — | Explicitly out of scope (D-09, deferred list). |

## Standard Stack

### Core

| Library / module | Version | Purpose | Why Standard Here |
|------------------|---------|---------|-------------------|
| Cloudflare Workers | platform | Purpose-built API + static assets | Existing deployment target; `wrangler.jsonc` already deploys `dist/` as a Worker. [VERIFIED: `wrangler.jsonc:1-8`] |
| Cloudflare D1 | platform | Durable SQLite storage | D-01 locks D1 as the durable source of truth; no external database service is introduced. |
| Cloudflare Access JWT | platform | Per-request operator authentication | D-03 locks `Cf-Access-Jwt-Assertion` verification; Access is already the perimeter. [VERIFIED: `.planning/codebase/INTEGRATIONS.md:7-12`] |
| TypeScript | `^5.8.3` | Worker + SPA shared types and rules | Existing strict domain model. [VERIFIED: `package.json:89`] |
| Shared `src/domain` pure rules | in-repo | Authoritative server-side validation + SPA previews | D-07; both rule modules use relative imports only. [VERIFIED: `src/domain/commercial-rules.ts:10-26`; `src/domain/ledger-rules.ts:11-19`] |
| Existing `HiveRepository` seam | in-repo | Async repository boundary | D-10; `ApiRepository` implements the same contract the pages already use. [VERIFIED: `src/data/local-storage-repository.ts:169-364`] |
| Existing Radix AlertDialog/Sheet primitives | `@radix-ui/react-alert-dialog ^1.1.11`, `@radix-ui/react-dialog ^1.1.11` | Archive confirmation and audit presentation | Existing confirmed-action pattern. [VERIFIED: `package.json:9,15`; `src/features/customers/pages/CustomersPage.tsx:380-410`] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `wrangler` | current (already used for deploy) | D1 migrations, local dev, deploy | Required for D1 schema management and local Worker testing. |
| Vitest + Testing Library | `^4.1.11` + existing | Pure-rule, adapter, and component tests | Existing test stack. [VERIFIED: `package.json:71-76,87,92`] |
| Playwright | `^1.63.0` | API-backed principal operator flows | Existing E2E gate; webServer must start the local Worker + D1. [VERIFIED: `package.json:71,100`; `playwright.config.ts:21-25`] |
| Web Crypto (`crypto.subtle`) | platform | RS256 JWT signature verification | Standard Workers JWT verification; no JWT library required. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Cloudflare D1 | External Postgres/MySQL, Turso, Supabase | Rejected: D1 keeps the deployment inside the existing Cloudflare surface, needs no new account/service, and is the smallest durable SQLite that satisfies SAFE-03. |
| Purpose-built Worker API | Generic CRUD framework / Refine data provider / auto-generated REST | Rejected by D-02: generic CRUD invites endpoints that do not map to console workflows and weakens the audit/authorization story. |
| Cloudflare Access JWT verification | Custom login, session cookies, API keys | Rejected by D-03/D-04: Access is already the perimeter; per-request JWT verification adds server authorization without a new login surface. |
| Async `ApiRepository` | Keep synchronous localStorage | Rejected by SAFE-03/D-10: durable storage requires network I/O; the repository boundary must become async. |
| Stripe / payment provider | Token credit as operator action | Rejected by D-09: no money movement in this product. |

**Installation:** No new SPA dependency. Worker-side tooling (`wrangler`) is already present; add only what the D1/JWT integration requires.

## Architecture Patterns

### System Architecture Diagram

```text
Operator browser (React SPA, unchanged UI)
    |
    | fetch() with Cf-Access-Jwt-Assertion header (from Cloudflare Access)
    v
Cloudflare Worker (single Worker: /api/* + static assets)
    |---- verify Access JWT (JWKS signature, iss, aud, exp)  [D-03]
    |---- extract OperatorIdentity { email, sub, name }       [D-04]
    v
Purpose-built route handlers (no generic CRUD)               [D-02]
    |---- validate input (server-side, typed)
    |---- enforce shared pure rules (commercial-rules, ledger-rules)  [D-07]
    |---- write mutation + audit entry in ONE D1 transaction  [D-06]
    v
Cloudflare D1 (SQLite)                                        [D-01]
    |---- customers (archived lifecycle)                      [D-05]
    |---- commercial_arrangements, agent_access_grants, activity_events
    |---- ledger_transactions, usage_records (append-only)    [D-12]
    |---- audit_entries (immutable)
    |---- feature_entitlements, agent_products (catalog)
```

The SPA talks only to the Worker API through the async `ApiRepository`; `LocalStorageRepository` remains for deterministic demo/tests. [VERIFIED: `src/data/repository-context.tsx:5-27`; D-10]

### Pattern 1: Per-request Cloudflare Access JWT verification

Every request to `/api/*` must carry `Cf-Access-Jwt-Assertion`. The Worker:

1. Reads the header; missing header → `401`.
2. Fetches and caches the Access public JWKS from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (cache with a short TTL, e.g. 5 minutes).
3. Verifies the JWT signature with `crypto.subtle.verify` (RS256) against the matching key.
4. Checks `iss` (the Access team domain), `aud` (the Access application AUD), and `exp`/`nbf`.
5. Extracts `email`, `sub`, and `name` into `OperatorIdentity` for the request.

This matches Cloudflare's documented JWT validation flow for Access. [CITED: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/] The SPA never inspects identity headers itself; it calls `GET /api/me` and fails closed on `401`. [VERIFIED: `.planning/codebase/INTEGRATIONS.md:7-12`; D-03/D-04]

### Pattern 2: Purpose-built route surface (no generic CRUD)

Expose exactly these operations, each mapping to a console workflow:

| Method + Path | Console Workflow |
|---------------|------------------|
| `GET /api/health` | Liveness + auth check |
| `GET /api/me` | Operator identity display (D-04) |
| `GET /api/customers` | Customer list + lifecycle filters |
| `GET /api/customers/:id` | Customer detail |
| `POST /api/customers` | Create customer |
| `PUT /api/customers/:id` | Update customer identity/lifecycle |
| `POST /api/customers/:id/archive` | Archive customer (D-05, SAFE-01) |
| `GET /api/customers/:id/commercial` | Commercial snapshot |
| `POST /api/customers/:id/commercial` | Save commercial arrangement |
| `POST /api/customers/:id/commercial/:arrangementId/terminate` | Terminate arrangement |
| `GET /api/customers/:id/access` | Agent-access snapshot |
| `POST /api/customers/:id/access` | Grant agent access |
| `POST /api/customers/:id/access/:grantId/revoke` | Revoke agent access |
| `GET /api/customers/:id/ledger` | Account statement (LEDG-05) |
| `POST /api/customers/:id/ledger/credit` | Add credit (LEDG-01) |
| `POST /api/customers/:id/ledger/usage` | Record usage (USGE-01/02) |
| `POST /api/customers/:id/ledger/adjustment` | Manual adjustment (LEDG-04) |
| `POST /api/customers/:id/ledger/reversal` | Reversal (D-05 Phase 2) |
| `PUT /api/customers/:id/ledger/threshold` | Update warning threshold |
| `GET /api/customers/:id/usage-summary` | Usage summary (USGE-03/04) |
| `GET /api/customers/:id/audit` | Customer audit trail (SAFE-05) |
| `GET /api/audit` | Audit trail (filtered) |
| `GET /api/agents` | Agent catalog |
| `GET /api/agents/:id` | Agent detail + reverse access |

Every mutation route requires a verified operator identity and writes its audit entry in the same D1 transaction. There is no `DELETE /api/customers/:id` — archive replaces delete (D-05). [VERIFIED: `src/features/customers/pages/CustomersPage.tsx:362-413`]

### Pattern 3: Shared pure rules as the authoritative enforcement contract

The Worker imports `src/domain/commercial-rules.ts` and `src/domain/ledger-rules.ts` via relative paths (both modules already import only `./types`). [VERIFIED: `src/domain/commercial-rules.ts:10-26`; `src/domain/ledger-rules.ts:11-19`] Each mutation route:

1. Validates the request body shape (typed DTO, server-side).
2. Loads the current customer/arrangement/ledger rows from D1.
3. Runs the shared pure rules (validation, derived balance, idempotency fingerprint, no-negative guard, reversal checks).
4. Produces the next-state rows and the audit entry.
5. Commits the mutation rows and the audit entry in one D1 transaction.

The SPA keeps calling the same rules for deterministic previews (resulting balance, low-balance badge) but the server is authoritative; a tampered client cannot bypass validation. [VERIFIED: `src/domain/ledger-rules.ts:1-9`; D-07]

### Pattern 4: Archive as a non-destructive lifecycle transition

Add `"archived"` to `CustomerStatus` and `CUSTOMER_STATUSES` in `src/domain/types.ts`, bump `STORE_SCHEMA_VERSION` to 4, and extend `normalizeCustomerStatus` to pass `archived` through. [VERIFIED: `src/domain/types.ts:14,440-453`] The archive command:

1. Validates the customer exists and is not already archived.
2. Sets `status: "archived"` (retaining every dependent record).
3. Appends an `activity_events` row and an `audit_entries` row in the same transaction.
4. Returns the archived customer.

The SPA list excludes archived customers by default, offers an `Archived` lifecycle filter, and renders the archived profile read-only with a banner. The existing `DeleteCustomerAction` (CustomersPage.tsx:362-413) becomes `ArchiveCustomerAction` with retention-preserving copy. [VERIFIED: `src/features/customers/pages/CustomersPage.tsx:362-413`; D-05]

### Pattern 5: Immutable audit entries in the mutation transaction

`audit_entries` rows carry `id`, `occurred_at`, `operator_email`, `operator_sub`, `action`, `customer_id`, `subject_type`, `subject_id`, `summary`, and optional `before_json`/`after_json`. The audit writer is called inside the same D1 transaction as the mutation (D-06). Actions covered: `customer.created`, `customer.updated`, `customer.archived`, `commercial.saved`, `commercial.terminated`, `access.granted`, `access.revoked`, `ledger.credit`, `ledger.usage`, `ledger.adjustment`, `ledger.reversal`, `ledger.threshold`. Audit rows are never updated or deleted; the SPA renders them read-only in the Activity tab. [VERIFIED: `.planning/REQUIREMENTS.md:51`; D-06]

### Pattern 6: Async repository boundary with preserved UI

`HiveRepository` methods become `Promise`-returning. `ApiRepository` implements the contract by calling the Worker API with the `Cf-Access-Jwt-Assertion` header (the browser sends it automatically when behind Access; the adapter reads it from a small identity module or passes it through). `LocalStorageRepository` keeps the same async signature for demo/tests. Pages switch from synchronous reads to `useEffect`/`useMemo` async projections with existing skeleton components for loading and a documented error state with retry. The four-tab profile, confirmation dialogs, and copy stay unchanged (D-08). [VERIFIED: `src/data/repository-context.tsx:5-27`; `src/data/local-storage-repository.ts:169-364`]

### Pattern 7: Deterministic D1 seed and idempotent import

Fresh deployments apply a deterministic seed (from `src/data/seed-data.ts` shapes) into D1 via a migration/seed script with stable IDs and `SEED_NOW` timestamps. The operator-triggered import path reads the localStorage payload (or the canonical seed), maps it to D1 rows with the same deterministic IDs, and is guarded by an import marker so re-running never duplicates records (D-11). This mirrors the existing `migrateStore` idempotency guard pattern. [VERIFIED: `src/data/local-storage-repository.ts:584-639`; `src/data/seed-data.ts:901`]

### Anti-Patterns to Avoid

- **Generic CRUD API:** violates D-02; every endpoint must map to a console workflow and carry audit semantics.
- **Client-side authorization:** violates D-07; the SPA may preview but never enforce; the Worker is authoritative.
- **Hard-delete customers:** violates D-05/SAFE-01; archive retains all dependent records.
- **Stored balance counter in D1:** violates D-12; balances are always derived from append-only ledger rows.
- **Session cookies / server-side session store:** violates D-04; identity is per-request from the verified JWT.
- **Stripe/payment/invoice language or endpoints:** violates D-09.
- **Redesigning the console, new top-level routes, or a fifth profile tab:** violates D-08.
- **Duplicating ledger events into `ActivityEvent`:** the ledger is the immutable financial timeline; audit entries are a separate operator-action trail (Phase 2 D-13 preserved).
- **Conditional E2E skips, sleeps, or weakened assertions:** the API-backed suite must fail loudly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT signature verification | Custom crypto from scratch | Web Crypto `crypto.subtle.verify` against the Access JWKS | Standard Workers capability; no new dependency. [CITED: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/] |
| Durable storage | Custom file/JSON store | Cloudflare D1 | D-01; SQLite semantics, transactions, and migrations are built in. |
| Modal focus/escape semantics | Custom overlay | Existing Radix AlertDialog/Sheet wrappers | Already installed and used for confirmed actions. [VERIFIED: `package.json:8-33`; `src/features/customers/pages/CustomersPage.tsx:380-410`] |
| Table paging/semantics | New table framework | Existing `DataTable` | Existing app convention. [VERIFIED: `src/data/data-table.tsx`] |
| Payment/billing engine | Stripe, invoicing, tax | Operator-confirmed ledger actions only | D-09; money movement is explicitly excluded. |
| Async state management | New query cache library | Local `useEffect`/`useMemo` projections + existing skeletons | D-10/D-08; keep the SPA dependency tree unchanged. |

**Key insight:** the difficult part of Phase 3 is not the SQL or the JWT; it is preserving one canonical, auditable, authorized path across a durable database, an async UI, and a non-destructive lifecycle without letting the console drift into a generic CRUD product.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | Browser localStorage key `hivarium.operator-console.store.v1` holds the schema v3 demo store; `migrateStore` is the only upgrade seam. [VERIFIED: `src/data/local-storage-repository.ts:376,584-639`] | Keep the adapter for demo/tests; D1 becomes the production source of truth; add deterministic import path (D-11). |
| Live service config | `wrangler.jsonc` deploys only static assets from `./dist` with SPA fallback; no D1 binding, no API routes. [VERIFIED: `wrangler.jsonc:1-8`] | Add D1 binding, Worker API surface, and local dev/test wiring. |
| OS-registered state | No OS service owns the store; browser-only SPA. [VERIFIED: `.planning/codebase/ARCHITECTURE.md:5-7`] | None. |
| Secrets/env vars | `.env` exists locally but is not tracked; no D1 or Access secret is defined in tracked surfaces; secret content was not inspected. [VERIFIED: `.gitignore:14-16`; `.planning/codebase/STACK.md:54-58`] | Add Worker secrets (e.g., Access AUD, team domain) via `wrangler secret`/env bindings; never commit them. |
| Build artifacts / installed packages | `dist/` and `node_modules/` exist; `wrangler` is available. [VERIFIED: read-only `ls -ld` on 2026-09-11] | Run normal typecheck/test/build gates; do not edit generated output. |

## Common Pitfalls

### Pitfall 1: JWT verification gaps
**What goes wrong:** signature verified but issuer/audience/expiry skipped, or the JWKS is fetched on every request.  
**How to avoid:** check `iss`, `aud`, `exp`, and `nbf`; cache the JWKS with a short TTL; reject missing headers with `401` before any route logic. [CITED: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/]

### Pitfall 2: Client-side authorization illusion
**What goes wrong:** the SPA hides buttons and the team believes mutations are protected.  
**How to avoid:** the Worker enforces every mutation through shared pure rules; the SPA previews are cosmetic. Permission-failure tests must prove a request without a valid JWT cannot mutate. [VERIFIED: `src/domain/ledger-rules.ts:1-9`; D-07]

### Pitfall 3: Archive that still deletes
**What goes wrong:** the archive command cascades dependent rows like the old `deleteCustomer`.  
**How to avoid:** archive only flips the customer lifecycle status and appends activity/audit rows; dependent tables are never touched. [VERIFIED: `src/data/local-storage-repository.ts:575-596`; D-05]

### Pitfall 4: Audit written outside the mutation transaction
**What goes wrong:** a mutation commits but its audit entry is lost, or an audit entry exists without the mutation.  
**How to avoid:** build the mutation rows and the audit row together and commit in one D1 transaction (D-06).

### Pitfall 5: Async migration breaks every page at once
**What goes wrong:** converting `HiveRepository` to async in one giant change breaks the whole SPA.  
**How to avoid:** land the async contract with the adapter and page states plan-by-plan; keep `LocalStorageRepository` as the deterministic test adapter so component tests stay fast. [VERIFIED: `src/data/repository-context.tsx:5-27`; D-10]

### Pitfall 6: E2E determinism lost against a real database
**What goes wrong:** the Playwright suite depends on a dirty D1 state.  
**How to avoid:** a test-only reset path reseeds local D1 to the canonical seed in `beforeEach`, mirroring the current localStorage init script. [VERIFIED: `e2e/console.spec.ts:17-24`]

## Code Examples

### Existing repository mutation pattern (to become async)

```typescript
// Source: src/data/local-storage-repository.ts:697-703
const result = applyCommercialTransition(store, input, occurredAt);
this.write(result.store);
return result.arrangement;
```

Phase 3 commands return one complete next-state result from pure rules and commit it plus the audit entry in one D1 transaction. [VERIFIED: `src/data/local-storage-repository.ts:697-703`; D-06]

### Existing migration persistence guard (model for idempotent D1 import)

```typescript
// Source: src/data/local-storage-repository.ts:507-515
const parsed = JSON.parse(raw) as unknown;
const migrated = migrateStore(parsed);
if (JSON.stringify(migrated) !== raw) {
  this.storage.setItem(this.key, JSON.stringify(migrated));
}
return migrated;
```

The D1 import must remain deterministic so re-running is a no-op. [VERIFIED: `src/data/local-storage-repository.ts:507-515`; D-11]

### Existing accessible confirmation pattern (to become archive)

```tsx
// Source: src/features/customers/pages/CustomersPage.tsx:391-410
<AlertDialogContent data-testid="delete-customer-dialog">
  <AlertDialogHeader>
    <AlertDialogTitle>Delete {customer.name}?</AlertDialogTitle>
    <AlertDialogDescription>...</AlertDialogDescription>
  </AlertDialogHeader>
  ...
</AlertDialogContent>
```

The archive confirmation preserves this named-subject structure while stating that all records are retained. [VERIFIED: `src/features/customers/pages/CustomersPage.tsx:391-410`; D-05]

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Browser localStorage as the only store | Cloudflare D1 durable database owned by the Worker API | Records survive browser/device changes; SAFE-03 satisfied. [CITED: https://developers.cloudflare.com/d1/] |
| Perimeter-only Cloudflare Access | Per-request Access JWT verification in the Worker | Server-side authorization for every mutation; SAFE-04 satisfied. [CITED: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/] |
| Hard-delete customer | Non-destructive archive with full retention | Contracts, access history, ledger, and usage remain available; SAFE-01 satisfied. |
| No operator trace | Immutable server-written audit entries | Who/when/what for every commercial, access, credit, and lifecycle change; SAFE-05 satisfied. |
| Synchronous repository | Async `ApiRepository` over the Worker API | Honest loading/error states; durable I/O without pretending it is synchronous. |

**Deprecated in this phase:** `deleteCustomer` as a product action, localStorage as a production source of truth, and any claim that browser checks authorize financial mutations.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The Access application AUD and team domain are available as Worker environment bindings/secrets. | Pattern 1 | JWT audience/issuer checks cannot be configured; verification must be configurable per environment. |
| A2 | The browser automatically attaches `Cf-Access-Jwt-Assertion` to same-origin fetches when behind Cloudflare Access. | Pattern 6 | If not, the SPA must read the header via a small identity bootstrap; verify during 03-02. |
| A3 | Local D1 testing via `wrangler dev`/`wrangler d1 execute` is sufficient for integration and E2E determinism. | Pattern 7, Pitfall 6 | If local D1 is flaky, fall back to a test-only in-memory D1 binding; keep the reset path deterministic. |
| A4 | The shared pure rules remain free of Vite/React-specific imports so the Worker can bundle them. | Pattern 3 | Verified today (`./types` only); any future rule change must preserve this. |

## Open Questions

1. **Access JWT header availability in the SPA**
   - What we know: Cloudflare Access injects `Cf-Access-Jwt-Assertion` on requests through the Access proxy. [VERIFIED: `.planning/codebase/INTEGRATIONS.md:7-12`]
   - What is unclear: whether the browser can read the header on same-origin fetches in the deployed topology.
   - Recommendation: the SPA calls `GET /api/me`; if the header is not forwarded, configure the Worker to accept the Access cookie/JWT via the documented validation flow and adjust the adapter in 03-02.

2. **D1 local-testing ergonomics**
   - What we know: `wrangler dev` supports local D1 with `--local`; Playwright currently starts `vite preview`. [VERIFIED: `playwright.config.ts:21-25`]
   - What is unclear: the exact webServer command that serves both the built SPA and the Worker API with a local D1.
   - Recommendation: start with `wrangler dev` serving the API and static assets together; adjust the Playwright webServer in 03-02 and lock it in 03-03.

No unresolved question blocks Phase 3 planning.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | all commands | ✓ | `v20.20.2` | — |
| npm | scripts | ✓ | `10.8.2` | — |
| wrangler | D1 migrations, local dev, deploy | ✓ | installed in project | — |
| Playwright CLI | E2E gate | ✓ | `1.63.0` | — |
| Playwright Chromium | E2E/visual gate | ✓ | cached locally | — |
| Cloudflare D1 (local) | integration tests | ✓ via `wrangler dev --local` | — | in-memory D1 binding for tests |

Versions and paths were verified read-only on the remote host on 2026-09-11. No external service is required for local development; production D1 and Access configuration are infrastructure state.

## Verification Strategy (phase-specific)

`.planning/config.json` explicitly sets `"nyquist_validation": false`; therefore no generated Nyquist validation wave is required. [VERIFIED: `.planning/config.json:20-29`] The phase still needs the ordinary project gates plus Worker integration tests because Phase 3 changes persistence, authorization, and principal UI flows.

### Existing Test Framework

| Property | Value |
|----------|-------|
| Unit/component | Vitest `^4.1.11` with jsdom and Testing Library. [VERIFIED: `package.json:71-76,87,92`] |
| Browser E2E | Playwright `^1.63.0`. [VERIFIED: `package.json:71`] |
| Worker integration | Vitest or `wrangler`-driven tests against a local D1 binding. |
| Quick rule/repository run | `npm test -- src/domain/ledger-rules.test.ts src/data/local-storage-repository.test.ts` |
| Full unit/component suite | `npm test` [VERIFIED: `package.json:94-102`] |
| Full browser suite | `npm run test:e2e` [VERIFIED: `package.json:94-102`] |

### Requirement-to-Test Map

| Requirements | Behavior | Test layer | Required coverage |
|--------------|----------|------------|-------------------|
| SAFE-01 | archive retains all dependent records | Worker integration + component + E2E | archive flips status only; contracts/grants/ledger/usage remain readable; archived list filter; read-only profile |
| SAFE-03 | durable server-owned storage | Worker integration | D1 persists across repository instances; localStorage adapter no longer the production path |
| SAFE-04 | server-side authorization | Worker integration + E2E | missing/invalid/expired/wrong-audience JWT → `401`; no mutation without verified identity |
| SAFE-05 | immutable audit entries | Worker integration + component | every covered mutation writes one audit row in the same transaction; rows never editable/deletable; audit trail renders |
| SAFE-06 | automated verification | all layers | commercial validation, ledger arithmetic, idempotent usage, permission failures, principal operator flows |

### Required New/Extended Test Files

- Add `worker/test/access-jwt.test.ts` for JWT verification (signature, issuer, audience, expiry, missing header).
- Add `worker/test/api.integration.test.ts` for D1-backed route behavior, audit transactions, archive retention, and permission failures.
- Add `src/data/api-repository.test.ts` for the async adapter (mocked fetch, error mapping, identity header).
- Extend `src/data/local-storage-repository.test.ts` for the async signature, archive command, and v3→v4 migration.
- Extend `src/features/customers/pages/CustomersPage.test.tsx` and `CustomerProfilePage.test.tsx` for archive, audit trail, identity, and async states.
- Extend `e2e/console.spec.ts` with API-backed strict no-skip journeys and a D1 reset path.

### Sampling and Gates

- Per domain/worker task: focused Vitest files.
- Per vertical plan: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `git diff --check`, plus Worker integration tests.
- After a user-visible flow: add `npm run test:e2e` against the API-backed SPA.
- Final phase gate: all commands above plus desktop/mobile visual inspection of the list, profile, archive, audit, and identity states; no console errors and no horizontal overflow.

## Security Domain

Security enforcement is enabled at ASVS Level 1. [VERIFIED: `.planning/config.json:47-49`]

### Applicable ASVS Categories

| ASVS Category | Applies | Phase Control |
|---------------|---------|---------------|
| V2 Authentication | Yes | Cloudflare Access JWT verification per request; no new login surface; missing/invalid tokens rejected with `401` (D-03). [CITED: https://owasp.org/www-project-application-security-verification-standard/] |
| V3 Session Management | Yes, stateless | Operator identity derived per request from verified JWT claims; no cookies, no server-side session store (D-04). |
| V4 Access Control | Yes | Every mutation route requires a verified operator identity; archive replaces delete; no client-side authorization claims (D-05, D-07). |
| V5 Input Validation | Yes | Typed DTO validation server-side plus shared pure rules; whole-token ranges, required references/reasons, valid IDs/timestamps (D-07). |
| V6 Cryptography | Yes | RS256 JWT verification via Web Crypto against the Access JWKS; no secrets in client code. |
| V8 Client-side data protection | Yes | localStorage demoted to demo/test; real records live in D1; no sensitive data in browser storage. |
| V9 Communication security | Yes | All API traffic over HTTPS behind Cloudflare; baseline security headers retained. |

### Known Threat Patterns

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Forged or replayed JWT | Spoofing | Verify signature against Access JWKS, check `iss`/`aud`/`exp`/`nbf`, reject missing headers (D-03). |
| Unauthenticated mutation | Tampering | Every mutation route requires verified identity; permission-failure tests prove `401` (SAFE-04). |
| Tampered client bypasses validation | Tampering | Worker enforces shared pure rules authoritatively; SPA previews are cosmetic (D-07). |
| Audit loss or fabrication | Repudiation | Audit rows commit in the same D1 transaction as mutations and are immutable (D-06, SAFE-05). |
| Data loss via destructive lifecycle | Tampering | Archive replaces delete; dependent records are never removed (D-05, SAFE-01). |
| Balance counter tampering | Tampering | Balances always derived from append-only ledger rows in D1 (D-12). |
| Secret leakage | Information disclosure | Access AUD/team domain via Worker secrets/env bindings; never committed (`.gitignore:14-16`). |

## Proposed Thin Tracer-First Decomposition

### Plan 03-01 — Durable Authorized API Foundation

- Add D1 schema/migrations and the Worker API skeleton with per-request Cloudflare Access JWT verification and operator identity.
- Port/enforce the shared pure rules server-side; add the purpose-built route surface (customers, commercial, access, ledger, usage, audit, agents, me, health).
- Add the immutable audit writer committed in the same D1 transaction as every mutation.
- Add the `archived` lifecycle status and schema v4 to the shared domain types.
- Prove the authenticated tracer with Worker integration tests: one authenticated round-trip persists in D1 and writes an audit entry; unauthenticated requests are rejected.
- Covers SAFE-03, SAFE-04, SAFE-05 foundation, and the server half of SAFE-06.

### Plan 03-02 — Server-Backed Console, Archive and Audit UI

- Convert `HiveRepository` to async; add `ApiRepository`; keep `LocalStorageRepository` as the demo/test adapter.
- Add loading/error states to pages in the existing visual language; display operator identity.
- Replace delete with the archive workflow (confirmation, archived filter, archived banner, read-only profile).
- Add the read-only `Operator audit trail` section inside the existing Activity tab.
- Lock API-backed E2E journeys with a deterministic D1 reset path.
- Covers SAFE-01, SAFE-05 UI, and the client half of SAFE-06.

### Plan 03-03 — Production Hardening, Migration and Verification

- Add the deterministic D1 seed and the idempotent localStorage import path.
- Harden the Worker: typed input validation, consistent error envelope, rate limiting, CORS, security headers.
- Complete the API-backed E2E suite (permission failures, archive/audit journeys, principal operator flows) and the full regression gate.
- Perform desktop/mobile visual verification and close the phase with `VERIFICATION.md`.
- Covers SAFE-06 completion and the phase verification gate.

The decomposition intentionally keeps each plan visible and executable, as required by the project delivery constraint. [VERIFIED: `AGENTS.md:19`; `03-CONTEXT.md` agent's Discretion]

## Sources

### Primary (HIGH confidence)
- `.planning/phases/03-production-safe-customer-operations/03-CONTEXT.md` — locked Phase 3 decisions and scope.
- `.planning/REQUIREMENTS.md` — canonical requirement text (SAFE-01, SAFE-03 through SAFE-06).
- `.planning/ROADMAP.md` — Phase 3 goal and success criteria.
- `src/domain/types.ts` — current schema and lifecycle unions.
- `src/domain/commercial-rules.ts` and `src/domain/ledger-rules.ts` — pure rules with relative-only imports.
- `src/data/local-storage-repository.ts` — repository contract, migration seam, storage key, and one-write patterns.
- `src/data/repository-context.tsx` — injection seam.
- `src/data/seed-data.ts` — deterministic seed source.
- `src/features/customers/pages/CustomersPage.tsx` and `CustomerProfilePage.tsx` — current UI composition and delete/confirmation pattern.
- `wrangler.jsonc`, `package.json`, `playwright.config.ts`, `vitest.config.ts` — deployment and test wiring.
- `.planning/codebase/INTEGRATIONS.md` and `.planning/codebase/CONCERNS.md` — perimeter and persistence concerns.

### Secondary (MEDIUM confidence)
- https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/ — Access JWT validation flow.
- https://developers.cloudflare.com/d1/ — D1 database, migrations, and local development.
- https://developers.cloudflare.com/workers/ — Worker runtime, bindings, and Web Crypto.
- https://owasp.org/www-project-application-security-verification-standard/ — ASVS scope and current stable standard.

### Tertiary (LOW confidence)
- None used for implementation decisions.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — read directly from current `package.json`, `wrangler.jsonc`, and repository source.
- Architecture: HIGH — based on current code seams and locked CONTEXT decisions.
- Cloudflare Access JWT: MEDIUM — standard documented flow, but the exact deployed topology (header forwarding, AUD configuration) must be verified during 03-01/03-02.
- D1 local testing: MEDIUM — `wrangler dev --local` is the documented path; exact Playwright webServer wiring is locked in 03-02/03-03.
- Pitfalls: HIGH — derived from explicit invariants and current code paths.

**Research date:** 2026-09-11  
**Valid until:** 2026-10-11, or until the store schema/repository contract changes.