---
phase: 2
slug: prepaid-credit-and-usage-accounting
status: draft
shadcn_initialized: true
preset: new-york
created: 2026-09-10
---

# Phase 2 — UI Design Contract

> Visual and interaction contract for Prepaid Credit and Usage Accounting. This phase extends the existing Hivarium Operator Console; it does not redesign the application shell, customer list, or four-tab customer profile.

---

## Experience Intent

An operator must be able to answer three questions from one customer profile without mental arithmetic: how many Hivarium tokens remain, what changed that balance, and which agent consumed the tokens. Every balance-changing action must name the customer, preview the resulting balance, and leave an immutable statement entry.

The experience remains a quiet operational record. The current token balance is the focal value for an active prepaid customer; the ledger is the evidence beneath it. Low balance is visible but restrained. Charts, global billing dashboards, payment language, invoice controls, and decorative analytics are excluded.

Phase 2 overrides Phase 1 only where prepaid balances were shown as USD. Prepaid values are now whole Hivarium tokens everywhere. Monthly and annual-contract presentation, the four profile tabs, agent-access workflows, and commercial/access activity remain unchanged.

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn/ui, already initialized |
| Preset | `new-york`, confirmed by `components.json` and `npx shadcn info` on 2026-09-10 |
| Component library | Existing Radix UI primitives through project-owned `src/components/ui` components |
| Icon library | Lucide React; icons supplement visible labels and never replace them for financial actions |
| Font | Inter with existing system fallbacks |
| Form stack | Existing React Hook Form + Zod patterns; repository/domain validation remains authoritative |

Reuse the existing Button, Badge, Card, Table/DataTable, Input, Label, Select, Sheet, AlertDialog, Tabs, Skeleton, Tooltip, and Sonner primitives. Add no package, component registry, chart library, payment widget, or parallel token system.

## Spacing Scale

Declared values are the existing 4/8-point rhythm:

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, sign/value grouping, compact metadata |
| sm | 8px | Inline controls, badges, statement-row metadata |
| md | 16px | Form groups, table cells, summary fields |
| lg | 24px | Card/sheet padding and section separation |
| xl | 32px | Major groups inside Commercial and Activity |
| 2xl | 48px | Rare desktop-only page separation |
| 3xl | 64px | Existing page-level breathing room only |

Exceptions: interactive controls are at least 36px high on desktop and 44px high on touch layouts. Statement table row height may grow to fit wrapped references; content must not be vertically clipped.

## Typography

Only four sizes and two weights are permitted on Phase 2 surfaces.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Metadata / label | 12px | 400 | 1.4 |
| Body / control | 14px | 400 | 1.5 |
| Section heading | 17px | 600 | 1.35 |
| Page heading / token balance | 24px | 600 | 1.2 |

Use weight 600 for headings, current balances, totals, and deliberate emphasis only. Token amounts, resulting balances, thresholds, dates, and counts use tabular numerals. Transaction IDs and source references use the existing monospace treatment at 12px. Always show the unit label `tokens`; never present an unlabeled integer as balance or usage.

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#F5F2EC` | Page background and negative space |
| Secondary (30%) | `#FCFBF8` with `#E3DCCC` borders | Cards, statement table, sheets, dialogs, filters |
| Accent (10%) | `#9A4B23` with `#F2E0D3` soft state | Primary balance action, active tab/filter, focus ring, selected transaction only |
| Healthy / sufficient | `#5F7158` with `#E4E9E0` | Sufficient prepaid balance and successful credit result only |
| Caution / low balance | `#9C7C38` with `#F1E8D2` | `Low balance` badge, threshold boundary, caution callout |
| Destructive | `#B23A32` | Negative adjustment/reversal confirmation, insufficient-balance failure, destructive action only |

Accent is reserved for `Add credit`, active navigation/tab/filter state, selected ledger item, and keyboard focus. Low balance uses gold/caution rather than red because the account remains valid. Color never carries balance state or transaction sign without text and `+`/`−` notation.

## Information Architecture

### Customer list

