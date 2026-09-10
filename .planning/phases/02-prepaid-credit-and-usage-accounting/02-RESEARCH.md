# Phase 2: Prepaid Credit and Usage Accounting - Research

**Researched:** 2026-09-10  
**Domain:** Append-only prepaid token ledger, usage idempotency, localStorage schema migration, and operator UI  
**Confidence:** HIGH for repository architecture and locked product behavior; MEDIUM for external ledger/idempotency guidance

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Credit unit and balance
- **D-01:** Prepaid credit and every ledger amount are denominated in whole Hivarium tokens, not money. Token quantity is the canonical accounting unit throughout the Phase 2 domain model, calculations, forms, summaries, and tests. — **Reversibility:** costly — changing units later would require migrating every persisted ledger entry, usage record, threshold, fixture, calculation, and UI label.
- **D-02:** Current balance is always derived by summing immutable signed ledger transactions. No editable or separately persisted balance counter may exist.
- **D-03:** A usage debit that would make the derived balance negative is rejected before any ledger or usage record is written. The UI must explain the available balance, attempted debit, and affected customer.

#### Ledger corrections and safety
- **D-04:** Supported immutable transaction kinds are `credit_grant`, `usage_debit`, `manual_adjustment`, and `reversal`. Existing transactions are never edited or deleted.
- **D-05:** A reversal appends a new transaction that references the original transaction, negates its full token amount exactly once, and requires an operator-entered reason. A reversal of a reversal and a second reversal of the same original transaction are rejected.
- **D-06:** A manual adjustment may add or subtract tokens, requires a non-zero whole-token amount and a reason, and must also obey the no-negative-balance rule.
- **D-07:** Credit grants, manual adjustments, and reversals require a confirmation dialog naming the customer and stating the resulting balance before the mutation is committed. Usage debits also require confirmation because Phase 2 uses operator-entered deterministic demo events.

#### Usage identity and idempotency
- **D-08:** Each usage debit records exactly one customer, one catalog agent product, occurred-at timestamp, positive whole-token quantity, and required unique `sourceReference`.
- **D-09:** Re-submitting the same `sourceReference` with identical normalized customer, agent, token quantity, and occurred-at values is idempotent: it returns the existing transaction and does not debit again. Reusing that reference with different values is rejected as a conflict.
- **D-10:** Phase 2 supports manual deterministic usage entry only. Automatic ingestion from Hivarium runtime events is deferred until a trusted server-owned integration exists.

#### Low-balance and investigation experience
- **D-11:** Each prepaid commercial arrangement has a configurable non-negative whole-token warning threshold, defaulting to `100` tokens for new arrangements and migrated demo records.
- **D-12:** A prepaid customer is low-balance when derived balance is less than or equal to its configured threshold. Show a restrained warning badge in the customer list and profile; do not add a generic analytics dashboard or noisy global alert system.
- **D-13:** The customer profile remains the primary surface. Extend the existing `Commercial` experience with balance and safe credit actions, and use the existing `Activity` area for a chronological ledger/usage statement with filters for date range, agent product, and transaction type.
- **D-14:** The selected statement period shows tokens consumed and a compact per-agent token breakdown. Use text and table rows rather than decorative charts.

#### Prototype persistence and migration
- **D-15:** Extend the existing versioned localStorage repository and deterministic seed fixtures. Migrate Phase 1 prepaid arrangements into a seeded opening credit transaction so the displayed balance remains explainable and no customer record is dropped.
- **D-16:** All ledger arithmetic, idempotency checks, validation, and lifecycle invariants live in domain/repository code, not inside React components.

### the agent's Discretion
- Exact component and helper names, drawer widths, responsive table/card fallback, timestamp display format, filter-control layout, and fixture values may follow existing project conventions.
- The planner may split Phase 2 into up to three sequential vertical plans as long as each completed plan leaves the console working and testable.

