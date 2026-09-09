# Phase 1: Customer Commercial Control — Context

**Gathered:** 2026-09-09  
**Status:** Ready for UI specification and implementation planning

## Phase Boundary

Phase 1 gives a Hivarium operator one reliable place to represent each customer's commercial relationship and control which catalog agents that customer may use. It does not implement the prepaid ledger, detailed usage accounting, invoicing, payment processing, or production backend durability; those remain in later roadmap phases.

## Product Decisions

### Commercial arrangements

- A customer has exactly one active commercial arrangement at a time.
- Supported arrangements are monthly subscription, prepaid usage, and annual contract.
- An arrangement change may take effect immediately or on an explicit future date.
- Replacing an arrangement never destroys the previous record; prior arrangements remain visible as history.
- Currency is USD for this milestone.
- A monthly subscription has a fixed recurring monthly amount.
- A prepaid arrangement uses a monetary balance denominated in USD. Future usage debits reduce that balance; the detailed ledger is Phase 2.
- An annual contract stores its term, included allowance, and overage rate. Detailed usage and overage calculation are Phase 2.
- The UI must show the active arrangement, relevant amount or balance, effective dates, and the next renewal, expiry, or contract-end date.
- When an arrangement ends, expires, or is terminated, all current agent access grants are revoked automatically.
- Starting a new arrangement does not silently restore previously revoked agent access.

### Agent access

- Access is granted to an agent product, not to an individual agent version.
- A grant requires a start date and may have an optional end date.
- Revocation may be immediate or scheduled for an explicit future date.
- Grant and revocation history is retained; access records are not hard-deleted.
- Current access is visible from the customer profile.
- The reverse relationship is visible from an agent detail surface: operators can see which customers currently have access.
- Human-readable agent names and stable identifiers must remain distinct in the UI and data model.

### Customer profile experience

- Use four focused tabs: `Overview`, `Commercial`, `Agent Access`, and `Activity`.
- `Overview` summarizes the current lifecycle, active commercial model, important date, current agent count, and the most important operator action.
- `Commercial` shows the active arrangement first and preserves prior arrangements in a compact history below it.
- `Agent Access` shows current grants first and historical or scheduled changes separately.
- `Activity` is a chronological audit-style timeline combining commercial and access changes.
- Creation and editing flows should use focused drawers where practical so operators retain customer context.
- Destructive or high-impact actions require an explicit confirmation dialog naming the affected customer or agent.
- Avoid decorative charts, generic KPI dashboards, and duplicated summary cards. The experience should remain minimal, operational, and easy to scan.

## Data and Behavior Constraints

- Preserve the repository abstraction and browser `localStorage` implementation for this milestone.
- Keep deterministic seeded demo data and migrate it without dropping existing locally stored customer records.
- Commercial history and access history must be represented as typed domain records rather than inferred from UI labels.
- Effective and scheduled changes must be deterministic and testable; no timer-based UI behavior is required.
- Automatic access revocation caused by arrangement termination must create auditable history entries.
- Phase 1 may display prepaid balance and annual allowance fields, but it must not pretend that a detailed usage ledger already exists.

## Existing Code to Reuse

- Extend the domain model in `src/domain/types.ts` instead of creating parallel page-only types.
- Evolve `src/data/local-storage-repository.ts` and its repository context so all writes continue through the existing data boundary.
- Update deterministic fixtures in `src/data/seed-data.ts` and add backward-compatible migration/defaulting for persisted records.
- Build on the existing customer list, create/edit flows, customer profile tabs, and read-only agent catalog.
- Preserve existing confirmation-dialog and toast conventions used by customer deletion.

## Verification Expectations

- Unit-test arrangement validation, effective-date transitions, history preservation, and automatic access revocation.
- Component-test the customer profile summary, commercial history, agent grants, reverse agent-to-customer view, and confirmation flows.
- Add focused end-to-end coverage for creating each commercial model, scheduling a model change, granting/revoking agent access, and verifying the relationship from both directions.
- Existing customer CRUD, deletion confirmation, navigation, build, typecheck, and lint behavior must remain green.

## Deferred to Later Phases

- Token/credit top-ups, immutable debit and adjustment ledger, low-balance rules, and detailed usage records.
- Invoice generation, payment collection, tax handling, revenue recognition, and external billing-provider integration.
- Production database, authentication/authorization expansion, server-side audit retention, concurrency, backup, and recovery.
- Automatic restoration of old agent grants after a customer starts a new arrangement.

## Planning Discretion

- Exact component names, drawer widths, field grouping, and responsive breakpoints may follow established project conventions.
- The implementation plan may split domain migration, commercial UI, and agent-access UI into separate atomic plans as long as the phase remains one coherent vertical slice.