Preserve the existing Customers page, summary strip, search, lifecycle filters, table ordering, and actions. For an active prepaid customer only, add compact account state within the existing commercial/subscription cell or immediately beneath the organization metadata:

- derived balance formatted as `{N} tokens`;
- `Low balance` badge only when balance is less than or equal to the configured threshold;
- accessible text includes both balance and threshold, for example `Low balance: 80 tokens remaining; warning threshold 100 tokens`.

Do not add a new KPI card, global warning banner, extra dashboard route, or low-balance-only page.

### Customer profile

Keep exactly four top-level tabs: `Overview`, `Commercial`, `Agent Access`, and `Activity`.

- **Overview:** retain the existing summary band. For active prepaid arrangements, `Commercial value` becomes the derived `{N} tokens` balance and the low-balance badge appears next to the prepaid model badge.
- **Commercial:** active prepaid account card shows balance, threshold, effective/expiry data, and safe account actions. Monthly and annual cards do not expose token actions.
- **Agent Access:** unchanged.
- **Activity:** account statement and usage investigation appear first when the customer has prepaid ledger history; existing commercial/access timeline remains a separate section below it. The page does not introduce a fifth top-level tab.

### Visual hierarchy

1. Customer identity and current token balance.
2. Balance state, threshold, and the single primary action `Add credit`.
3. Selected-period consumption and agent breakdown.
4. Immutable transaction statement and existing operational history.
5. Stable IDs, source references, and correction details.

## Screen Contracts

### Active prepaid summary in Overview

The existing summary band remains one restrained bordered surface. For an active prepaid arrangement:

- `Commercial value` displays the derived balance, such as `2,480 tokens`;
- a visually separate metadata line states `Warning at 100 tokens or below`;
- `Low balance` appears beside the `Prepaid` badge only at or below the threshold;
- the existing commercial-model action remains `Change commercial model`; balance operations are not duplicated into Overview.

For non-prepaid customers, Overview is unchanged. Historical prepaid ledger data does not make a currently monthly or annual customer appear low-balance.

### Commercial tab — prepaid account card

The current prepaid arrangement remains a single document-style card, not a grid of KPI cards. Its first row contains `Prepaid`, active status, and optional `Low balance`. The focal amount is the derived balance at 24px/600 with explicit unit, followed by:

- `Warning threshold` — `{N} tokens`;
- `Effective` — localized date;
- `Expires` — localized date or `No expiry`;
- `Balance source` — `Derived from {N} immutable transactions`.

Actions are ordered:

1. `Add credit` — primary terracotta action.
2. `Adjust balance` — outline action.
3. `Edit threshold` — ghost/outline action.
4. Existing `Change commercial model` and `Terminate arrangement` remain visually subordinate.

Do not show an editable balance field. Changing the warning threshold edits arrangement configuration; it does not create a ledger transaction. The threshold field accepts a non-negative whole-token value and defaults to 100 for new/migrated prepaid arrangements.

### Add-credit flow

Open a focused right-side sheet (520px maximum on desktop; full width below 768px). Keep the customer profile visible behind it.

Fields, in visual order:

1. read-only customer name;
2. current derived balance;
3. `Tokens to add` — required positive whole number;
4. `Reference` — required, trimmed, human-readable source/reference;
5. `Reason` — optional concise note.

The sheet computes and displays `Resulting balance` before submission. Primary sheet CTA is `Review credit`; secondary is `Discard credit draft`.

`Review credit` opens an AlertDialog titled `Add {N} tokens to {customer}?`. Its description states `The balance will change from {current} tokens to {resulting} tokens. A credit grant will be added to the immutable account statement.` Actions are `Edit credit` and `Add token credit`. The final action is enabled only when the form is valid. Success closes both surfaces, refreshes the balance/statement, restores focus to `Add credit`, and announces `Token credit added` with `{customer} now has {resulting} tokens.`

### Manual-adjustment flow

Use the same sheet → confirmation pattern. Fields are:

- `Adjustment direction`: `Add tokens` or `Remove tokens`;
- `Token amount`: positive whole number;
- `Reference`: required;
- `Reason`: required;
- current and resulting balance.

Primary sheet CTA is `Review adjustment`; secondary is `Discard adjustment draft`. Confirmation title is `Adjust {customer}'s balance?`; body states the signed amount and resulting balance. Actions are `Edit adjustment` and `Apply balance adjustment`. Removing tokens uses destructive emphasis only in the confirmation action. An adjustment that would produce a negative balance is blocked before confirmation.

### Record-usage flow

Place `Record usage` as the secondary action in the Activity account-statement header. Show it only when an active prepaid arrangement exists.

Open the standard 520px sheet with:

1. read-only customer and available balance;
2. `Agent product` select containing only catalog agents the customer may currently use;
3. `Tokens consumed` positive whole number;
4. `Occurred at` date/time;
5. `Source reference` required and whitespace-trimmed.

Display the projected resulting balance. Primary sheet CTA is `Review usage`; secondary is `Discard usage draft`. Confirmation title is `Record {N} tokens of usage for {customer}?`; body names the agent, source reference, current balance, and resulting balance. Actions are `Edit usage` and `Record usage debit`.

Exact resubmission of an existing identical source reference performs no write and announces `Usage already recorded` with `No additional tokens were deducted.` Conflicting reuse retains entered values and shows the source-reference conflict message defined below.

### Activity tab — prepaid account statement

When prepaid ledger history exists, the first section is headed `Token account statement`. Its header shows the current full-account balance and, only for active prepaid accounts, `Record usage`.

Directly below, place one compact filter row:

- `From` date;
- `To` date;
- `Agent` select with `All agents`;
- `Transaction type` select with `All transaction types`, `Credit grant`, `Usage debit`, `Manual adjustment`, and `Reversal`;
- `Clear filters` text/ghost action, enabled only when a filter is active.

Date boundaries are inclusive. Invalid ranges show `From date must be on or before To date` and do not alter the last valid result.

Under the filters, show one restrained selected-period summary band:

- `Net tokens consumed` as the primary value;
- compact per-agent rows `{Agent name} — {N} tokens` ordered highest consumption first, ties by agent name;
- no chart, sparkline, percentage ring, or KPI-card grid.

The statement is newest first and uses the existing semantic table pattern. Columns:

| Column | Contract |
|--------|----------|
| Date | Local date/time, tabular numerals |
| Type | Human label plus semantic badge |
| Agent / detail | Agent name for usage; concise reason for other kinds |
| Amount | Explicit `+` or `−`, whole tokens, tabular numerals |
| Resulting balance | Full-account balance after this transaction, never a filtered subtotal |
| Reference | Monospace; wrap once then truncate with full accessible value |
| Actions | `Reverse transaction` only for eligible, unreversed transactions |

A reversed original row remains visible and receives a neutral `Reversed` badge with a link/reference to its reversal. The reversal row displays the original transaction reference. Existing commercial/access activity follows under `Commercial and access history`; do not duplicate ledger events into that timeline.

### Reversal flow

`Reverse transaction` opens a compact form sheet/dialog collecting required `Reference` and `Reason`, while showing the immutable original transaction and projected resulting balance. Its secondary action is `Discard reversal draft`. The final AlertDialog is titled `Reverse this transaction for {customer}?` and states the original signed amount, exact reversing amount, resulting balance, and `The original record will remain visible.` Actions are `Edit reversal` and `Reverse transaction`.

The destructive confirmation action uses red. A reversal of a reversal, a second reversal, or a reversal that would make the balance negative is unavailable. The UI shows the precise reason rather than silently hiding ledger history.

### Low-balance treatment

Low balance is defined exactly as `derived balance <= warning threshold`. Use one gold-outline badge with the visible text `Low balance` in:

- active prepaid customer row;
- active prepaid Overview summary;
- active prepaid Commercial card.

Never use a full-width red banner, toast on page load, global notification counter, or animated warning. At exactly the threshold, the badge must appear. Above it, no low-balance badge appears.

## Interaction and Feedback

- Account action sheets preserve the customer page behind them; closing returns focus to the invoking control.
- A dirty sheet asks the action-specific question `Discard credit draft?`, `Discard adjustment draft?`, `Discard usage draft?`, or `Discard reversal draft?` only after a field differs from its initial value. Actions are `Continue editing` and the matching `Discard {action} draft` label.
- Final balance mutations use AlertDialog and cannot be committed from the sheet alone.
- Pending buttons use action-specific copy: `Adding credit…`, `Applying adjustment…`, `Recording usage…`, or `Reversing transaction…`; double submission is disabled.
- Successful mutation refreshes Commercial, Activity, Overview, and customer-list projections from the repository without a page reload.
- Transaction rows are immutable: there is no Edit or Delete action.
- Source references are selectable/copyable text; truncation exposes the complete value through accessible text/title.
- Filters update deterministically without animation. Clearing filters restores the full statement and full selected-period range.
- Existing transitions remain 150–200ms. Reduced motion removes sheet translation and uses opacity only.

## Responsive Contract

- **Desktop ≥1280px:** retain the existing sidebar and content width. Commercial account details fit in one card. Activity filters use one wrapping row. Statement table scrolls only within its bounded container.
- **Tablet 768–1279px:** filters wrap to two rows; account summary remains above the table; sheets remain right-aligned and no wider than 520px.
- **Mobile <768px:** existing mobile sidebar behavior remains. Account sheets become full-width. Confirmation actions stack with the flow-specific `Edit credit`, `Edit adjustment`, `Edit usage`, or `Edit reversal` action above the destructive/final action in reading order. Draft sheets expose the matching `Discard {action} draft` label. Filters become a single-column labeled form. Selected-period agent breakdown becomes stacked rows. The statement uses bounded horizontal scrolling with Date/Type/Amount visible first; no page-level horizontal overflow.
- At 390×844, the customer name, token balance, low-balance badge, and the relevant primary action must be visible without horizontal scrolling. Every balance-changing confirmation must fit vertically by allowing dialog content to scroll while footer actions remain reachable.

## Accessibility Contract

- Meet WCAG 2.2 AA contrast for text, focus rings, status badges, and destructive actions.
- All fields have persistent visible labels; placeholders are examples only.
- Token inputs use numeric input semantics but validate finite positive/non-zero whole tokens in the form and repository.
- Signed values have screen-reader text equivalent to `credit {N} tokens` or `debit {N} tokens`; meaning is not conveyed only by color or punctuation.
- Low-balance badges expose balance and threshold in their accessible description.
- Dialog titles name the customer; descriptions state current and resulting balances. Focus is trapped and restored by existing Radix primitives.
- Validation messages are programmatically associated with fields. If multiple fields fail, focus moves to the first invalid field and an assertive summary announces the count.
- Statement table has a caption `Token account statement for {customer}` and semantic column headers. Sort is fixed newest-first unless a later phase explicitly adds sorting.
- Toasts use a polite live region; failed or blocked balance actions use assertive messaging and retain form values.
- Minimum target height is 36px desktop and 44px touch. Icon-only financial controls are forbidden.

## Copywriting Contract