### Deferred Ideas (OUT OF SCOPE)
- Automatic usage ingestion from trusted Hivarium runtime events (`AUTO-01`) is deferred until server-owned persistence and authorization exist.
- Email or in-app low-balance notifications (`AUTO-02`) are deferred; Phase 2 provides visible status only.
- Statement export, invoicing, card processing, taxes, and general-ledger accounting remain out of scope.
- Durable database storage, server authorization, and tamper-resistant audit retention remain Phase 3 work.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LEDG-01 | "Operator can add token credit to a prepaid customer account through an explicitly confirmed action" | Repository command plus named-customer/resulting-balance confirmation pattern. [VERIFIED: `.planning/REQUIREMENTS.md:30`] |
| LEDG-02 | "System records credit grants, usage debits, manual adjustments, and reversals as immutable ledger transactions" | Signed transaction union and append-only command model. [VERIFIED: `.planning/REQUIREMENTS.md:31`] |
| LEDG-03 | "System calculates the current customer balance from ledger transactions rather than storing an editable balance counter" | Pure `deriveTokenBalance()` projection; remove canonical `balanceCents`. [VERIFIED: `.planning/REQUIREMENTS.md:32`] |
| LEDG-04 | "Operator can enter a reason or reference for every manual credit adjustment or reversal" | Required reason/reference validation at repository boundary. [VERIFIED: `.planning/REQUIREMENTS.md:33`] |
| LEDG-05 | "Operator can view a chronological account statement showing transaction type, amount, resulting balance, timestamp, and reference" | Derived statement rows computed oldest-first, displayed newest-first. [VERIFIED: `.planning/REQUIREMENTS.md:34`] |
| USGE-01 | "System can record a usage debit attributed to one customer, one agent product, a timestamp, token quantity, and unique source reference" | Atomic `UsageRecord` + linked `LedgerTransaction`. [VERIFIED: `.planning/REQUIREMENTS.md:38`] |
| USGE-02 | "Duplicate usage events with the same source reference do not reduce the balance twice" | Normalized fingerprint replay/conflict rules. [VERIFIED: `.planning/REQUIREMENTS.md:39`] |
| USGE-03 | "Operator can filter a customer's usage history by date range, agent product, and transaction type" | Pure statement query/filter projection used by Activity UI. [VERIFIED: `.planning/REQUIREMENTS.md:40`] |
| USGE-04 | "Operator can see total tokens consumed for a selected period and a breakdown by agent product" | Net usage-debit aggregation grouped by stable agent product ID. [VERIFIED: `.planning/REQUIREMENTS.md:41`] |
| USGE-05 | "Operator can clearly identify prepaid customers whose remaining balance is below a configurable warning threshold" | Prepaid snapshot plus restrained customer/profile badge. [VERIFIED: `.planning/REQUIREMENTS.md:42`] |
| SAFE-02 | "Destructive or balance-changing actions require clear confirmation naming the affected customer and consequence" | Existing Radix confirmation convention extended to every balance-changing command. [VERIFIED: `.planning/REQUIREMENTS.md:47`; `src/features/customers/pages/CustomersPage.tsx:332-381`] |
</phase_requirements>

## Summary

Phase 2 should be built as a small append-only token-accounting subsystem behind the existing `HiveRepository`, not as billing infrastructure. The codebase already has the correct architectural seam: serializable domain records, pure rule functions, a versioned `LocalStorageRepository`, deterministic fixtures, repository injection, four customer-profile tabs, Radix confirmations, Vitest, and Playwright. [VERIFIED: `src/domain/types.ts:1-11`; `src/data/local-storage-repository.ts:90-183`; `src/features/customers/pages/CustomerProfilePage.tsx:45-52`; `package.json:69-102`]

The required migration is a real semantic change. The current canonical store says `"schemaVersion: 2"`, and its prepaid record says `"currency: \"USD\""` plus `"balanceCents: number"`; the seed currently stores `balanceCents: 250000`. [VERIFIED: `src/domain/types.ts:98-115,238-255`; `src/data/seed-data.ts:578-592`] Phase 2 must introduce schema v3, replace the stored prepaid balance with `warningThresholdTokens`, and create deterministic opening-credit ledger transactions before the old field is discarded. This conversion is prototype-only: carrying the raw numeric value forward preserves the displayed quantity required by D-15, but must be labeled as migration provenance and must not be presented as a USD-to-token exchange rate. [VERIFIED: `02-CONTEXT.md:16-19,32-40`; inference from locked D-01 and D-15]

