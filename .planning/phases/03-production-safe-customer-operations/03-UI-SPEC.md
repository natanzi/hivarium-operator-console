---
phase: 3
slug: production-safe-customer-operations
status: draft
shadcn_initialized: true
preset: new-york
created: 2026-09-11
---

# Phase 3 — UI Design Contract

> Visual and interaction contract for Production-Safe Customer Operations. This phase keeps the existing Hivarium Operator Console UI intact and changes what sits beneath it: durable D1 storage, per-request Cloudflare Access authorization, non-destructive archival, an immutable operator audit trail, and honest loading/error states. It does not redesign the shell, the customer list, the four-tab customer profile, the agent catalog, or any confirmation pattern.

---

## Experience Intent

An operator must be able to trust the console with real records: the data survives browser and device changes, every mutation is authorized server-side, destructive deletion is replaced by non-destructive archival, and every commercial-model change, agent-access change, credit operation, and archival is traceable to the operator who performed it and when.

The experience remains a quiet operational record. The console looks and behaves the way it did in Phases 1 and 2 — same tabs, same confirmations, same copy rhythm — with four deliberate additions: a `Signed in as {email}` identity line, an `Archive customer` action replacing `Delete`, an `Archived` lifecycle state with a read-only profile banner, and an `Operator audit trail` section inside the existing Activity tab. Loading and error states are honest but restrained, using the existing skeleton and toast language.

Phase 3 overrides Phase 2 only where the product previously deleted customers and where the data layer was synchronous. Token balances, statements, low-balance treatment, commercial cards, agent access, and all confirmation copy remain unchanged.

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn/ui, already initialized |
| Preset | `new-york`, confirmed by `components.json` |
| Component library | Existing Radix UI primitives through project-owned `src/components/ui` components |
| Icon library | Lucide React; icons supplement visible labels and never replace them for lifecycle or financial actions |
| Font | Inter with existing system fallbacks |
| Form stack | Existing React Hook Form + Zod patterns; repository/domain validation remains authoritative |

Reuse the existing Button, Badge, Card, Table/DataTable, Input, Label, Select, Sheet, AlertDialog, Tabs, Skeleton, Tooltip, and Sonner primitives. Add no package, component registry, chart library, payment widget, or parallel design system.

## Spacing Scale

Declared values are the existing 4/8-point rhythm:

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, identity metadata, audit-row metadata |
| sm | 8px | Inline controls, badges, audit-row spacing |
| md | 16px | Form groups, table cells, summary fields |
| lg | 24px | Card/sheet padding and section separation |
| xl | 32px | Major groups inside Commercial and Activity |
| 2xl | 48px | Rare desktop-only page separation |
| 3xl | 64px | Existing page-level breathing room only |

Exceptions: interactive controls are at least 36px high on desktop and 44px high on touch layouts. Audit table row height may grow to fit wrapped summaries; content must not be vertically clipped.

## Typography

Only four sizes and two weights are permitted on Phase 3 surfaces.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Metadata / label | 12px | 400 | 1.4 |
| Body / control | 14px | 400 | 1.5 |
| Section heading | 17px | 600 | 1.35 |
| Page heading / token balance | 24px | 600 | 1.2 |

Use weight 600 for headings, current balances, totals, and deliberate emphasis only. Timestamps, counts, and balances use tabular numerals. Operator emails and stable references use the existing monospace treatment at 12px. Always show the unit label `tokens`; never present an unlabeled integer as balance or usage.

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#F5F2EC` | Page background and negative space |
| Secondary (30%) | `#FCFBF8` with `#E3DCCC` borders | Cards, tables, sheets, dialogs, filters |
| Accent (10%) | `#9A4B23` with `#F2E0D3` soft state | Primary action, active tab/filter, focus ring |
| Healthy / sufficient | `#5F7158` with `#E4E9E0` | Active lifecycle state and successful results only |
| Caution / low balance | `#9C7C38` with `#F1E8D2` | `Low balance` badge, threshold boundary (unchanged) |
| Neutral / archived | `#6B6B6B` with `#ECEAE4` | `Archived` badge, archived banner, audit metadata |
| Destructive | `#B23A32` | Reserved for genuinely destructive confirmations only — archive is NOT destructive and never uses red |

