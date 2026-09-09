# Requirements: Hivarium Operator Console

**Defined:** 2026-09-09
**Core Value:** The operator can understand and control each customer's commercial relationship, agent access, balance, and usage from one clear and dependable profile.

## Existing Baseline

Customer CRUD, confirmed local deletion, customer profiles, subscription/entitlement/license tabs, the read-only agent catalog, localStorage demo persistence, Cloudflare Access logout, security headers, and crawler blocking are already implemented and recorded as validated in `PROJECT.md`.

## v1 Requirements

### Commercial Models

- [ ] **COMM-01**: Operator can assign exactly one active commercial model—monthly subscription, prepaid tokens, or annual contract—to a customer
- [ ] **COMM-02**: Operator can record currency, recurring amount, billing cadence, next renewal date, and status for a monthly subscription customer
- [ ] **COMM-03**: Operator can record token-package terms and see the current derived credit balance for a prepaid customer
- [ ] **COMM-04**: Operator can record contract value, currency, start date, end date, renewal status, and notes for an annual-contract customer
- [ ] **COMM-05**: Operator can see a concise commercial summary and relevant upcoming date on the customer profile
- [ ] **COMM-06**: Operator can change a customer's commercial model without erasing the historical arrangement record

### Agent Access

- [ ] **AGNT-01**: Operator can grant a customer access to a specific catalog agent with effective and optional expiry dates
- [ ] **AGNT-02**: Operator can revoke future use of an agent without deleting the historical access record
- [ ] **AGNT-03**: Operator can see every agent a customer can currently use, including access status and commercial entitlement
- [ ] **AGNT-04**: Operator can open an agent catalog entry and see which customers currently have access to it

### Credit Ledger

- [ ] **LEDG-01**: Operator can add token credit to a prepaid customer account through an explicitly confirmed action
- [ ] **LEDG-02**: System records credit grants, usage debits, manual adjustments, and reversals as immutable ledger transactions
- [ ] **LEDG-03**: System calculates the current customer balance from ledger transactions rather than storing an editable balance counter
- [ ] **LEDG-04**: Operator can enter a reason or reference for every manual credit adjustment or reversal
- [ ] **LEDG-05**: Operator can view a chronological account statement showing transaction type, amount, resulting balance, timestamp, and reference

### Usage Accounting

- [ ] **USGE-01**: System can record a usage debit attributed to one customer, one agent product, a timestamp, token quantity, and unique source reference
- [ ] **USGE-02**: Duplicate usage events with the same source reference do not reduce the balance twice
- [ ] **USGE-03**: Operator can filter a customer's usage history by date range, agent product, and transaction type
- [ ] **USGE-04**: Operator can see total tokens consumed for a selected period and a breakdown by agent product
- [ ] **USGE-05**: Operator can clearly identify prepaid customers whose remaining balance is below a configurable warning threshold

### Operational Safety

- [ ] **SAFE-01**: Operator can archive a customer while retaining contracts, access history, ledger transactions, and usage records
- [ ] **SAFE-02**: Destructive or balance-changing actions require clear confirmation naming the affected customer and consequence
- [ ] **SAFE-03**: Real customer, contract, entitlement, and ledger records persist in durable server-owned storage rather than browser localStorage
- [ ] **SAFE-04**: Server-side authorization restricts all customer and financial mutations to an authenticated operator
- [ ] **SAFE-05**: System records an audit entry for commercial-model changes, agent-access changes, credit operations, and customer archival
- [ ] **SAFE-06**: Automated tests verify commercial-model validation, ledger arithmetic, idempotent usage, permissions, and principal operator flows

## v2 Requirements

### Automation and Scale

- **AUTO-01**: Trusted Hivarium runtime events automatically create usage transactions
- **AUTO-02**: Operator receives configurable low-balance and upcoming-renewal notifications
- **AUTO-03**: Operator can export customer statements and contract summaries
- **AUTO-04**: Operator can create, edit, version, and retire agent catalog products

### Team Operations

- **TEAM-01**: Multiple operators can use role-based permissions
- **TEAM-02**: Sensitive financial actions can require a second operator's approval
- **TEAM-03**: Operator can search and report across customers by revenue model, renewal window, balance, and agent product

## Out of Scope

| Feature | Reason |
|---------|--------|
| Public customer portal or signup | The product is an internal Hivarium operator console |
| Card processing or money movement | Use a dedicated payment provider if required later |
| Tax calculation and formal invoicing | This is not a general accounting or ERP system |
| Sales CRM and marketing automation | These workflows do not support the console's core value |
| Live runtime governance controls | Agent execution governance belongs to the Hivarium platform |
| Decorative analytics dashboard | Prioritize actionable customer, balance, contract, and access information |

## Traceability

Phase mappings are populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| COMM-01 through COMM-06 | Unmapped | Pending |
| AGNT-01 through AGNT-04 | Unmapped | Pending |
| LEDG-01 through LEDG-05 | Unmapped | Pending |
| USGE-01 through USGE-05 | Unmapped | Pending |
| SAFE-01 through SAFE-06 | Unmapped | Pending |

**Coverage:**
- v1 requirements: 26 total
- Mapped to phases: 0
- Unmapped: 26 ⚠️

---
*Requirements defined: 2026-09-09*
*Last updated: 2026-09-09 after initial definition*