| Element | Copy |
|---------|------|
| Commercial primary CTA | `Add credit` |
| Activity secondary CTA | `Record usage` |
| Credit confirmation | `Add {N} tokens to {customer}?` / `Add token credit` |
| Adjustment confirmation | `Adjust {customer}'s balance?` / `Apply balance adjustment` |
| Usage confirmation | `Record {N} tokens of usage for {customer}?` / `Record usage debit` |
| Reversal confirmation | `Reverse this transaction for {customer}?` / `Reverse transaction` |
| Confirmation edit actions | `Edit credit`; `Edit adjustment`; `Edit usage`; `Edit reversal` |
| Draft discard actions | `Discard credit draft`; `Discard adjustment draft`; `Discard usage draft`; `Discard reversal draft` |
| Empty ledger heading | `No token transactions yet` |
| Empty ledger body | `Add token credit to create this customer's first immutable statement entry.` |
| Empty filtered heading | `No transactions match these filters` |
| Empty filtered body | `Clear one or more filters to review the full token account statement.` |
| No period usage | `No token usage in this period` |
| Non-prepaid mutation state | `Token account actions require an active prepaid arrangement.` |
| Insufficient balance | `Usage was not recorded. {customer} has {available} tokens available, but this debit requires {attempted} tokens.` |
| Negative adjustment blocked | `Adjustment was not applied. Removing {attempted} tokens would exceed the available balance of {available} tokens.` |
| Reversal blocked by balance | `Transaction cannot be reversed because the resulting balance would be negative.` |
| Exact duplicate usage | `Usage already recorded` / `No additional tokens were deducted.` |
| Conflicting source reference | `Source reference “{reference}” is already assigned to different usage. Enter a unique source reference or restore the original values.` |
| Already reversed | `This transaction has already been reversed.` |
| Reversal-of-reversal | `A reversal transaction cannot be reversed.` |
| Generic save error | `The token account was not changed. Review the highlighted fields and try again.` |
| Dirty credit form | `Discard credit draft?` / `Continue editing` / `Discard credit draft` |
| Dirty adjustment form | `Discard adjustment draft?` / `Continue editing` / `Discard adjustment draft` |
| Dirty usage form | `Discard usage draft?` / `Continue editing` / `Discard usage draft` |
| Dirty reversal form | `Discard reversal draft?` / `Continue editing` / `Discard reversal draft` |
| Success credit toast | `Token credit added` / `{customer} now has {resulting} tokens.` |
| Success usage toast | `Usage recorded` / `{N} tokens were deducted for {agent}.` |
| Success adjustment toast | `Balance adjustment recorded` |
| Success reversal toast | `Transaction reversed` |

Use `tokens`, `credit`, `usage`, `adjustment`, and `reversal`. Do not use `payment`, `wallet`, `cash`, `invoice`, `refund`, `charge card`, or currency symbols on prepaid surfaces.

## State Contract

- **Loading:** use existing skeletons shaped like the balance card, filter row, summary band, and statement rows. Never replace the whole profile with a spinner.
- **Populated:** current balance and selected-period summary precede statement rows. Statement is newest first; row balances remain derived from the complete chronological ledger.
- **Empty account:** render the exact empty-ledger copy and `Add credit` only when prepaid is active. A historical prepaid account with zero entries is read-only if the current arrangement is not prepaid.
- **Empty filters:** keep filters and current balance visible; replace only the table result with the exact filtered-empty copy. `Clear filters` remains available.
- **Partial legacy record:** use `Not recorded` for missing optional reason/reference and label migration entries `Opening token credit from prototype migration`; never invent a conversion rate.
- **Invalid form:** preserve entered values, show inline messages, and block the review confirmation.
- **Exact duplicate usage:** treat as successful idempotent replay; show the existing transaction reference and no new debit.
- **Conflicting duplicate:** preserve the form, identify the conflicting source reference, and write nothing.
- **Insufficient balance:** preserve the form, state available and attempted tokens, do not open final confirmation, and write neither usage nor ledger entry.
- **Mutation failure:** keep the last readable statement/balance and entered values; show the generic save error plus the specific invariant message.
- **Overflow:** tables use bounded horizontal scrolling; long reasons wrap to two lines; IDs/references truncate visually with full accessible text; page-level overflow is forbidden.
- **Zero / one / many:** use `0 tokens`, `1 token`, `{N} tokens`; summary and pagination counts remain grammatically correct.

## UI Considerations