Accent is reserved for primary actions and active state. Archived uses neutral/sage rather than red because the account remains valid and fully retained. Color never carries lifecycle or audit meaning without text.

## Information Architecture

### Customer list

Preserve the existing Customers page, summary strip, search, lifecycle filters, table ordering, and actions. Changes:

- The lifecycle filter gains an `Archived` option; archived customers are excluded from the default view.
- The summary strip's `Archived` count now counts the archived lifecycle status (it previously counted churned — correct it).
- Archived rows show a neutral `Archived` badge.
- The row action `Delete` becomes `Archive customer` with retention-preserving confirmation copy.

Do not add a new KPI card, global warning banner, extra dashboard route, or archive-only page.

### Customer profile

Keep exactly four top-level tabs: `Overview`, `Commercial`, `Agent Access`, and `Activity`.

- **Archived banner:** when the customer is archived, a neutral banner appears above the tabs: `This customer is archived. Records are retained and read-only.` All mutation actions are hidden; every tab remains readable.
- **Overview:** unchanged for active customers; archived customers show the banner and the `Archived` badge beside the lifecycle badge.
- **Commercial:** unchanged; no balance actions on archived customers.
- **Agent Access:** unchanged; read-only for archived customers.
- **Activity:** the token statement and commercial/access history remain; a new `Operator audit trail` section appears below them when audit entries exist.

### Operator identity

The sidebar (or top bar) shows `Signed in as {email}` near the existing Cloudflare Access logout link. When the API rejects the session (`401`), the console shows a restrained sign-in-required state instead of the working surface.

### Visual hierarchy

1. Customer identity and lifecycle state (including archived).
2. Current token balance and commercial summary (unchanged).
3. Immutable statement and operational history (unchanged).
4. Operator audit trail (who changed what and when).
5. Stable IDs, source references, and correction details (unchanged).

## Screen Contracts

### Archive flow

`Archive customer` opens an AlertDialog titled `Archive {customer.name}?`. The description states: `All contracts, agent-access history, ledger transactions, and usage records will be retained and remain available. The customer will leave the working list.` Actions are `Cancel` and `Archive customer`. The final action uses neutral/sage emphasis, not destructive red. Pending verb is `Archiving…` and disables double submission.

On success: the row leaves the default list, the toast announces `Customer archived` with `{customer.name} and all related records were retained.`, and opening the profile shows the archived banner with no mutation actions.

### Archived profile

A neutral banner above the tabs reads `This customer is archived. Records are retained and read-only.` The `Archived` badge appears beside the lifecycle badge in Overview. All mutation actions (commercial changes, agent access, credit/usage/adjustment/reversal, threshold, edit) are hidden. The token statement, commercial history, access history, and audit trail remain fully readable.

### Operator audit trail (Activity tab)

Below the token statement and `Commercial and access history`, a section headed `Operator audit trail` renders newest first. Its header shows the count of entries, e.g. `12 entries`. Rows expose:

| Column | Contract |
|--------|----------|
| When | Local date/time, tabular numerals |
| Operator | Verified operator email, monospace at 12px |
| Action | Human label plus semantic badge (e.g. `Credit grant`, `Usage debit`, `Manual adjustment`, `Reversal`, `Commercial change`, `Access granted`, `Access revoked`, `Customer archived`) |
| Subject | Arrangement/grant/transaction/customer reference |
| Summary | Concise human-readable before/after statement |

The section is read-only: there is no edit, delete, or export action. Audit rows never duplicate ledger rows or commercial/access activity events. Empty state reads `No operator audit entries yet` with body `Operator actions on this customer will appear here.`

### Sign-in required state

When `GET /api/me` (or any API call) returns `401`, the console renders a restrained centered state: `Sign in required` with body `This console requires a verified Cloudflare Access session.` and the existing Access logout/refresh link. No customer data is rendered in this state.

### Loading and error states

