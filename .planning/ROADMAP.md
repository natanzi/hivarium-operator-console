# Roadmap: Hivarium Operator Console

**Project mode:** MVP
**Granularity:** Coarse
**Core value:** The operator can understand and control each customer's commercial relationship, agent access, balance, and usage from one clear and dependable profile.

## Phases

- [x] **Phase 1: Customer Commercial Control** - Manage each customer's commercial arrangement and agent access from one coherent profile.
- [x] **Phase 2: Prepaid Credit and Usage Accounting** - Operate prepaid accounts through an explainable ledger and auditable usage statement.
- [ ] **Phase 3: Production-Safe Customer Operations** - Preserve the completed workflows in durable, authorized, auditable storage.

## Phase Details

### Phase 1: Customer Commercial Control
**Goal**: Operators can accurately represent a customer's commercial relationship and control which Hivarium agents that customer may use.
**Mode:** mvp
**Depends on**: Nothing (builds on the validated customer-management baseline)
**Requirements**: COMM-01, COMM-02, COMM-03, COMM-04, COMM-05, COMM-06, AGNT-01, AGNT-02, AGNT-03, AGNT-04
**Success Criteria** (what must be TRUE):
  1. Operator can assign monthly subscription, prepaid tokens, or annual contract as the customer's single active model and enter the fields appropriate to that model.
  2. Customer profile clearly shows the active arrangement, its most relevant amount or balance, and the next renewal, expiry, or contract date.
  3. Changing a customer's commercial model leaves the previous arrangement visible as historical information.
  4. Operator can grant or revoke dated access to catalog agents and see current access from both the customer profile and agent detail view.
**Plans**: 3/3 complete (01-01, 01-02, 01-03)
**Verification**: `.planning/phases/01-customer-commercial-control/VERIFICATION.md`
**UI hint:** yes

### Phase 2: Prepaid Credit and Usage Accounting
**Goal**: Operators can charge and investigate prepaid customer usage without relying on an editable balance or unexplained totals.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: LEDG-01, LEDG-02, LEDG-03, LEDG-04, LEDG-05, USGE-01, USGE-02, USGE-03, USGE-04, USGE-05, SAFE-02
**Success Criteria** (what must be TRUE):
  1. Operator can confirm a named-customer credit action and immediately see the balance derived from immutable transactions.
  2. Credit grants, usage debits, adjustments, and reversals appear chronologically with resulting balance, timestamp, reason, and source reference.
  3. Replaying a usage event with the same source reference does not debit the customer twice.
  4. Operator can filter usage by period, agent, and transaction type, then see period consumption and an agent-by-agent breakdown.
  5. A prepaid account below its configured threshold is clearly identifiable without a noisy analytics dashboard.
**Plans**: 3/3 complete (02-01, 02-02, 02-03)
- **02-01 — Ledger foundation and credit tracer**: Prove the Phase 2 accounting architecture end to end with one visible credit tracer: schema v3, an immutable token ledger, a derived balance, a deterministic opening-credit migration, and a confirmed Add token credit workflow with restrained low-balance visibility.
- **02-02 — Usage and correction accounting**: Prove the Phase 2 usage and correction accounting end to end: atomic usage debits with source-reference idempotency and conflict detection, insufficient-credit rejection, manual adjustments, and single full reversals, all behind named-customer confirmations and integrated into the Activity experience.
- **02-03 — Statement and investigation experience**: Prove the Phase 2 statement and investigation experience end to end: a chronological token account statement with full-account running balances, date/agent/type filters, selected-period consumption totals, and a compact per-agent breakdown, embedded at the top of the existing Activity tab, plus the full regression and desktop/mobile visual verification that closes the phase.
**Verification**: `.planning/phases/02-prepaid-credit-and-usage-accounting/VERIFICATION.md`
**UI hint:** yes

### Phase 3: Production-Safe Customer Operations
**Goal**: Operators can use the completed customer workflows with real records that remain durable, authorized, retained, and auditable.
**Mode:** mvp
**Depends on**: Phase 1, Phase 2
**Requirements**: SAFE-01, SAFE-03, SAFE-04, SAFE-05, SAFE-06
**Success Criteria** (what must be TRUE):
  1. Operator can archive a customer while contracts, agent-access history, ledger entries, and usage records remain available.
  2. Customer and financial records survive browser/device changes because the application uses durable server-owned storage rather than localStorage.
  3. An unauthenticated or unauthorized request cannot perform customer, entitlement, contract, or financial mutations.
  4. Operator can trace who changed a commercial model, agent access, credit balance, or customer lifecycle and when it happened.
  5. Automated verification catches invalid commercial models, incorrect ledger arithmetic, duplicate usage debits, permission failures, and broken principal UI flows.
**Plans**: TBD
**UI hint:** yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Customer Commercial Control | 3/3 | Complete | 2026-09-10 |
| 2. Prepaid Credit and Usage Accounting | 3/3 | Complete | 2026-09-11 |
| 3. Production-Safe Customer Operations | 0/TBD | Planned | - |

## Coverage

- v1 requirements: 26
- Mapped exactly once: 26
- Unmapped: 0
- Duplicate mappings: 0

---
*Roadmap created: 2026-09-09*