Use one pure `ledger-rules.ts` module for validation, balance derivation, statement projection, reversal checks, and usage fingerprinting; keep the repository responsible for referential checks and one-write commits. Completed ledger entries should only be corrected by a new reversing entry, and a mutation may be rejected based on its resulting balance. [CITED: https://docs.moderntreasury.com/ledgers/docs/transaction-status-and-balances] Exact retries with the same identity and parameters should produce no additional action, while changed parameters under that identity should fail. [CITED: https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html]

**Primary recommendation:** Implement three sequential vertical plans: (1) schema v3 + migration + derived balance + confirmed credit tracer, (2) atomic usage/idempotency + adjustment/reversal safety, and (3) statement filters/aggregates + low-balance UI + full regression.

## Project Constraints (from AGENTS.md)

- Keep the product an internal customer-operations console; do not expand into CRM, ERP, or runtime governance. [VERIFIED: `AGENTS.md:13-16`]
- Cloudflare Access remains the perimeter; server authorization is deferred until real multi-user use. [VERIFIED: `AGENTS.md:16-18`]
- Balances must be derived from immutable transactions; `localStorage` is acceptable only for deterministic demo flows. [VERIFIED: `AGENTS.md:17-18`]
- Deliver visible vertical slices that remain testable, preserve the warm minimal accessible UI, and retain Cloudflare static-SPA compatibility. [VERIFIED: `AGENTS.md:19-21`]
- Work must stay inside a GSD workflow; direct repository changes outside it are forbidden unless explicitly bypassed. [VERIFIED: `AGENTS.md:219-231`]
- No project-local skills were found. [VERIFIED: `AGENTS.md:212-216`]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ledger validation, signed arithmetic, reversal and idempotency rules | Browser domain layer | — | The current MVP is browser-only, and D-16 locks invariants outside React. [VERIFIED: `02-CONTEXT.md:38-40`; `AGENTS.md:7-9`] |
| Referential checks and atomic local commits | Browser repository/data layer | Browser domain layer | `HiveRepository` is the only feature read/write boundary and writes the complete store. [VERIFIED: `src/data/local-storage-repository.ts:90-183,477-527`] |
| v2-to-v3 migration and opening credit | Browser repository/data layer | Browser storage | `migrateStore()` is explicitly the only persisted-format upgrade seam. [VERIFIED: `src/data/local-storage-repository.ts:345-408`] |
| Confirmed credit, usage, adjustment, and reversal workflows | Browser presentation layer | Browser repository | Existing feature pages obtain mutations through `useRepository()` and reuse Radix dialogs/toasts. [VERIFIED: `src/features/customers/pages/CustomerProfilePage.tsx:54-79`; `src/features/customers/pages/CustomersPage.tsx:332-381`] |
| Statement filters, balances, and per-agent totals | Browser domain projection | Browser presentation layer | Calculation must remain deterministic and out of components; UI only renders projections. [VERIFIED: `02-CONTEXT.md:32-40`] |
| Durable concurrency, authorization, trusted runtime ingestion | API/backend | Database/storage | Explicitly deferred to Phase 3 or `AUTO-01`; do not simulate these in Phase 2. [VERIFIED: `02-CONTEXT.md:108-115`; `.planning/REQUIREMENTS.md:46-51,57-59`] |

## Standard Stack

No new package is needed. Use the already-installed stack and existing patterns. [VERIFIED: `package.json:6-92`]

### Core

| Library / module | Version | Purpose | Why Standard Here |
|------------------|---------|---------|-------------------|
| TypeScript | `^5.8.3` | Discriminated ledger unions and pure rules | Existing strict domain model. [VERIFIED: `package.json:89`; `src/domain/types.ts:14-170`] |
| React | `19.1.0` | Customer-profile and customer-list presentation | Existing UI runtime. [VERIFIED: `package.json:55-57`] |
| Existing `HiveRepository` / `LocalStorageRepository` | in-repo | Commands, queries, migration, persistence | Required feature boundary; do not bypass it. [VERIFIED: `src/data/local-storage-repository.ts:90-183,477-527`] |
| Existing Radix AlertDialog and Sheet primitives | `@radix-ui/react-alert-dialog ^1.1.11`, `@radix-ui/react-dialog ^1.1.11` | Accessible confirmations and focused forms | Existing confirmed destructive-action pattern. [VERIFIED: `package.json:9,15`; `src/features/customers/pages/CustomersPage.tsx:25-35,349-381`] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| React Hook Form | `^7.57.0` | Credit/usage/adjustment/reversal form state | Reuse current form convention; keep accounting validation in domain/repository. [VERIFIED: `package.json:58`; `.planning/codebase/STACK.md:22-28`] |
| Zod | `^3.24.3` | UI-form shape validation only | Use only if the existing sheet convention already uses it; repository invariants remain authoritative. [VERIFIED: `package.json:67`; `.planning/codebase/STACK.md:22-28`] |
| Vitest + Testing Library | `^4.1.11` + existing Testing Library packages | Pure rule, repository, and component tests | Existing test stack. [VERIFIED: `package.json:71-76,87,92`] |
| Playwright | `^1.63.0` | Principal operator flows and responsive browser checks | Existing E2E gate. [VERIFIED: `package.json:71,100`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pure in-repo token ledger rules | External accounting/ledger package | Rejected for this MVP: the scope is one single-account token log, not money movement, double-entry bookkeeping, or a general ledger. [VERIFIED: `.planning/REQUIREMENTS.md:68-77`; `02-CONTEXT.md:108-115`] |
| Existing synchronous repository | Backend API/database | Correct production direction, but explicitly Phase 3. [VERIFIED: `.planning/ROADMAP.md:43-53`] |
| Existing Activity tab | New billing dashboard/route | Rejected by D-13 and the product constraint against decorative dashboards. [VERIFIED: `02-CONTEXT.md:32-36`; `.planning/REQUIREMENTS.md:70-77`] |

**Installation:** None. Do not add dependencies.

## Architecture Patterns

### System Architecture Diagram

```text
Operator form
    |
    v
Named-customer confirmation
    |
    v
HiveRepository command
    |---- validate customer / prepaid arrangement / agent references
    v
Pure ledger rules
    |---- normalize + fingerprint usage
    |---- derive current balance
    |---- enforce no-negative result
    |---- enforce reversal uniqueness
    v
One next DataStore value
    |---- append LedgerTransaction
    |---- append UsageRecord only for usage_debit
    v
One LocalStorageRepository.write()
    |
    +--> Derived prepaid snapshot
    +--> Derived statement rows + filters + per-agent totals
    +--> Existing Commercial and Activity UI
```

The one-write shape follows the current repository's immutable-copy/write pattern. [VERIFIED: `src/data/local-storage-repository.ts:687-703,739-770,873-878`]

### Recommended Project Structure

```text
src/
├── domain/
│   ├── types.ts                    # schema v3 ledger/usage/prepaid contracts
│   ├── commercial-rules.ts         # existing commercial/access lifecycle only
│   └── ledger-rules.ts             # new pure ledger invariants and projections
├── data/
│   ├── local-storage-repository.ts # migration + repository commands/queries
│   ├── seed-data.ts                # deterministic token ledger fixtures
│   └── *.test.ts                   # migration and atomic-write tests
└── features/customers/
    ├── components/                 # focused forms, confirmations, statement
    └── pages/                      # existing profile/list composition
```

This structure preserves existing feature/domain/data boundaries and avoids further growth of `commercial-rules.ts`, which is already 1,237 lines. [VERIFIED: `.planning/codebase/ARCHITECTURE.md:16-38`; file length observed with `wc -l src/domain/commercial-rules.ts`]

### Pattern 1: Signed append-only transaction algebra

The exact locked kinds are quoted as `"credit_grant"`, `"usage_debit"`, `"manual_adjustment"`, and `"reversal"`; the balance is the sum of signed whole-token amounts. [VERIFIED: `02-CONTEXT.md:16-24`]

| Kind | Amount invariant | Required links / metadata |
|------|------------------|---------------------------|
| `credit_grant` | positive whole tokens | customer, timestamp, operator reason/reference |
| `usage_debit` | negative and exactly `-usage.tokenQuantity` | one usage record, one agent product, one unique source reference |
| `manual_adjustment` | non-zero signed whole tokens | operator reason/reference |
| `reversal` | exactly `-target.amountTokens` | original transaction ID, operator reason/reference; original cannot be a reversal or already reversed |

Every candidate transaction is validated against the balance before append; rejected operations return no next store and therefore cannot leave a ledger/usage half-write. [VERIFIED: `02-CONTEXT.md:18-29`; consistent with existing one-write repository pattern at `src/data/local-storage-repository.ts:739-770`]

### Pattern 2: Separate immutable usage fact from token effect

Store a `UsageRecord` for the operational fact (`customerId`, `agentProductId`, `occurredAt`, positive `tokenQuantity`, unique `sourceReference`, `ledgerTransactionId`) and a signed `LedgerTransaction` for its account effect. This directly follows the locked integration statement that the two records connect through one immutable transaction ID and commit atomically. [VERIFIED: `02-CONTEXT.md:92-96`]

Do not add a second mutable consumption total. Compute selected-period totals from usage debits and their reversal entries. Label the UI **Net tokens consumed** so a fully reversed debit contributes zero while both immutable records remain visible. This is the most explainable interpretation of corrected usage under D-05 and USGE-04. [VERIFIED: `02-CONTEXT.md:21-24,32-36`; `.planning/REQUIREMENTS.md:41`]

### Pattern 3: Fingerprint-based idempotency

Normalize exactly these locked fields before comparison: trimmed `customerId`, trimmed `agentProductId`, positive integer `tokenQuantity`, and canonical ISO `occurredAt`; trim but do not case-fold `sourceReference`. [VERIFIED: `02-CONTEXT.md:27-30`]

On usage submission:

1. Find the existing usage record by exact `sourceReference` across the store.
2. If absent, validate and append the linked debit and usage record atomically.
3. If present and the normalized fingerprint matches, return the existing pair without calling `write()`.
4. If present and any fingerprint field differs, throw an explicit conflict error naming the reference.

This matches authoritative retry behavior: same token + same parameters causes no additional action; same token + changed parameters is rejected. [CITED: https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html]

### Pattern 4: Derived chronological statement

Compute statement balances in deterministic ascending transaction order (`occurredAt`, then original array index as tie-breaker), attach `resultingBalanceTokens`, and reverse only the display list. Filters must be applied to displayed rows, but each row's resulting balance must remain the full-account balance at that transaction, not a subtotal of filtered rows. The selected-period summary is computed separately from in-period usage effects. [VERIFIED: requirement wording at `.planning/REQUIREMENTS.md:34,40-42`; ordering recommendation follows existing newest-first activity projection at `src/data/local-storage-repository.ts:916-920`]

Use inclusive date boundaries in the operator's selected date range and normalize them once before filtering; tests must cover start/end boundary timestamps. [ASSUMED]

### Pattern 5: Schema v2 to v3 migration pipeline

Keep the storage key exactly `"hivarium.operator-console.store.v1"`; it is intentionally stable so old browser payloads are found. Keep the deterministic migration instant `"2026-09-09T00:00:00.000Z"` unless the plan deliberately introduces one newer fixed v3 cutover timestamp. [VERIFIED: `src/data/local-storage-repository.ts:190-201`]

Refactor migration into explicit stages:

1. Convert legacy v1 payloads into the current v2 semantic shape using the existing logic.
2. Convert v2 into v3 exactly once.
3. For every prepaid arrangement with a positive legacy `balanceCents`, append deterministic opening credit ID/reference derived from the arrangement ID; for zero, append nothing and derive zero.
4. Replace prepaid `currency`/`balanceCents` with `warningThresholdTokens: 100`; preserve every base field, `expiresAt`, and note.
5. Preserve all customers, features, products, commercial history, access grants, and activity events.
6. A canonical v3 reread must not append a second opening credit.

Because the locked decisions require both a token-only domain and preservation of the displayed legacy quantity, the migration should carry the raw positive integer forward one-for-one **only as fictional prototype opening tokens**. The opening transaction reason must state migration provenance; it must not imply currency conversion. [VERIFIED: `02-CONTEXT.md:16-19,38-40`; current seed value at `src/data/seed-data.ts:580-591`]

### Anti-Patterns to Avoid

- **Stored `balanceTokens`:** violates D-02; derive it every time from ledger entries. [VERIFIED: `02-CONTEXT.md:16-20`]
- **Editing/deleting transactions:** violates D-04; append a reversal. [VERIFIED: `02-CONTEXT.md:21-24`]
- **Writing usage and debit separately:** creates partial state; produce one next `DataStore` and write once. [VERIFIED: `02-CONTEXT.md:92-95`]
- **Checking duplicate reference only in React:** bypassable and non-reusable; enforce in domain/repository. [VERIFIED: `02-CONTEXT.md:27-30,38-40`]
- **Filtering first and then deriving row balances:** produces false "resulting balance" values; derive full history first, filter display second. [VERIFIED: `.planning/REQUIREMENTS.md:34,40-41`]
- **Duplicating every ledger action in `ActivityEvent`:** the ledger is already the immutable financial timeline; retain existing commercial/access Activity history below or alongside it rather than creating two competing records. [VERIFIED: current Activity type scope at `src/domain/types.ts:206-232`; D-13 at `02-CONTEXT.md:35`]
- **Adding charts/global KPI cards:** explicitly out of scope. [VERIFIED: `02-CONTEXT.md:32-36`; `.planning/REQUIREMENTS.md:77`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Modal focus/escape semantics | Custom overlay and focus trap | Existing Radix AlertDialog/Sheet wrappers | Already installed and already used for confirmed destructive actions. [VERIFIED: `package.json:8-33`; `src/features/customers/pages/CustomersPage.tsx:25-35,349-381`] |
| Table paging/semantics | New statement table framework | Existing `DataTable` and responsive wrapper pattern | Existing app convention and tested pagination behavior. [VERIFIED: `src/features/customers/pages/CustomerProfilePage.tsx:402-413`; `.planning/codebase/TESTING.md:37-51`] |
| Money/accounting engine | Currency conversion, invoices, double-entry GL | Small token-specific pure rules | Money movement, tax, invoicing, and general accounting are explicitly excluded. [VERIFIED: `.planning/REQUIREMENTS.md:68-77`] |
| Backend/concurrency simulation | Browser locks, fake API, sync queue | One synchronous repository write in Phase 2 | Durable concurrency and authorization belong in Phase 3. [VERIFIED: `.planning/ROADMAP.md:43-53`] |

**Key insight:** the difficult part here is not arithmetic; it is preserving one canonical append-only history across retries, corrections, migration, and filtered projections. Keep that logic pure and test it before adding UI.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | Browser localStorage key is exactly `"hivarium.operator-console.store.v1"`; canonical records currently say `"schemaVersion: 2"`. [VERIFIED: `src/data/local-storage-repository.ts:190-201`; `src/domain/types.ts:238-255`] | Code migration v2→v3 plus persisted rewrite on first read; retain the key. Actual user-browser payloads cannot be enumerated from the remote shell. |
| Live service config | Cloudflare deploys only static assets from `"./dist"` with SPA fallback; no ledger service or API is configured. [VERIFIED: `wrangler.jsonc:1-7`; `.planning/codebase/STACK.md:30-36`] | None in Phase 2. Rebuild static assets after implementation. |
| OS-registered state | No OS service owns ledger schema; this is a browser-only SPA. [VERIFIED: `.planning/codebase/ARCHITECTURE.md:5-7`; `.planning/codebase/STACK.md:30-36`] | None. |
| Secrets/env vars | `.env` exists locally but no ledger secret/config is defined in tracked project surfaces; secret content was not inspected. [VERIFIED: read-only environment inventory on 2026-09-10; `.planning/codebase/STACK.md:54-58`] | None; do not add token balances or thresholds to environment variables. |
| Build artifacts / installed packages | `dist/` and `node_modules/` exist on the remote host. [VERIFIED: read-only `ls -ld` on 2026-09-10] | Run normal typecheck/test/build gates; do not edit generated output or install packages. |

## Common Pitfalls

### Pitfall 1: Unit mismatch during migration
**What goes wrong:** old `balanceCents` is silently relabeled as tokens.  
**Why it happens:** Phase 1 modeled prepaid as USD while D-01 locks Phase 2 to tokens. [VERIFIED: `src/domain/types.ts:98-115`; `02-CONTEXT.md:16-19`]  
**How to avoid:** make the deterministic opening-credit transaction visibly migration-sourced, preserve the raw number only for fictional prototype continuity, and delete all USD labels from prepaid UI/domain.  
**Warning signs:** `formatUsd()` is still called for a prepaid balance or `currency` remains on the prepaid v3 type. [VERIFIED: current call sites `src/features/customers/pages/CustomerProfilePage.tsx:509-523,607-614`]

### Pitfall 2: Idempotency after mutation
**What goes wrong:** the second usage retry is checked only after another debit is appended.  
**How to avoid:** look up and fingerprint `sourceReference` before balance validation and before constructing the next store; an exact replay performs zero writes. [VERIFIED: `02-CONTEXT.md:27-30`]  
**Warning signs:** transaction count changes after exact retry or duplicate logic exists only in a component.

### Pitfall 3: Reversal loopholes
**What goes wrong:** reversal-of-reversal or repeated reversal manufactures credit; reversing an already-spent credit drives the balance negative.  
**How to avoid:** reject reversal targets whose kind is `reversal`, reject any target ID already referenced by a reversal, compute exact negation, then run the same no-negative guard. [VERIFIED: `02-CONTEXT.md:21-25`]

### Pitfall 4: Filtered balance arithmetic
**What goes wrong:** statement rows show a balance derived only from visible filters.  
**How to avoid:** derive full-account running balances first; filter the completed statement rows afterward. [VERIFIED: `.planning/REQUIREMENTS.md:34,40-41`]

### Pitfall 5: Cross-customer/source-reference ambiguity
**What goes wrong:** the same reference is accepted once per customer, allowing one runtime identity to debit multiple accounts.  
**How to avoid:** treat `sourceReference` as store-global for usage; customer is part of its fingerprint, so reuse for a different customer is a conflict. This follows D-09's explicit comparison of customer among normalized fields. [VERIFIED: `02-CONTEXT.md:27-30`]

### Pitfall 6: Existing customer deletion leaves ledger orphans
**What goes wrong:** the current cascade knows only commercial/access/activity records. [VERIFIED: `src/data/local-storage-repository.ts:575-595`]  
**How to avoid:** extend the existing demo delete cascade to ledger and usage arrays in the same write; Phase 3 will replace destructive customer deletion with retained archival semantics. [VERIFIED: `.planning/REQUIREMENTS.md:46-51`]

## Code Examples

### Existing atomic repository mutation pattern

```typescript
// Source: src/data/local-storage-repository.ts:697-703
const result = applyCommercialTransition(store, input, occurredAt);
this.write(result.store);
return result.arrangement;
```

Phase 2 commands should return one complete next-store result from pure rules and call `write()` once. [VERIFIED: `src/data/local-storage-repository.ts:697-703`]

### Existing migration persistence guard

```typescript
// Source: src/data/local-storage-repository.ts:507-515
const parsed = JSON.parse(raw) as unknown;
const migrated = migrateStore(parsed);
if (JSON.stringify(migrated) !== raw) {
  this.storage.setItem(this.key, JSON.stringify(migrated));
}
return migrated;
```

The v3 migration must remain deterministic so this guard writes once and becomes a no-op on later reads. [VERIFIED: `src/data/local-storage-repository.ts:507-515`]

### Existing accessible confirmation pattern

```tsx
// Source: src/features/customers/pages/CustomersPage.tsx:361-378
<AlertDialogContent data-testid="delete-customer-dialog">
  <AlertDialogHeader>
    <AlertDialogTitle>Delete {customer.name}?</AlertDialogTitle>
    <AlertDialogDescription>...</AlertDialogDescription>
  </AlertDialogHeader>
  <AlertDialogFooter>
    <AlertDialogCancel>Cancel</AlertDialogCancel>
    <AlertDialogAction onClick={handleDelete}>Delete customer</AlertDialogAction>
  </AlertDialogFooter>
</AlertDialogContent>
```

Credit, adjustment, usage, and reversal confirmations should preserve this named-subject and explicit-consequence structure while showing the projected resulting token balance. [VERIFIED: `02-CONTEXT.md:21-30`; `src/features/customers/pages/CustomersPage.tsx:361-378`]

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Editable/stored prepaid balance | Balance projected from immutable signed entries | Every balance is explainable and corrections remain visible. [CITED: https://docs.moderntreasury.com/ledgers/docs/transaction-status-and-balances] |
| Mutate an incorrect transaction | Append a linked reversing transaction | Preserves historical evidence. [CITED: https://docs.moderntreasury.com/ledgers/docs/transaction-status-and-balances] |
| Retry protection by "already exists" UI checks | Stable idempotency identity + normalized payload comparison | Exact retry is safe; conflicting reuse is explicit. [CITED: https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html] |

**Deprecated in this phase:** `PrepaidCommercialArrangement.currency`, `balanceCents`, prepaid `formatUsd()` rendering, and any editable balance field. [VERIFIED: current definitions `src/domain/types.ts:98-115`; locked replacement `02-CONTEXT.md:16-19`]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Date-range filtering uses inclusive start and end boundaries. | Architecture Pattern 4 | Boundary rows could differ from user expectation; lock in unit tests and UI helper text. |

All other new behavior recommendations are direct consequences of locked Phase 2 decisions or existing repository conventions.

## Open Questions

1. **Legacy cents-to-token semantics**
   - What we know: the old record stores `balanceCents`, while Phase 2 requires token-only accounting and preservation of the displayed balance. [VERIFIED: `src/domain/types.ts:98-115`; `02-CONTEXT.md:16-19,38-40`]
   - What is unclear: no real cents-to-token exchange rate exists.
   - Recommendation: for this fictional local prototype only, carry the raw integer into a migration-sourced opening token credit, never describe it as conversion, and replace all prepaid USD labels. A production migration must require an explicit business conversion rule and is out of scope.

2. **Zero legacy balances**
   - What we know: D-15 asks for an opening credit transaction, while zero-value credits weaken the positive-credit invariant. [VERIFIED: `02-CONTEXT.md:38-40`]
   - Recommendation: create no transaction for a zero legacy value; a sum over no ledger entries correctly derives zero. Test this migration edge case.

No unresolved question blocks Phase 2 planning.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | all commands | ✓ | `v20.20.2` | — |
| npm | scripts | ✓ | `10.8.2` | — |
| Playwright CLI | E2E gate | ✓ | `1.63.0` | — |
| Playwright Chromium | E2E/visual gate | ✓ | cached at `/home/tanglab/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome` | — |

Versions and paths were verified read-only on the remote host on 2026-09-10. No external service or new package is required.

## Verification Strategy (phase-specific)

`.planning/config.json` explicitly sets `"nyquist_validation": false`; therefore no generated Nyquist validation wave is required. [VERIFIED: `.planning/config.json:20-29`] The phase still needs the following ordinary project gates because Phase 2 changes accounting invariants and principal UI flows.

### Existing Test Framework

| Property | Value |
|----------|-------|
| Unit/component | Vitest `^4.1.11` with jsdom and Testing Library. [VERIFIED: `package.json:71-76,87,92`] |
| Browser E2E | Playwright `^1.63.0`. [VERIFIED: `package.json:71`] |
| Quick rule/repository run | `npm test -- src/domain/ledger-rules.test.ts src/data/local-storage-repository.test.ts` |
| Full unit/component suite | `npm test` [VERIFIED: `package.json:94-102`] |
| Full browser suite | `npm run test:e2e` [VERIFIED: `package.json:94-102`] |

### Requirement-to-Test Map

| Requirements | Behavior | Test layer | Required coverage |
|--------------|----------|------------|-------------------|
| LEDG-02, LEDG-03 | signed kinds, derived balance, no stored counter | pure unit | positive/negative sums; empty ledger zero; invalid fractions/NaN/zero by kind |
| LEDG-01, SAFE-02 | named confirmation and resulting balance before credit | component + E2E | cancel no-op; confirm appends once; refresh preserves |
| LEDG-04 | required reason/reference | unit + component | whitespace rejection; visible error; no write |
| D-05 | full single reversal | pure unit + repository | exact negation; reversal-of-reversal rejected; second reversal rejected; negative-result rejection |
| USGE-01, USGE-02 | atomic usage/debit and source idempotency | pure unit + repository + E2E | exact retry same IDs/count/balance; conflicting retry error; missing customer/agent; insufficient balance leaves both arrays unchanged |
| LEDG-05 | chronological statement and row balances | pure unit + component | deterministic ties; newest-first display; result balance remains full-account under filters |
| USGE-03, USGE-04 | date/agent/type filters and per-agent totals | pure unit + component + E2E | combined filters, inclusive boundaries, empty result, reversed usage nets to zero |
| USGE-05 | threshold and low-balance badge | pure unit + component + E2E | `balance === threshold`, below, above; active prepaid only; customer list and profile |
| D-15 | v2→v3 migration | repository | all collections preserved; deterministic opening ID/reference; one-time reread; positive/zero legacy balances; corrupt payload fallback |

### Required New/Extended Test Files

- Add `src/domain/ledger-rules.test.ts` for exhaustive pure invariants.
- Extend `src/data/local-storage-repository.test.ts` for v2→v3 migration, atomic commands, cascades, and idempotency.
- Extend `src/features/customers/pages/CustomerProfilePage.test.tsx` for confirmed actions, statement, filters, and profile warning.
- Extend `src/features/customers/pages/CustomersPage.test.tsx` for restrained low-balance identification.
- Extend `e2e/console.spec.ts` with strict no-skip prepaid operator flows.

### Sampling and Gates

- Per domain task: focused Vitest files.
- Per vertical plan: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `git diff --check`.
- After a user-visible flow: add `npm run test:e2e`.
- Final phase gate: all commands above plus desktop/mobile visual inspection of Commercial and Activity states; no console errors and no horizontal overflow.

## Security Domain

Security enforcement is enabled at ASVS Level 1. [VERIFIED: `.planning/config.json:47-49`]

### Applicable ASVS Categories

| ASVS Category | Applies | Phase Control |
|---------------|---------|---------------|
| V2 Authentication | No new work | Cloudflare Access perimeter remains unchanged; backend auth is Phase 3. [VERIFIED: `AGENTS.md:15-18`; `.planning/ROADMAP.md:43-53`] |
| V3 Session Management | No new work | No session code changes in this phase. [VERIFIED: Phase boundary `02-CONTEXT.md:7-10`] |
| V4 Access Control | Deferred production control | Do not claim browser checks authorize financial mutations; Phase 3 owns server authorization. [CITED: https://owasp.org/www-project-application-security-verification-standard/] |
| V5 Input Validation | Yes | Positive whole-token checks, valid IDs/timestamps, required reason/reference, normalized idempotency fingerprint, and repository-side rejection. OWASP requires strongly typed, range-checked input. [CITED: https://wiki.owasp.org/images/d/d4/OWASP_Application_Security_Verification_Standard_4.0-en.pdf] |
| V6 Cryptography | No | No secrets, money movement, signatures, or cryptographic ledger are introduced. [VERIFIED: Phase boundary `02-CONTEXT.md:7-10,108-115`] |
| Client-side data protection | Yes, explicit prototype limitation | Keep only deterministic fictional data in localStorage; real financial/customer data is forbidden until Phase 3. OWASP warns against sensitive data in browser storage. [CITED: https://cornucopia.owasp.org/taxonomy/asvs-4.0.3/08-data-protection/02-client-side-data-protection] |

### Known Threat Patterns

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| localStorage tampering creates fabricated balance/history | Tampering | Treat this build as fictional prototype only; validate every read/mutation and do not represent it as production integrity. Durable tamper resistance is Phase 3. [VERIFIED: `AGENTS.md:17-18`; `02-CONTEXT.md:108-115`] |
| Duplicate usage creates double debit | Tampering | Global source-reference fingerprint and exact-replay no-op at repository boundary. [VERIFIED: `02-CONTEXT.md:27-30`] |
| Partial write creates debit without usage attribution | Tampering | Build both records in one next store and call `write()` once. [VERIFIED: `02-CONTEXT.md:92-95`] |
| Hidden balance-changing action | Repudiation | Named confirmation plus immutable reason/reference and resulting balance preview. [VERIFIED: `02-CONTEXT.md:21-30`] |

## Proposed Thin Tracer-First Decomposition

### Plan 02-01 — Token ledger foundation and visible credit tracer

- Upgrade domain/store to schema v3; add ledger/usage types, `warningThresholdTokens`, and pure balance/validation/statement primitives.
- Implement staged v1→v2→v3 migration with deterministic opening credit and no record loss.
- Extend seed data with one explainable prepaid token account.
- Add repository queries/command for derived prepaid snapshot and confirmed credit grant.
- Replace prepaid USD rendering in Commercial with token balance, threshold, low-state, and **Add credit** confirmation.
- Gate with pure migration/arithmetic tests, component test, full static/unit/build checks, and one credit E2E tracer.
- Covers LEDG-01, LEDG-02 foundation, LEDG-03, SAFE-02, and migration half of USGE-05.

### Plan 02-02 — Atomic usage, idempotency, adjustments, and reversals

- Add manual usage command that validates agent/customer/prepaid state, fingerprints `sourceReference`, guards balance, and atomically appends usage + debit.
- Add signed manual adjustment and full single reversal commands with reason/reference and no-negative guard.
- Add confirmed profile actions; actions exist only when an active prepaid arrangement is in force, while historical records remain readable.
- Extend deletion cascade for local-demo ledger/usage arrays.
- Gate exact retry, conflicting retry, insufficient balance, rollback/no-partial-write, reversal loopholes, and strict E2E confirmations.
- Covers LEDG-02, LEDG-04, USGE-01, USGE-02, SAFE-02.

### Plan 02-03 — Statement investigation and restrained low-balance visibility

- Render derived chronological account statement inside existing Activity tab, retaining existing commercial/access timeline.
- Add date, agent, and transaction-kind filters; show **Net tokens consumed** and per-agent rows, not charts.
- Add resulting balance/reference/reversal state per statement row.
- Add low-balance badge to prepaid profile and customer list without a dashboard or global alert.
- Finish component, E2E, responsive visual, migration regression, and full Phase 1+2 gates.
- Covers LEDG-05, USGE-03, USGE-04, USGE-05.

The decomposition intentionally keeps each plan visible and executable, as required by the project delivery constraint. [VERIFIED: `AGENTS.md:19`; `02-CONTEXT.md:42-45`]

## Sources

### Primary (HIGH confidence)
- `.planning/phases/02-prepaid-credit-and-usage-accounting/02-CONTEXT.md` — locked Phase 2 decisions and scope.
- `.planning/REQUIREMENTS.md` — canonical requirement text.
- `src/domain/types.ts` — current schema and prepaid discrete values.
- `src/data/local-storage-repository.ts` — repository contract, migration seam, storage key, and one-write patterns.
- `src/data/seed-data.ts` — deterministic seed identities and existing prepaid value.
- `src/features/customers/pages/CustomerProfilePage.tsx` and `CustomersPage.tsx` — current UI composition and confirmation pattern.
- `package.json` — installed stack and commands.

### Secondary (MEDIUM confidence)
- https://docs.moderntreasury.com/ledgers/docs/transaction-status-and-balances — immutability, reversal transactions, balance-conditioned writes.
- https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html — exact retry and parameter-mismatch semantics.
- https://owasp.org/www-project-application-security-verification-standard/ — ASVS scope and current stable standard.
- https://wiki.owasp.org/images/d/d4/OWASP_Application_Security_Verification_Standard_4.0-en.pdf — typed/range-checked validation guidance.
- https://cornucopia.owasp.org/taxonomy/asvs-4.0.3/08-data-protection/02-client-side-data-protection — client storage limitation.

### Tertiary (LOW confidence)
- None used for implementation decisions.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — read directly from current `package.json` and repository source.
- Architecture: HIGH — based on current code seams and locked CONTEXT decisions.
- Ledger/idempotency pattern: HIGH for locked product semantics; MEDIUM for external cross-checks.
- Migration edge cases: HIGH for current stored shape; MEDIUM for the one-for-one fictional carry-forward because no real conversion rule exists.
- Pitfalls: HIGH — derived from explicit invariants and current code paths.

**Research date:** 2026-09-10  
**Valid until:** 2026-10-10, or until the store schema/repository contract changes.
