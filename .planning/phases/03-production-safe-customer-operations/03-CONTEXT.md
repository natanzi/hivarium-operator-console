# Phase 3: Production-Safe Customer Operations - Context

**Gathered:** 2026-09-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 moves the completed customer, commercial, agent-access, ledger, and usage workflows from the deterministic browser prototype into durable, authorized, retained, and auditable server-owned storage. It introduces a Cloudflare D1-backed authoritative API behind Cloudflare Access JWT verification, replaces destructive customer deletion with non-destructive archival, records an immutable operator audit trail for every commercial-model change, agent-access change, credit operation, and customer archival, and keeps the existing warm minimal operator console UI intact.

Phase 3 does **not** build a generic CRUD API, does **not** integrate Stripe or any payment/billing provider, does **not** add a public login surface, does **not** redesign the console, and does **not** add runtime governance, notifications, invoicing, tax, or automatic runtime usage ingestion. The existing four-tab customer profile, agent catalog, confirmation patterns, copy conventions, and responsive behavior are preserved; only the data layer, the lifecycle action (archive instead of delete), audit visibility, and operator identity display change.

</domain>

<decisions>
## Implementation Decisions

### Durable storage and API shape
- **D-01:** Real customer, contract, entitlement, ledger, usage, and audit records persist in a Cloudflare D1 (SQLite) database owned by the Worker API. D1 is the single durable source of truth; browser localStorage is demoted to the deterministic demo/test adapter and is never the source of truth for production records (SAFE-03).
- **D-02:** The API is a small, purpose-built Cloudflare Worker API exposing exactly the operations the console needs: customer list/get/create/update/archive, commercial snapshot/save/terminate, agent-access snapshot/grant/revoke, ledger statement/credit/usage/adjustment/reversal/threshold, usage summary, agent catalog reads, audit reads, and operator identity. No generic resource CRUD framework, no Refine data provider against the API, no auto-generated endpoints, and no endpoint that does not map to a console workflow.
- **D-03:** Authentication is Cloudflare Access JWT verification. Every API request must carry a valid `Cf-Access-Jwt-Assertion` header; the Worker verifies the JWT signature against the Access team's public JWKS, checks issuer, audience (the Access application AUD), and expiry, and rejects missing/invalid tokens with `401`. Cloudflare Access remains the perimeter; no new public login surface is introduced (SAFE-04).
- **D-04:** Operator identity and session come from the verified JWT claims (`email`, `sub`, `name`). The API is stateless per request — no session cookies, no server-side session store, no refresh-token machinery. `GET /api/me` returns the current operator identity so the SPA can display `Signed in as {email}` and fail closed when unauthenticated.

### Retention and audit
- **D-05:** Archive replaces delete. Customer deletion is removed from the product. `archiveCustomer` transitions a customer to the `archived` lifecycle state while retaining every contract, agent-access grant, ledger transaction, usage record, and activity event. Archived customers are excluded from the default list, appear under an `Archived` lifecycle filter, and their profile is read-only with an archived banner (SAFE-01).
- **D-06:** Audit entries are server-written and immutable. Every commercial-model change, agent-access change, credit operation (credit grant, usage debit, manual adjustment, reversal, threshold change), and customer archival appends an audit entry recording the verified operator identity, action, timestamp, subject, and a before/after summary. The audit entry is written in the same D1 transaction as the mutation and is never editable or deletable (SAFE-05).
- **D-07:** The server is the authoritative enforcement point. All commercial-model validation, ledger arithmetic, source-reference idempotency, no-negative-balance guards, and lifecycle invariants are enforced by the Worker using the same pure rules the SPA already uses (`src/domain/commercial-rules.ts`, `src/domain/ledger-rules.ts`, imported by the Worker via relative paths). The SPA may preview results (e.g., resulting balance) but the server is authoritative; a client can never bypass validation (SAFE-04, SAFE-06).

### UI and data-layer contract
- **D-08:** The UI is preserved. The existing React SPA, four profile tabs, warm minimal visual language, Radix confirmation patterns, copy conventions, and responsive behavior remain. Phase 3 changes the data layer (async repository adapter), replaces delete with archive, adds audit visibility inside the existing Activity tab, and adds operator identity display — it does not redesign the console or add new top-level routes.
- **D-09:** No payment processing. Stripe, card processing, invoicing, tax, and money movement remain out of scope. Token credit remains an operator-confirmed ledger action, not a payment.
- **D-10:** The repository boundary becomes asynchronous. `HiveRepository` methods become `Promise`-returning; an `ApiRepository` adapter calls the Worker API; `LocalStorageRepository` remains as the deterministic demo/test adapter. Pages render loading skeletons and error states while preserving the existing visual language.
- **D-11:** Data migration is deterministic and idempotent. A one-time, operator-triggered, authenticated import path moves the deterministic localStorage demo store into D1 with stable IDs and timestamps; re-running the import never duplicates records. Fresh deployments seed D1 directly from the canonical deterministic seed. Migrating arbitrary real-world browser payloads is out of scope — the console starts from the canonical seed in D1.
- **D-12:** The ledger remains immutable and derived. D1 stores ledger transactions and usage records as append-only rows; balances and statements are always derived server-side from those rows. No stored balance counter exists anywhere (SAFE-06).

### the agent's Discretion
- Exact Worker file layout, route naming, D1 table/column names, JWT cache TTL, skeleton shapes, and fixture values may follow existing project conventions and Cloudflare best practice.
- The planner may split Phase 3 into up to three sequential vertical plans as long as each completed plan leaves the console working and testable.
- The planner may add a small number of Worker-side packages (e.g., `wrangler` D1 tooling) only if required for the D1/JWT integration; the SPA dependency tree must not grow.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product scope and requirements
- `.planning/PROJECT.md` — Core value, constraints, exclusions, and the local-prototype boundary.
- `.planning/ROADMAP.md` — Phase 3 goal, success criteria, dependencies, and MVP delivery mode.
- `.planning/REQUIREMENTS.md` — Canonical Phase 3 requirement definitions: `SAFE-01`, `SAFE-03`, `SAFE-04`, `SAFE-05`, `SAFE-06`.
- `.planning/STATE.md` — Phase 2 completion state and the handoff into Phase 3.

### Prior-phase decisions and implementation evidence
- `.planning/phases/01-customer-commercial-control/CONTEXT.md` — Locked commercial-model, access-history, profile-tab, persistence, and UX decisions that Phase 3 must preserve.
- `.planning/phases/01-customer-commercial-control/01-01-SUMMARY.md` — DataStore v2 migration and initial commercial/access implementation.
- `.planning/phases/01-customer-commercial-control/01-02-SUMMARY.md` — Commercial lifecycle invariants and repository behavior.
- `.planning/phases/01-customer-commercial-control/01-03-SUMMARY.md` — Final profile/catalog UI, regression, E2E, and visual-verification evidence.
- `.planning/phases/01-customer-commercial-control/VERIFICATION.md` — Canonical Phase 1 verification baseline that must remain green.
- `.planning/phases/02-prepaid-credit-and-usage-accounting/02-CONTEXT.md` — Locked ledger, idempotency, reversal, statement, and low-balance decisions that Phase 3 must preserve.
- `.planning/phases/02-prepaid-credit-and-usage-accounting/02-01-SUMMARY.md` — Schema v3 ledger foundation and credit tracer.
- `.planning/phases/02-prepaid-credit-and-usage-accounting/02-02-SUMMARY.md` — Atomic usage, idempotency, adjustment, and reversal implementation.
- `.planning/phases/02-prepaid-credit-and-usage-accounting/02-03-SUMMARY.md` — Statement, filters, low-balance visibility, and phase verification.
- `.planning/phases/02-prepaid-credit-and-usage-accounting/VERIFICATION.md` — Canonical Phase 2 verification baseline that must remain green.

### Codebase maps
- `.planning/codebase/STACK.md` — Runtime, UI, persistence, and test stack.
- `.planning/codebase/ARCHITECTURE.md` — Repository boundary, feature structure, and primary data flow.
- `.planning/codebase/CONVENTIONS.md` — TypeScript, React, styling, accessibility, data, and test conventions.
- `.planning/codebase/INTEGRATIONS.md` — Current local-only integrations and the Cloudflare Access perimeter.
- `.planning/codebase/CONCERNS.md` — Browser-only persistence, perimeter-only authorization, and destructive lifecycle concerns that Phase 3 resolves.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/domain/types.ts`: extend the serializable `Customer` lifecycle with the `archived` status and bump `STORE_SCHEMA_VERSION` to 4; keep the schema v3 ledger/usage contracts intact.
- `src/domain/commercial-rules.ts` and `src/domain/ledger-rules.ts`: pure, side-effect-free modules with relative imports only (`./types`) — directly importable by the Worker as the authoritative server-side rules (D-07).
- `src/data/local-storage-repository.ts`: `HiveRepository` is the feature-layer read/write boundary; `STORAGE_KEY` (`hivarium.operator-console.store.v1`), `MIGRATION_TIMESTAMP`, `migrateStore`, and `createInMemoryRepository` are the migration/test seams to preserve.
- `src/data/repository-context.tsx`: `RepositoryProvider`/`useRepository()` injection seam that must become async-aware.
- `src/data/seed-data.ts`: deterministic six-customer baseline with `SEED_NOW`, `AGENT_PRODUCTS`, and the prepaid `cust_meridians` token account — the canonical D1 seed source.
- `src/features/customers/pages/CustomersPage.tsx`: `DeleteCustomerAction` (lines 362-413) is the exact surface that becomes `ArchiveCustomerAction`; the summary strip already labels churned as `Archived` and must be corrected to count the new archived state.
- `src/features/customers/pages/CustomerProfilePage.tsx`: four-tab composition and revision-counter refresh pattern to extend with async loading/error states, the archived banner, and the audit trail.
- `src/features/customers/components/ActivityTimeline.tsx` and `TokenStatement.tsx`: the Activity tab composition point for the new `Operator audit trail` section.
- `src/components/ui/` and existing Radix confirmation patterns: reuse accessible dialogs, sheets, fields, badges, tables, and toasts.

### Established Patterns
- Domain records are JSON-compatible, strongly typed, and referenced by deterministic stable IDs.
- Repository mutations validate invariants and persist the complete local store; UI refreshes its projection and emits a concise toast.
- High-impact actions name the affected customer in an accessible confirmation dialog.
- Tests are colocated for domain/repository/component behavior, with principal operator flows covered by `e2e/console.spec.ts`.
- Visual language is warm, minimal, compact, and operational; avoid KPI-card grids and decorative analytics.

### Integration Points
- `wrangler.jsonc` currently deploys only static assets from `./dist` with SPA fallback; Phase 3 adds the D1 binding and the Worker API surface.
- Cloudflare Access already protects the site and `Sidebar.tsx` links to `/cdn-cgi/access/logout`; the Worker verifies the `Cf-Access-Jwt-Assertion` header per request.
- The pure commercial/ledger rules are the shared enforcement contract between the SPA previews and the authoritative Worker.
- The Activity tab is the aggregation surface for commercial/access history, the token statement, and the new operator audit trail.
- The E2E suite currently resets localStorage in `beforeEach`; Phase 3 must reset the local D1 database instead so API-backed journeys stay deterministic.

</code_context>

<specifics>
## Specific Ideas

- The operator should be able to archive a customer and immediately see the customer leave the working list while every contract, access grant, ledger entry, and usage record remains readable from the archived profile.
- The operator should be able to trace who changed a commercial model, agent access, credit balance, or customer lifecycle and when, from the customer's Activity tab.
- The console should display the verified operator identity and fail closed with a clear sign-in-required state when the API rejects a request.
- The first implementation should prove the durable authorized path visibly and reliably: one authenticated API round-trip that persists a record in D1 and writes an audit entry.

</specifics>

<deferred>
## Deferred Ideas

- Automatic usage ingestion from trusted Hivarium runtime events (`AUTO-01`) remains deferred; Phase 3 keeps manual deterministic usage entry.
- Email or in-app low-balance and renewal notifications (`AUTO-02`) remain deferred.
- Statement export, invoicing, card processing, taxes, and general-ledger accounting remain out of scope (`AUTO-03`, out-of-scope table).
- Catalog product creation/edition/versioning (`AUTO-04`) remains out of scope; the agent catalog stays read-only.
- Role-based permissions and two-operator approval (`TEAM-01`, `TEAM-02`) remain out of scope; Phase 3 authorizes any verified Access operator.
- Cross-customer search/reporting (`TEAM-03`) remains out of scope.
- Runtime governance controls, public customer portal, CRM, and ERP features remain out of scope.

</deferred>

---

*Phase: 3-Production-Safe Customer Operations*
*Context gathered: 2026-09-11*