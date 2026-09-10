# Phase 2: Prepaid Credit and Usage Accounting - Pattern Map

**Mapped:** 2026-09-10
**Files analyzed:** 17 likely new/modified files
**Analogs found:** 17 / 17
**Locked decisions applied:** D-01 through D-16 (`02-CONTEXT.md`)
**Plan decomposition applied:** 02-01 (ledger foundation + credit tracer), 02-02 (usage/idempotency + adjustment/reversal), 02-03 (statement + low-balance visibility)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/domain/types.ts` | model | transform / CRUD contract | same file, existing `CommercialArrangement` union, `ActivityEvent`, `DataStore`, `STORE_SCHEMA_VERSION` | exact |
| `src/domain/ledger-rules.ts` | service/utility | deterministic transform | `src/domain/commercial-rules.ts` (`validateCommercialArrangement`, `projectCommercialState`, `applyCommercialTransition`) | role-match |
| `src/data/local-storage-repository.ts` | store/repository | synchronous CRUD + migration | same file, `migrateStore`, `read`/`write`, `saveCommercialArrangement`, `terminateCommercialArrangement`, `deleteCustomer` cascade | exact |
| `src/data/seed-data.ts` | fixture/config | batch construction | same file, `seedCustomer`, `buildSeedStore`, `SEED_NOW`, `AGENT_PRODUCTS` | exact |
| `src/features/customers/components/AddCreditSheet.tsx` | component/form | request-response mutation | `CommercialArrangementSheet.tsx` + `TerminateArrangementDialog` + `components/ui/sheet.tsx` | role-match |
| `src/features/customers/components/RecordUsageSheet.tsx` | component/form | request-response mutation | `AgentAccessSheet.tsx` (agent select) + `CommercialArrangementSheet.tsx` (sheet/discard) | role-match |
| `src/features/customers/components/AdjustmentSheet.tsx` | component/form | request-response mutation | `CommercialArrangementSheet.tsx` (direction radio + reason) | role-match |
| `src/features/customers/components/ReversalSheet.tsx` | component/form | request-response mutation | `TerminateArrangementDialog` (compact dialog + reason) + `ArrangementRecordDialog` (immutable record view) | role-match |
| `src/features/customers/components/TokenStatement.tsx` | component | projection/collection | `ActivityTimeline.tsx` + `DataTable` history in `CustomerProfilePage.tsx:402-413` + `CustomersPage.tsx` filter row | partial |
| `src/features/customers/components/format.ts` | service/utility | presentation transform | same file, `formatUsd`, `modelLabel`, `modelPrimaryValue`, `TOUCH_TARGET` | exact |
| `src/features/customers/pages/CustomerProfilePage.tsx` | route/component | aggregate read + CRUD actions | same file | exact |
| `src/features/customers/pages/CustomersPage.tsx` | route/component | collection read/navigation | same file | exact |
| `src/domain/ledger-rules.test.ts` | test | pure transform | `src/domain/commercial-rules.test.ts` | role-match |
| `src/data/local-storage-repository.test.ts` | test | CRUD/migration contract | same file + `createInMemoryRepository` | exact |
| `src/features/customers/pages/CustomerProfilePage.test.tsx` | component test | aggregate read + interactions | same file, `renderProfilePath` helper | exact |
| `src/features/customers/pages/CustomersPage.test.tsx` | component test | collection read + badge | same file, deletion test | exact |
| `e2e/console.spec.ts` | browser test | end-to-end request-response | same file | exact |

The file names for new feature components are planner-level recommendations, not a requirement to create parallel abstractions. Keep them under `src/features/customers/components/` and do not introduce a second repository, a page-only domain model, or a new top-level route.

## Pattern Assignments

### `src/domain/types.ts` (Plan 02-01)

**Analog:** `src/domain/types.ts`

**Discriminated union pattern** (`src/domain/types.ts:64-170`):

```ts
export interface CommercialArrangementBase {
  id: string;
  customerId: string;
  status: CommercialArrangementStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  reason: string;
  replacedByArrangementId: string | null;
}
```

Copy this shape for the signed ledger transaction union. The locked kinds are exactly `"credit_grant" | "usage_debit" | "manual_adjustment" | "reversal"` (D-04). Each member carries `id`, `customerId`, `occurredAt`, `amountTokens` (signed whole tokens), `reason`, and `reference`; `usage_debit` links `usageRecordId` and `agentProductId`, and `reversal` links `reversesTransactionId` (D-05, D-08). Add a separate `UsageRecord` for the operational fact (`customerId`, `agentProductId`, `occurredAt`, positive `tokenQuantity`, unique `sourceReference`, `ledgerTransactionId`) per Pattern 2 in `02-RESEARCH.md`.

**Immutable append-only record pattern** (`src/domain/types.ts:206-232`): model `LedgerTransaction` and `UsageRecord` like `ActivityEvent` — plain serializable fields, deterministic string IDs, ISO timestamps, no behavior.

**Versioned store pattern** (`src/domain/types.ts:247-255`, `334`):

```ts
export interface DataStore {
  schemaVersion: 2;
  customers: Customer[];
  featureEntitlements: FeatureEntitlement[];
  agentProducts: AgentProduct[];
  commercialArrangements: CommercialArrangement[];
  agentAccessGrants: AgentAccessGrant[];
  activityEvents: ActivityEvent[];
}
```

Bump `STORE_SCHEMA_VERSION` to `3` and add `ledgerTransactions: LedgerTransaction[]` and `usageRecords: UsageRecord[]` to `DataStore`. Replace `PrepaidCommercialArrangement.currency` and `balanceCents` (`types.ts:98-115`) with `warningThresholdTokens: number` (D-11, D-15); keep `expiresAt` and `notes`. Keep `DataStoreV1` as the legacy-shape precedent for any migration-input typing.

**Conventions to preserve:** plain JSON-compatible values; deterministic stable IDs; string unions over loose strings; JSDoc on public types; `import type` where practical; no behavior in types.

### `src/domain/ledger-rules.ts` (Plans 02-01, 02-02, 02-03)

**Analog:** `src/domain/commercial-rules.ts`

**Pure validation module pattern** (`src/domain/commercial-rules.ts:337`, `571`): export pure functions that take explicit inputs and return either a validation result or a next-store result. Phase 2 needs:

- `deriveTokenBalance(transactions, customerId)` — sum of signed `amountTokens`; zero for an empty ledger (D-02, LEDG-03).
- `validateLedgerTransaction(...)` — per-kind amount invariants: `credit_grant` positive, `usage_debit` exactly `-usage.tokenQuantity`, `manual_adjustment` non-zero signed, `reversal` exactly `-target.amountTokens` (D-04, D-05, D-06).
- `assertNoNegativeBalance(...)` — reject any candidate whose resulting balance would be negative (D-03, D-06).
- `validateReversalTarget(...)` — reject reversal-of-reversal and any target already referenced by a reversal (D-05).
- `normalizeUsageFingerprint(...)` — trim `customerId`, `agentProductId`, `sourceReference`; canonical ISO `occurredAt`; positive integer `tokenQuantity` (D-09, Pattern 3 in `02-RESEARCH.md`).
- `projectAccountStatement(transactions, customerId)` — ascending `occurredAt` order with array-index tie-breaker, attach `resultingBalanceTokens` per row, return newest-first display order (LEDG-05, Pattern 4 in `02-RESEARCH.md`).
- `sumPeriodUsage(...)` / `groupUsageByAgent(...)` — net usage-debit aggregation per selected period and per agent product (USGE-04).
- `isLowBalance(balance, threshold)` — `balance <= threshold` (D-12, USGE-05).

**Projection pattern** (`src/domain/commercial-rules.ts:809`): follow `projectCommercialState` — pure as-of projection returning a snapshot object the repository wraps and the UI renders.

**Transition pattern** (`src/domain/commercial-rules.ts:860`, `977`): follow `applyCommercialTransition`/`applyAccessRevocation` — return `{ store, ...result }` so the repository performs exactly one `write()` (D-16, one-write convention at `local-storage-repository.ts:687-703`).

**Deterministic ID helpers** (`src/domain/commercial-rules.ts:690-737`): mirror `commercialCreatedEventId`/`accessRevokedEventId` with ledger-specific helpers (e.g. opening-credit ID derived from the arrangement ID, reversal ID derived from the target ID) so migration and commands are reproducible.

**Conventions to preserve:** explicit timestamps passed in, never `Date.now()` inside rules; deterministic ordering; stable human-readable `Error` messages; no React imports; keep `commercial-rules.ts` untouched (already 1,237 lines — do not grow it).

### `src/data/local-storage-repository.ts` (Plans 02-01, 02-02, 02-03)

**Analog:** the existing repository contract and implementation.

**Migration seam** (`src/data/local-storage-repository.ts:360-408`): extend `migrateStore` into staged v1→v2→v3. Keep `STORAGE_KEY` (`:195`) and `MIGRATION_TIMESTAMP` (`:201`) stable. For every prepaid arrangement with positive legacy `balanceCents`, append a deterministic opening `credit_grant` whose ID/reference derives from the arrangement ID; for zero, append nothing (D-15, Open Question 2 in `02-RESEARCH.md`). The opening transaction reason must state migration provenance and never imply a USD→token conversion rate. A canonical v3 reread must not append a second opening credit — reuse the existing idempotent `existingIds` guard pattern from `migrateSubscriptions` (`:222-247`).

**Repository contract** (`src/data/local-storage-repository.ts:101-183`): extend `HiveRepository` with synchronous commands and queries:

- `addCreditGrant(input, occurredAt): LedgerTransaction` — credit grant (LEDG-01).
- `recordUsage(input, occurredAt): { transaction, usage }` — atomic usage debit + usage record (USGE-01).
- `applyManualAdjustment(input, occurredAt): LedgerTransaction` — signed adjustment (LEDG-04).
- `reverseTransaction(input, occurredAt): LedgerTransaction` — single full reversal (D-05).
- `getPrepaidSnapshot(customerId, asOf)` / `getTokenBalance(customerId)` — derived balance + threshold (LEDG-03, USGE-05).
- `getAccountStatement(customerId)` — derived chronological statement rows (LEDG-05).
- `getUsageSummary(customerId, period, agentProductId?, type?)` — filtered rows + net consumption + per-agent totals (USGE-03, USGE-04).

**Atomic one-write command pattern** (`src/data/local-storage-repository.ts:687-703`, `705-771`): each command reads the store, validates customer/prepaid/agent references, calls the pure ledger rules to produce one complete next `DataStore`, then calls `write()` once. `recordUsage` must append the `UsageRecord` and its linked `usage_debit` in that same write (D-08, D-16, Pattern 2 in `02-RESEARCH.md`). Idempotent replay of an identical `sourceReference` returns the existing pair without calling `write()`; conflicting reuse throws a descriptive error naming the reference (D-09).

**Cascade extension** (`src/data/local-storage-repository.ts:575-596`): extend `deleteCustomer` to filter `ledgerTransactions` and `usageRecords` by `customerId` in the same write (Pitfall 6 in `02-RESEARCH.md`).

**Test adapter** (`src/data/local-storage-repository.ts:928-950`): reuse `createInMemoryRepository` for migration, atomic-write, cascade, and idempotency tests; seed raw legacy JSON payloads under `STORAGE_KEY` for migration tests.

**Conventions to preserve:** repository is the only feature-layer read/write boundary; pages call `useRepository()`; mutations throw descriptive errors; re-persist only when migration changed the payload (`:507-515`); deterministic timestamps.

### `src/data/seed-data.ts` (Plans 02-01, 02-02, 02-03)

**Analog:** existing deterministic seed aggregation (`src/data/seed-data.ts:199-233`, `794-808`).

**Seed builder pattern** (`src/data/seed-data.ts:199-233`): extend `CustomerSeed` with `ledgerTransactions` and `usageRecords`, and extend `seedCustomer` to accept them. The existing prepaid arrangement for `cust_meridians` (`seed-data.ts:578-592`, `balanceCents: 250000`) becomes the explainable token account: a deterministic opening `credit_grant` plus a small set of usage debits, one manual adjustment, and one reversal so every statement state is visible in the demo. Keep `SEED_NOW` (`:123`) as the fixed reference instant and `AGENT_PRODUCTS` IDs (`:62-117`) for usage attribution.

**Flattening pattern** (`src/data/seed-data.ts:794-808`): `buildSeedStore` must flatten the new arrays into the schema v3 `DataStore` exactly like the existing collections.

**Conventions to preserve:** explicit timestamps for repeatable rendering/tests; stable deterministic IDs; fictional data only; presentation labels centralized here, business behavior in rules/repository.

### `AddCreditSheet.tsx`, `RecordUsageSheet.tsx`, `AdjustmentSheet.tsx`, `ReversalSheet.tsx` (Plans 02-01, 02-02)

**Analogs:** `CommercialArrangementSheet.tsx`, `AgentAccessSheet.tsx`, `TerminateArrangementDialog`, `ArrangementRecordDialog`.

**Form imports/schema/inference** (`CommercialArrangementSheet.tsx:1-52`, `84-207`): reuse the exact React Hook Form + Zod resolver + `z.infer` pattern. Schemas live outside components; token fields validate finite positive whole numbers; `Reference` is required and trimmed; `Reason` is required for adjustment/reversal (LEDG-04) and optional for credit (UI-SPEC Add-credit flow). Repository invariants remain authoritative — Zod is UI validation only.

**Sheet composition and dirty-close** (`CommercialArrangementSheet.tsx:305-357`, `419-437`): copy the controlled `Sheet` with `w-full md:max-w-[520px]`, `onEscapeKeyDown`/`onPointerDownOutside`/`onInteractOutside` guards while submitting, `form.reset` on open, `isDirty`-gated discard `AlertDialog` with flow-specific copy (`Discard credit draft?`, `Discard usage draft?`, etc.), and `TOUCH_TARGET` on controls.

**Agent select** (`AgentAccessSheet.tsx:52-120`): `RecordUsageSheet` reuses the `Select`/`SelectTrigger`/`SelectContent`/`SelectItem` pattern, populated only with catalog agents the customer may currently use (UI-SPEC Record-usage flow).

**Named-customer confirmation** (`TerminateArrangementDialog` at `CommercialArrangementSheet.tsx:845-941`; `CustomersPage.tsx:332-383`): every balance-changing action ends in an `AlertDialog` titled with the customer name and describing current → resulting balance (D-07, SAFE-02). The final action is enabled only when the form is valid; `Edit credit`/`Edit adjustment`/`Edit usage`/`Edit reversal` returns to the draft without mutation. Pending verbs (`Adding credit…`, `Recording usage…`, …) disable double submission.

**Immutable record presentation** (`ArrangementRecordDialog` at `CommercialArrangementSheet.tsx:947-1041`): the reversal flow shows the immutable original transaction beside the reversal form; `ReversalSheet` reuses this read-only record-detail layout.

**Data flow through `HiveRepository`:** form values → `repo.addCreditGrant(...)` / `repo.recordUsage(...)` / `repo.applyManualAdjustment(...)` / `repo.reverseTransaction(...)` → repository validates via `ledger-rules` → one `write()` → `onSaved()` bumps the profile revision → toast announces the resulting balance. Idempotent usage replay announces `Usage already recorded` with no write (D-09).

**Related tests:** `CustomerProfilePage.test.tsx` — confirmed actions, cancel no-op, dirty discard, insufficient-balance block, exact-replay no-op, conflicting-reference error.

**Conventions to preserve:** validation in domain/repository, never in components (D-16); named subject + explicit consequence in confirmations; focus restore to the invoking control; warm minimal visual language; no editable balance field anywhere.

### `TokenStatement.tsx` (Plan 02-03)

**Analog:** `ActivityTimeline.tsx` + `DataTable` history in `CustomerProfilePage.tsx:402-413` + `CustomersPage.tsx` filter row.

**Chronological projection** (`ActivityTimeline.tsx:14-85`): render newest-first inside the existing Activity tab, above `Commercial and access history`; do not duplicate ledger events into the `ActivityEvent` timeline (D-13, anti-pattern in `02-RESEARCH.md`).

**Table pattern** (`CustomerProfilePage.tsx:402-413`): use `DataTable`/`DataTableColumn` with a caption `Token account statement for {customer}`, semantic headers, and bounded horizontal scroll. Columns per UI-SPEC: Date, Type (badge), Agent/detail, signed Amount (`+`/`−` with tabular numerals), Resulting balance (full-account, never a filtered subtotal), Reference (monospace, wrap-then-truncate with full accessible value), Actions (`Reverse transaction` for eligible unreversed rows).

**Filter row pattern** (`CustomersPage.tsx:288-310`): one compact row with `From`/`To` date inputs, `Agent` select (`All agents` default), `Transaction type` select, and `Clear filters` enabled only when a filter is active. Inclusive date boundaries; invalid ranges show `From date must be on or before To date` and keep the last valid result.

**Selected-period summary** (USGE-04): a restrained band showing `Net tokens consumed` and compact per-agent rows ordered highest first, ties by agent name — text and table rows, never charts.

**Data flow through `HiveRepository`:** `repo.getAccountStatement(customerId)` and `repo.getUsageSummary(...)` projections computed in `useMemo`; filters apply to displayed rows only, while each row's resulting balance stays the full-account balance at that transaction (Pattern 4 in `02-RESEARCH.md`).

**Related tests:** `CustomerProfilePage.test.tsx` — statement rows, combined filters, inclusive boundaries, empty-filtered copy, reversed usage nets to zero.

**Conventions to preserve:** newest-first deterministic ordering; `tabular-nums` for amounts/dates; monospace stable references; empty states with exact UI-SPEC copy; no charts/KPI grids; no fifth profile tab.

### `src/features/customers/components/format.ts` (Plans 02-01, 02-03)

**Analog:** same file.

**Deprecation** (`format.ts:12-14`): `formatUsd` must no longer be called for prepaid balances (Pitfall 1 in `02-RESEARCH.md`). Add a `formatTokens(n)` helper rendering `{N} tokens` with correct singular/plural and tabular numerals, plus a signed variant for statement amounts. `modelPrimaryValue` (`format.ts:29-40`) and `modelImportantDate` (`format.ts:43-56`) gain prepaid branches that read the derived balance/threshold instead of `balanceCents`. Keep `TOUCH_TARGET` (`format.ts:62`).

**Conventions to preserve:** formatting-only helpers, no business rules; unit label `tokens` always visible; no currency symbols on prepaid surfaces.

### `src/features/customers/pages/CustomerProfilePage.tsx` (Plans 02-01, 02-02, 02-03)

**Analog:** same file.

**Aggregate query pattern** (`CustomerProfilePage.tsx:54-79`): keep the four-tab composition and revision-counter refresh. Add prepaid projections (`getPrepaidSnapshot`, `getAccountStatement`, `getUsageSummary`) read alongside `getCommercialSnapshot`/`getAgentAccessSnapshot`. The Commercial tab's prepaid card (`arrangementTerms` at `:509-525`) swaps `formatUsd(arrangement.balanceCents)` for the derived token balance, threshold, `Balance source — Derived from {N} immutable transactions`, and the `Add credit`/`Adjust balance`/`Edit threshold` actions. The Activity tab (`:165-167`) composes `TokenStatement` above `ActivityTimeline`. Overview (`:232-245`) shows the derived balance and the `Low balance` badge for active prepaid only (D-12, D-13).

**Conventions to preserve:** exactly four top-level tabs; `useRepository()` only; `useMemo` projections; `data-testid` for stable product entities; missing-customer empty state; no balance actions unless an active prepaid arrangement exists.

### `src/features/customers/pages/CustomersPage.tsx` (Plan 02-03)

**Analog:** same file.

**Collection projection** (`CustomersPage.tsx:58-99`): extend the `related` memo with a per-customer prepaid snapshot map (`getPrepaidSnapshot`) so the commercial/subscription cell can render `{N} tokens` and the gold-outline `Low balance` badge for active prepaid customers at or below threshold (USGE-05, UI-SPEC Customer list). Accessible text includes balance and threshold, e.g. `Low balance: 80 tokens remaining; warning threshold 100 tokens`.

**Conventions to preserve:** restrained summary strip; no KPI cards, global banners, or new routes; `tabular-nums`; warm minimal visual language.

## Test Pattern Assignments

### `src/domain/ledger-rules.test.ts` (new)

**Analog:** `src/domain/commercial-rules.test.ts` (983 lines of table-driven pure tests).

Use Vitest table-driven tests with explicit timestamps and no rendered UI. Cover: signed sums and empty-ledger zero; invalid fractions/NaN/zero per kind; exact single reversal and rejection of reversal-of-reversal/second reversal; no-negative guard; fingerprint normalization and exact-replay vs. conflict; statement ordering ties and full-account running balances under filters; inclusive date boundaries; per-agent aggregation; `balance === threshold` low-balance boundary.

### `src/data/local-storage-repository.test.ts` (extended)

**Analog:** same file + `createInMemoryRepository` (`local-storage-repository.test.ts:1-32`).

Add: v2→v3 migration preserving every collection; deterministic opening-credit ID/reference; one-time reread (no second opening credit); positive and zero legacy balances; corrupt payload fallback; atomic usage+debit commit; exact retry leaves IDs/count/balance unchanged; conflicting retry throws; insufficient balance leaves both arrays unchanged; adjustment/reversal invariants; delete cascade removes ledger/usage records.

### `src/features/customers/pages/CustomerProfilePage.test.tsx` (extended)

**Analog:** same file, `renderProfilePath` helper (`CustomerProfilePage.test.tsx:24-42`).

Add: confirmed credit/usage/adjustment/reversal flows; cancel no-op; dirty-discard copy per action; insufficient-balance and conflict messages; statement rows and filters; per-agent totals; low-balance badge in Overview and Commercial; exact empty copy.

### `src/features/customers/pages/CustomersPage.test.tsx` (extended)

**Analog:** same file, deletion test (`CustomersPage.test.tsx:8-42`).

Add: active prepaid row shows derived balance; `Low balance` badge at and below threshold, absent above; non-active-prepaid customers never show the badge.

### `e2e/console.spec.ts` (extended)

**Analog:** same file.

Keep the `beforeEach` store-reset init script (`console.spec.ts:17-24`), role/label/testid queries, and reload-persistence assertions. Do **not** copy conditional skip behavior. Add strict no-skip flows: one confirmed credit tracer (balance + statement row survive reload); one usage debit with exact-replay no-op and conflicting-reference error; one adjustment and one reversal with named confirmations; statement filters and per-agent breakdown; low-balance badge in list and profile.

## Shared Patterns

### Repository injection

**Source:** `src/data/repository-context.tsx:5-26`

Apply to all feature pages/components. Accept the repository through `RepositoryProvider`; call `useRepository()` inside the feature. Do not access storage from components.

### Error handling

**Source:** `CommercialArrangementSheet.tsx:402-417`

Repository methods throw descriptive `Error`s; UI catches them, retains form state, and shows `toast.error`. Balance-changing failures use the UI-SPEC copy (insufficient balance, conflicting reference, already reversed, reversal-of-reversal) and never partially persist.

### Accessible overlays

**Source:** `components/ui/sheet.tsx`, `components/ui/alert-dialog.tsx`

Use Radix-owned portal/focus/escape behavior and semantic titles/descriptions. Never hand-roll an overlay. Block closing only while a mutation is committing; return focus to the invoking control.

### Status, labels, and visual tone

**Source:** `seed-data.ts:36-55`, `CustomerProfilePage.tsx:423-469`

Centralize labels/classes, pair every color with text, use `tabular-nums` for amounts/dates/counts, keep IDs/references monospace and subordinate to human names, and retain warm card/border tokens. Low balance uses gold/caution, never red; destructive emphasis is reserved for negative adjustment/reversal confirmations.

### Deterministic ordering

**Source:** `CustomersPage.tsx:58-70`, `local-storage-repository.ts:916-920`

Compute filtered/joined projections with `useMemo`, sort explicitly, and construct lookup maps before rendering. Statement rows derive full-account running balances in ascending order first; filters apply to display only; the list renders newest first.

## No Analog Found

| File | Role | Data Flow | Reason / Planner Guidance |
|---|---|---|---|
| `src/domain/ledger-rules.test.ts` | test | pure transform | No pure ledger test exists. Use Vitest table-driven tests with explicit timestamps and no rendered UI, mirroring `commercial-rules.test.ts`. |

There is also no existing product-level sheet→confirmation→resulting-balance flow. Compose the existing controlled `Sheet` + `AlertDialog` primitives and the `CommercialArrangementSheet` dirty-discard pattern; do not use the unrelated Refine-generated forms/layouts.

## Anti-Patterns to Avoid

- Do not store an editable `balanceTokens` counter; derive balance from immutable ledger entries every time (D-02).
- Do not edit or delete ledger transactions; corrections append a single linked reversal (D-04, D-05).
- Do not write usage and debit separately; produce one next `DataStore` and call `write()` once (D-08, D-16).
- Do not check duplicate `sourceReference` only in React; enforce fingerprint idempotency in domain/repository (D-09, D-16).
- Do not filter first and then derive row balances; derive full-account history first, filter display second (LEDG-05).
- Do not duplicate ledger events into `ActivityEvent`; the ledger is the immutable financial timeline and `Commercial and access history` stays separate (D-13).
- Do not keep `currency`/`balanceCents` on the prepaid v3 type or call `formatUsd` for prepaid balances (D-01, Pitfall 1 in `02-RESEARCH.md`).
- Do not add charts, KPI-card grids, global low-balance alerts, payment/invoice language, or a fifth profile tab (D-12, D-14, UI-SPEC guardrails).
- Do not expose balance actions unless an active prepaid arrangement exists; historical statements remain readable (UI-SPEC guardrails).
- Do not add backend/API, async cache, chart library, or a second design system.

## Metadata

**Analog search scope:** `src/domain`, `src/data`, `src/features/customers`, `src/components/ui`, `src/lib`, `e2e`

**Primary files read:** 17 planning/source/test files plus the Phase 2 CONTEXT/RESEARCH/UI-SPEC contracts

**Pattern extraction date:** 2026-09-10