- **Loading:** existing skeleton components shaped like the list rows, profile summary, commercial card, statement, and audit rows. Never replace the whole profile with a spinner.
- **Error:** a restrained inline error state with `Unable to load {subject}` and a `Retry` action that re-runs the same repository read. Mutation failures keep entered values and show the server error message through the existing toast pattern.

## Interaction and Feedback

- Archive confirmation cannot be committed from the row alone; it always uses the AlertDialog.
- Pending archive button uses `Archiving…`; double submission is disabled.
- Successful archive refreshes the list projection and the profile state from the repository without a page reload.
- Audit rows are immutable: there is no Edit or Delete action.
- Operator emails are selectable/copyable text; truncation exposes the complete value through accessible text/title.
- Loading skeletons and error states update deterministically without animation. Reduced motion removes sheet translation and uses opacity only.
- Existing transitions remain 150–200ms.

## Responsive Contract

- **Desktop ≥1280px:** retain the existing sidebar and content width. The audit trail fits in the Activity tab with bounded horizontal scrolling.
- **Tablet 768–1279px:** audit columns wrap; the archived banner and identity line remain above the fold.
- **Mobile <768px:** existing mobile sidebar behavior remains. The audit trail uses bounded horizontal scrolling with When/Operator/Action visible first; no page-level horizontal overflow. Archive confirmations fit vertically by allowing dialog content to scroll while footer actions remain reachable.
- At 390×844, the customer name, lifecycle badge (including `Archived`), and the relevant primary action must be visible without horizontal scrolling.

## Accessibility Contract

- Meet WCAG 2.2 AA contrast for text, focus rings, status badges, and actions.
- The archived banner is a semantic region with a heading; its text is announced on profile load.
- Archive confirmation names the customer and states the retention consequence; focus is trapped and restored by existing Radix primitives.
- Audit rows have semantic column headers and a caption `Operator audit trail for {customer}`.
- The identity line has an accessible name (`Signed in as {email}`); the sign-in-required state uses a heading and a link.
- Validation messages are programmatically associated with fields. Toasts use a polite live region; failed or blocked mutations use assertive messaging and retain form values.
- Minimum target height is 36px desktop and 44px touch. Icon-only lifecycle controls are forbidden.

## Copywriting Contract

| Element | Copy |
|---------|------|
| Row action | `Archive customer` |
| Archive confirmation | `Archive {customer.name}?` / `Archive customer` |
| Archive consequence | `All contracts, agent-access history, ledger transactions, and usage records will be retained and remain available. The customer will leave the working list.` |
| Archive pending | `Archiving…` |
| Archive success toast | `Customer archived` / `{customer.name} and all related records were retained.` |
| Archived banner | `This customer is archived. Records are retained and read-only.` |
| Audit section heading | `Operator audit trail` |
| Audit caption | `Operator audit trail for {customer}` |
| Audit empty heading | `No operator audit entries yet` |
| Audit empty body | `Operator actions on this customer will appear here.` |
| Identity line | `Signed in as {email}` |
| Sign-in required heading | `Sign in required` |
| Sign-in required body | `This console requires a verified Cloudflare Access session.` |
| Load error heading | `Unable to load {subject}` |
| Load error action | `Retry` |
| Generic save error | `The change was not saved. Review the highlighted fields and try again.` |

Use `archive`, `retained`, `read-only`, `audit`, and `operator`. Do not use `delete`, `remove permanently`, `payment`, `invoice`, `refund`, or currency symbols on any Phase 3 surface.

## State Contract

- **Loading:** skeletons shaped like the list rows, profile summary, commercial card, statement, and audit rows. Never a full-page spinner.
- **Populated:** archived banner (when archived) precedes the tabs; audit trail follows the statement and commercial/access history; identity line is visible.
- **Empty audit:** render the exact empty-audit copy; the section header remains.
- **Archived:** banner + `Archived` badge; all mutation actions hidden; every tab readable; list excludes the customer by default.
- **Unauthenticated:** `401` renders the sign-in-required state; no customer data is shown.
- **Error:** last readable data and entered values remain visible; the load-error state offers `Retry`; mutation failures show the specific server message.
- **Overflow:** tables use bounded horizontal scrolling; long summaries wrap to two lines; emails/references truncate visually with full accessible text; page-level overflow is forbidden.
- **Zero / one / many:** audit counts remain grammatically correct (`1 entry`, `{N} entries`).

