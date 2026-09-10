# Phase 2: Prepaid Credit and Usage Accounting - Context

**Gathered:** 2026-09-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 gives the Hivarium operator a dependable prepaid-credit workflow: add token credit, record agent-attributed usage, derive the balance from immutable ledger transactions, reverse or adjust entries with an explanation, investigate usage through a focused statement, and identify low-balance customers. It remains a deterministic local prototype. Durable server persistence, multi-operator authorization, automatic runtime ingestion, payment collection, invoicing, and notifications remain outside this phase.

</domain>

<decisions>
## Implementation Decisions

### Credit unit and balance
- **D-01:** Prepaid credit and every ledger amount are denominated in whole Hivarium tokens, not money. Token quantity is the canonical accounting unit throughout the Phase 2 domain model, calculations, forms, summaries, and tests. — **Reversibility:** costly — changing units later would require migrating every persisted ledger entry, usage record, threshold, fixture, calculation, and UI label.
- **D-02:** Current balance is always derived by summing immutable signed ledger transactions. No editable or separately persisted balance counter may exist.
- **D-03:** A usage debit that would make the derived balance negative is rejected before any ledger or usage record is written. The UI must explain the available balance, attempted debit, and affected customer.

### Ledger corrections and safety
- **D-04:** Supported immutable transaction kinds are `credit_grant`, `usage_debit`, `manual_adjustment`, and `reversal`. Existing transactions are never edited or deleted.
- **D-05:** A reversal appends a new transaction that references the original transaction, negates its full token amount exactly once, and requires an operator-entered reason. A reversal of a reversal and a second reversal of the same original transaction are rejected.
- **D-06:** A manual adjustment may add or subtract tokens, requires a non-zero whole-token amount and a reason, and must also obey the no-negative-balance rule.
- **D-07:** Credit grants, manual adjustments, and reversals require a confirmation dialog naming the customer and stating the resulting balance before the mutation is committed. Usage debits also require confirmation because Phase 2 uses operator-entered deterministic demo events.

### Usage identity and idempotency
- **D-08:** Each usage debit records exactly one customer, one catalog agent product, occurred-at timestamp, positive whole-token quantity, and required unique `sourceReference`.
- **D-09:** Re-submitting the same `sourceReference` with identical normalized customer, agent, token quantity, and occurred-at values is idempotent: it returns the existing transaction and does not debit again. Reusing that reference with different values is rejected as a conflict.
- **D-10:** Phase 2 supports manual deterministic usage entry only. Automatic ingestion from Hivarium runtime events is deferred until a trusted server-owned integration exists.

### Low-balance and investigation experience
- **D-11:** Each prepaid commercial arrangement has a configurable non-negative whole-token warning threshold, defaulting to `100` tokens for new arrangements and migrated demo records.
- **D-12:** A prepaid customer is low-balance when derived balance is less than or equal to its configured threshold. Show a restrained warning badge in the customer list and profile; do not add a generic analytics dashboard or noisy global alert system.
- **D-13:** The customer profile remains the primary surface. Extend the existing `Commercial` experience with balance and safe credit actions, and use the existing `Activity` area for a chronological ledger/usage statement with filters for date range, agent product, and transaction type.
- **D-14:** The selected statement period shows tokens consumed and a compact per-agent token breakdown. Use text and table rows rather than decorative charts.

### Prototype persistence and migration
- **D-15:** Extend the existing versioned localStorage repository and deterministic seed fixtures. Migrate Phase 1 prepaid arrangements into a seeded opening credit transaction so the displayed balance remains explainable and no customer record is dropped.
- **D-16:** All ledger arithmetic, idempotency checks, validation, and lifecycle invariants live in domain/repository code, not inside React components.

### the agent's Discretion
- Exact component and helper names, drawer widths, responsive table/card fallback, timestamp display format, filter-control layout, and fixture values may follow existing project conventions.
- The planner may split Phase 2 into up to three sequential vertical plans as long as each completed plan leaves the console working and testable.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product scope and requirements
- `.planning/PROJECT.md` — Core value, constraints, exclusions, and the local-prototype boundary.
- `.planning/ROADMAP.md` — Phase 2 goal, success criteria, dependencies, and MVP delivery mode.
- `.planning/REQUIREMENTS.md` — Canonical Phase 2 requirement definitions: `LEDG-01` through `LEDG-05`, `USGE-01` through `USGE-05`, and `SAFE-02`.
- `.planning/STATE.md` — Phase 1 completion state and the handoff into Phase 2.