Applicable state considerations resolved: 8 categories covered, 0 backstop, 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | Ledger table, filtered results, per-agent usage breakdown, account forms | ✅ covered | Empty account and empty filter results use distinct documented copy; forms retain persistent labels and account context. |
| loading | Profile projections, forms, statement, balance-changing controls | ✅ covered | Skeletons match final geometry; pending controls retain action context, flow-specific edit/discard labels remain unambiguous, and repeat submission is disabled. |
| error | Account forms, statement, filters, mutations | ✅ covered | Last valid balance/statement and entered values remain visible; specific invariant copy identifies recovery. |
| populated | Balance card, ledger statement, per-agent breakdown | ✅ covered | One current derived balance precedes selected-period summary and newest-first immutable rows. |
| partial | Migrated ledger rows and optional metadata | ✅ covered | Missing optional metadata reads `Not recorded`; migration provenance is explicit and no financial conversion is implied. |
| overflow | Statement table, filters, reasons, IDs, references | ✅ covered | Bounded horizontal scroll, two-line wrapping, accessible full values, and no page-level overflow. |
| zero-one-many | Token amounts, rows, agent breakdown | ✅ covered | Token labels use correct singular/plural and all zero states remain explicit rather than blank. |
| long-text | Customer/agent names, reasons, source references, confirmation copy | ✅ covered | Meaningful prose wraps; stable references may truncate visually but expose full accessible content; `Edit {action}`, `Discard {action} draft`, and final action labels remain intact. |

## Objective Acceptance Criteria

1. An active prepaid customer's Overview and Commercial tab show the same derived whole-token balance; no prepaid USD symbol, `balanceCents`, or editable balance field is visible.
2. `Add credit`, `Adjust balance`, `Record usage`, and `Reverse transaction` each require a final AlertDialog naming the customer and previewing the resulting balance before any write.
3. Choosing `Edit credit`, `Edit adjustment`, `Edit usage`, or `Edit reversal` from a confirmation changes neither balance nor statement row count and returns to the matching draft; choosing the matching `Discard {action} draft` closes the draft without mutation.
4. A successful credit adds exactly one positive statement row and immediately updates Overview, Commercial, Activity, and the customer-list projection.
5. A successful usage action identifies one agent and one source reference, adds exactly one negative row, and updates `Net tokens consumed` and the agent breakdown.
6. Repeating identical usage shows `Usage already recorded`, creates no row, and changes no balance; conflicting reuse shows the documented conflict and changes nothing.
7. Any usage, negative adjustment, or reversal that would create a negative balance is blocked with available and attempted values; no partial usage/ledger record appears.
8. Statement rows expose type, signed amount, resulting full-account balance, timestamp, reference, and agent/reversal detail. Filtering never recalculates a row's resulting balance from filtered rows.
9. Date, agent, and transaction-type filters work alone and together; inclusive start/end boundary transactions remain visible.
10. At balance equal to the threshold and below it, `Low balance` appears in list, Overview, and Commercial. Above threshold or on non-active-prepaid customers, it does not appear.
11. Existing commercial/access events remain available under `Commercial and access history`; ledger events are not duplicated into it.
12. At 1920×1080 and 1280×800, the page preserves the existing restrained layout without a dashboard/card grid. At 390×844, no page-level horizontal overflow occurs and all confirmations remain operable.
13. Keyboard-only operation can open and complete each action, choose its exact `Edit {action}` confirmation control, or choose its exact `Discard {action} draft` control; focus returns to the invoking control and every field/error/transaction state has an accessible name.
14. No chart, payment/invoice control, backend/auth surface, global alert center, new top-level route, or fifth profile tab is introduced.

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official / existing local components | Existing Button, Badge, Card, Table/DataTable, Input, Label, Select, Sheet, AlertDialog, Tabs, Skeleton, Tooltip, and Sonner components only | PASS — existing project-owned components; `components.json` and `npx shadcn info` verified 2026-09-10; no registry fetch |
| Third-party registries | None | Not applicable |

## Implementation Guardrails

- Do not create a billing dashboard, chart, global low-balance alert system, or new top-level navigation item.
- Do not introduce money/currency labels for prepaid accounts, payment processing, invoices, tax, or external billing providers.
- Do not add editable/stored balance totals; every displayed balance is a repository projection from immutable entries.
- Do not edit or delete ledger transactions. Corrections append a single linked reversal.
- Do not duplicate ledger items into existing commercial/access activity events.
- Do not expose balance actions unless an active prepaid arrangement exists; historical statements remain readable.
- Do not place accounting logic, idempotency, or balance validation in React components.
- Do not change the existing shell, four top-level profile tabs, agent catalog, commercial lifecycle, or agent-access interaction model.
- Do not add backend, authentication, authorization, runtime ingestion, notifications, export, or production data claims.

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