## UI Considerations

Applicable state considerations resolved: 8 categories covered, 0 backstop, 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | Audit trail, archived list filter, sign-in-required | ✅ covered | Distinct documented copy for empty audit, empty archived filter, and unauthenticated state. |
| loading | List, profile, statement, audit, identity | ✅ covered | Skeletons match final geometry; pending archive retains action context and disables repeat submission. |
| error | Loads, mutations, identity | ✅ covered | Last valid data and entered values remain visible; `Retry` re-runs the same read; server messages map to toast copy. |
| populated | Archived banner, audit trail, identity | ✅ covered | Banner precedes tabs; audit rows newest first; identity line always visible when authenticated. |
| partial | Archived customers with historical records | ✅ covered | Archived profile keeps every tab readable; mutation actions hidden; `Not recorded` convention preserved. |
| overflow | Audit table, summaries, emails, references | ✅ covered | Bounded horizontal scroll, two-line wrapping, accessible full values, no page-level overflow. |
| zero-one-many | Audit entries, archived rows | ✅ covered | `1 entry` / `{N} entries`; archived filter empty state explicit. |
| long-text | Operator emails, audit summaries, confirmation copy | ✅ covered | Meaningful prose wraps; stable references may truncate visually but expose full accessible content. |

## Objective Acceptance Criteria

1. The console renders the same four-tab profile, list, catalog, and confirmation surfaces as Phase 2; no redesign, no new top-level route, no fifth tab.
2. `Archive customer` replaces `Delete`; the confirmation names the customer and states that all records are retained; no destructive red is used.
3. After archiving, the customer leaves the default list, appears under the `Archived` lifecycle filter, and its profile shows the archived banner with all mutation actions hidden while every tab remains readable.
4. Contracts, agent-access history, ledger transactions, and usage records remain available on an archived customer's profile.
5. The Activity tab shows `Operator audit trail` rows (When, Operator, Action, Subject, Summary) newest first for every commercial-model change, agent-access change, credit operation, and archival; rows are read-only.
6. The sidebar shows `Signed in as {email}`; a `401` renders the sign-in-required state with no customer data.
7. Loading uses existing skeleton shapes; load errors offer `Retry`; mutation failures retain entered values and show the server message.
8. The summary strip's `Archived` count reflects the archived lifecycle status, not churned.
9. At 1920×1080 and 1280×800, the page preserves the existing restrained layout. At 390×844, no page-level horizontal overflow occurs and archive confirmations remain operable.
10. Keyboard-only operation can archive a customer, read the audit trail, and reach the identity line; every field/error/transaction state has an accessible name.
11. No payment, invoice, tax, generic-CRUD, or public-login surface is introduced; the SPA dependency tree does not grow.

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official / existing local components | Existing Button, Badge, Card, Table/DataTable, Input, Label, Select, Sheet, AlertDialog, Tabs, Skeleton, Tooltip, and Sonner components only | PASS — existing project-owned components; no registry fetch |
| Third-party registries | None | Not applicable |

## Implementation Guardrails

- Do not redesign the shell, list, profile tabs, agent catalog, or confirmation patterns; do not add new top-level routes or a fifth profile tab.
- Do not build a generic CRUD UI, a public login surface, or any payment/invoice/tax surface.
- Do not hard-delete customers; archive retains every dependent record.
- Do not store or display an editable balance; balances remain derived from immutable ledger rows.
- Do not duplicate ledger events into `ActivityEvent` or audit rows into the commercial/access timeline.
- Do not place authorization, ledger arithmetic, or audit writing in React components; the Worker is authoritative.
- Do not add charts, KPI-card grids, global banners, or decorative analytics.
- Do not grow the SPA dependency tree; Worker-side additions are limited to what the D1/JWT integration requires.

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending