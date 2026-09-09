# Hivarium Operator Console

## What This Is

Hivarium Operator Console is an internal administration system for managing the organizations that use Agenis/Hivarium services. It gives the operator one reliable place to understand each customer's commercial arrangement, granted agent products, account balance, usage, and contract lifecycle.

The current implementation is a protected browser-based prototype backed by deterministic local data. The project will evolve it into a trustworthy customer-operations console without turning it into a generic CRM, public customer portal, or full accounting suite.

## Core Value

The operator can understand and control each customer's commercial relationship, agent access, balance, and usage from one clear and dependable profile.

## Requirements

### Validated

- ✓ Operator can list, search, filter, view, create, and edit customers — existing
- ✓ Operator can delete a customer only after explicit confirmation, with related local records removed — existing
- ✓ Operator can inspect a customer's subscriptions, feature entitlements, and agent licenses — existing
- ✓ Operator can browse a meaningful read-only catalog of Hivarium agent products — existing
- ✓ Customer changes persist in deterministic browser localStorage for the presentation build — existing
- ✓ The deployed console supports SPA routing, crawler blocking, security headers, and Cloudflare Access logout — existing
- ✓ Component tests cover the principal customer, profile, catalog, and mutation screens — existing

### Active

- [ ] Represent monthly subscription, prepaid token-credit, and annual-contract customer arrangements explicitly
- [ ] Show the active commercial arrangement and its key dates on each customer profile
- [ ] Assign and revoke access to specific Hivarium agent products per customer
- [ ] Show which customers can access each agent product and under what entitlement
- [ ] Add token credit to a customer account through a confirmed operator action
- [ ] Record an append-only ledger of credit grants, usage debits, adjustments, and reversals
- [ ] Calculate the current token balance from ledger transactions rather than an editable counter
- [ ] Show total consumption and a filterable, auditable usage breakdown for token-based customers
- [ ] Track annual contract start, end, renewal status, and commercial notes
- [ ] Present renewal and low-balance conditions clearly without building a noisy analytics dashboard
- [ ] Preserve a polished, minimal, accessible operator experience across desktop and mobile navigation
- [ ] Replace browser-only financial persistence with a durable authenticated source of truth before real customer use

### Out of Scope

- Public customer signup, login, or self-service portal — this is an internal operator console
- Payment collection and card processing — commercial records are managed here, but money movement belongs to a dedicated provider
- Tax calculation, formal invoicing, and general-ledger accounting — this is not an ERP or accounting product
- Generic CRM features such as sales pipelines, email campaigns, and lead management — they do not serve the core value
- Multi-operator roles and fine-grained RBAC in the first milestone — Cloudflare Access currently limits the tool to one operator
- Live agent-runtime control, governance policy execution, or telemetry debugging — those belong to the Hivarium platform rather than this customer console
- Automatic usage ingestion before ledger semantics and idempotency rules are validated — avoid unreliable financial totals

## Context

- The application is a React 19, TypeScript, Vite, Tailwind, Radix, and TanStack Table SPA.
- `HiveRepository` provides a useful boundary between feature pages and the current `LocalStorageRepository`.
- Existing domain types cover customers, plan-tier subscriptions, feature entitlements, agent products, and licenses.
- The current subscription model assumes seats and plan tiers; it cannot accurately express the three required commercial models.
- The agent catalog currently contains six deterministic Hivarium products and is intentionally read-only.
- Customer profiles already aggregate overview, subscription, entitlement, and license data, making them the natural home for contracts, balances, and usage statements.
- Cloudflare Access protects `ops.hivarium.dev`; the application intentionally has no public login or signup page.
- The current local-only customer deletion commit and the codebase-map commit are ahead of `origin/main` and have not been pushed.
- The founder's priority is a focused tool that works reliably; complexity that does not directly support customer management should be deferred.

## Constraints

- **Product scope**: Remain an internal customer-operations console — prevents drift into CRM, ERP, or runtime-governance products
- **Security**: No public authentication surface; keep Cloudflare Access as the perimeter while adding server authorization before multi-user use — protects private operational data
- **Data integrity**: Balances must be derived from immutable transactions — mutable counters cannot support auditable usage or corrections
- **Persistence**: localStorage is acceptable only for deterministic demo flows — real customer and financial records require durable server-owned storage
- **Delivery**: Build vertical, visible slices that remain testable at every phase — the project should stay usable rather than waiting for all backend layers
- **UX**: Preserve the warm, minimal Hivarium visual system and accessible confirmation patterns — operators need clarity, not decorative dashboards
- **Deployment**: Maintain Cloudflare static SPA compatibility until a backend deployment is deliberately introduced

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Treat the console as an internal operator tool | Only the Hivarium operator manages customer commercial state | ✓ Good |
| Support monthly, token-credit, and annual-contract arrangements as first-class models | Customers consume the service under materially different commercial terms | — Pending |
| Derive token balances from an append-only ledger | Usage, adjustments, and reversals must remain explainable | — Pending |
| Keep the agent catalog separate from customer entitlements | Product definitions and customer access have different lifecycles | ✓ Good |
| Keep localStorage for deterministic demonstration only | It supports fast UI iteration but cannot be a production financial source of truth | ⚠️ Revisit before real data |
| Use Cloudflare Access instead of a public application login | The console is private and currently operated by one person | ✓ Good |
| Prefer vertical MVP phases | Each phase should deliver an observable operator capability without unnecessary infrastructure | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-09 after project initialization*