### Prior-phase decisions and implementation evidence
- `.planning/phases/01-customer-commercial-control/CONTEXT.md` — Locked commercial-model, access-history, profile-tab, persistence, and UX decisions that Phase 2 must preserve.
- `.planning/phases/01-customer-commercial-control/01-01-SUMMARY.md` — DataStore v2 migration and initial commercial/access implementation.
- `.planning/phases/01-customer-commercial-control/01-02-SUMMARY.md` — Commercial lifecycle invariants and repository behavior.
- `.planning/phases/01-customer-commercial-control/01-03-SUMMARY.md` — Final profile/catalog UI, regression, E2E, and visual-verification evidence.
- `.planning/phases/01-customer-commercial-control/VERIFICATION.md` — Canonical Phase 1 verification baseline that must remain green.

### Codebase maps
- `.planning/codebase/STACK.md` — Runtime, UI, persistence, and test stack.
- `.planning/codebase/ARCHITECTURE.md` — Repository boundary, feature structure, and primary data flow.
- `.planning/codebase/CONVENTIONS.md` — TypeScript, React, styling, accessibility, data, and test conventions.
- `.planning/codebase/INTEGRATIONS.md` — Current local-only integrations and future server boundaries.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/domain/types.ts`: extend the serializable `DataStore` and commercial records rather than creating page-local accounting types.
- `src/domain/commercial-rules.ts`: reuse prepaid-arrangement lookup and commercial lifecycle validation; do not duplicate active-arrangement rules.
- `src/data/local-storage-repository.ts`: preserve `HiveRepository` as the only feature-layer read/write boundary and extend its existing version migration.
- `src/data/seed-data.ts`: provide deterministic prepaid ledger and usage fixtures with stable IDs, dates, and source references.
- `src/features/customers/pages/CustomerProfilePage.tsx`: extend the established four-tab customer context rather than adding a separate billing dashboard.
- `src/components/ui/` and existing Radix confirmation patterns: reuse accessible dialogs, sheets, fields, badges, tables, and toasts.

### Established Patterns
- Domain records are JSON-compatible, strongly typed, and referenced by deterministic stable IDs.
- Repository mutations validate invariants and persist the complete local store; UI refreshes its projection and emits a concise toast.
- High-impact actions name the affected customer in an accessible confirmation dialog.
- Tests are colocated for domain/repository/component behavior, with principal operator flows covered by `e2e/console.spec.ts`.
- Visual language is warm, minimal, compact, and operational; avoid KPI-card grids and decorative analytics.

### Integration Points
- Prepaid arrangement data supplies the warning threshold and determines whether ledger actions are available.
- Ledger transactions and usage details connect through one immutable transaction ID; a usage debit must commit both atomically in one repository write.
- Catalog agent product IDs provide usage attribution and filter labels.
- Commercial and access activity must continue to coexist with new ledger events in the customer's Activity experience.

</code_context>

<specifics>
## Specific Ideas

- The operator should be able to recharge a customer's token account, immediately see the derived balance, and inspect exactly which agent consumed tokens.
- The first implementation should prove the accounting behavior visibly and reliably; it should not introduce payment processing, a backend, or generalized reporting infrastructure.

</specifics>

<deferred>
## Deferred Ideas

- Automatic usage ingestion from trusted Hivarium runtime events (`AUTO-01`) is deferred until server-owned persistence and authorization exist.
- Email or in-app low-balance notifications (`AUTO-02`) are deferred; Phase 2 provides visible status only.
- Statement export, invoicing, card processing, taxes, and general-ledger accounting remain out of scope.
- Durable database storage, server authorization, and tamper-resistant audit retention remain Phase 3 work.

</deferred>

---

*Phase: 2-Prepaid Credit and Usage Accounting*
*Context gathered: 2026-09-10*
