---
phase: 1
slug: customer-commercial-control
status: approved
shadcn_initialized: true
preset: new-york
created: 2026-09-09
reviewed_at: 2026-09-09
---

# Phase 1 — UI Design Contract

> Visual and interaction contract for Customer Commercial Control. This phase extends the existing Hivarium Operator Console; it does not redesign the application shell.

## Experience Intent

An operator must understand a customer's current commercial relationship and agent access within five seconds, then make a controlled change without losing history. The interface should feel like a quiet operations record: dense enough for real work, visually restrained, and explicit about dates, money, access, and consequences.

The customer name and current commercial arrangement are the primary focal points. Current state is shown before history. High-impact actions state their consequence in plain language before confirmation. Decorative charts, duplicated KPI cards, novelty motion, and dashboard ornament are excluded.

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn/ui, already initialized |
| Preset | `new-york`, confirmed from `components.json` and `shadcn info` |
| Component library | Radix UI primitives through existing `src/components/ui` components |
| Icon library | Lucide React; every icon-only control requires an accessible name and tooltip |
| Font | Inter with existing system fallbacks |
| Form stack | React Hook Form + Zod using existing input, select, radio, calendar, drawer/sheet, dialog, badge, table, and toast patterns |

No third-party registry, new component kit, chart library usage, or page-specific visual language is introduced.

## Spacing Scale

Declared values are the existing 4/8-point rhythm:

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps and tightly related metadata |
| sm | 8px | Inline controls, badges, compact field help |
| md | 16px | Form groups, table cell padding, related content |
| lg | 24px | Card and panel padding |
| xl | 32px | Page header separation and major groups |
| 2xl | 48px | Rare desktop-only section separation |
| 3xl | 64px | Page-level breathing room only |

Exceptions: minimum interactive target height is 36px on desktop and 44px on touch layouts; these are control dimensions, not layout-spacing tokens.

## Typography

Only four sizes and two weights are allowed in Phase 1 surfaces.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Metadata / label | 12px | 400 | 1.4 |
| Body / control | 14px | 400 | 1.5 |
| Section heading | 17px | 600 | 1.35 |
| Page heading / key amount | 24px | 600 | 1.2 |

Use weight 600 for headings, active values, and deliberate emphasis only. Currency, balances, allowances, counts, and dates use tabular numerals. Persistent IDs use the existing monospace treatment at the metadata size and never replace human-readable names.

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#F5F2EC` | Page background and negative space |
| Secondary (30%) | `#FCFBF8` with `#E3DCCC` borders | Sidebar, cards, drawers, tables, dialogs, history surfaces |
| Accent (10%) | `#9A4B23` with `#F2E0D3` soft state | Primary action, active tab, selected commercial model, focus ring, and current-timeline marker only |
| Healthy / active | `#5F7158` with `#E4E9E0` | Active arrangement and active-access status only |
| Scheduled / caution | `#9C7C38` with `#F1E8D2` | Scheduled changes, approaching expiry, and pending revocation |
| Destructive | `#B23A32` | Termination and revocation language, icons, confirmation action, and failure state only |

Accent is reserved for the primary action, active navigation/tab state, selected model, keyboard focus, and current timeline marker. Links and secondary controls remain neutral unless their semantic state requires another listed color. Color never carries status without a text label or icon.

## Information Architecture

### Customer profile shell

Preserve the existing `PageHeader`, sidebar, warm-paper shell, content width, and back/edit controls. Replace the legacy profile sections with exactly four tabs:

1. **Overview** — identity/contact details, lifecycle, active commercial summary, important date, current agent-access count, and one context-sensitive primary action.
2. **Commercial** — active arrangement, any scheduled successor, arrangement-specific terms, and compact immutable history.
3. **Agent Access** — current, scheduled, and historical grants/revocations with grant/revoke controls.
4. **Activity** — chronological combined timeline of commercial and agent-access events.

Existing feature-entitlement information remains available as a compact Overview subsection. Legacy subscription and license records are migrated into the new commercial/access model; the UI does not expose two competing concepts for the same relationship.

### Visual hierarchy

- First: customer name, lifecycle badge, and active commercial model.
- Second: model-specific amount/balance, next important date, and active-agent count.
- Third: the current tab's operational records and primary action.
- Fourth: historical detail and stable identifiers.
- Destructive actions never occupy the primary page-header position.

## Screen Contracts

### Overview

Use one restrained summary band, not multiple KPI cards. It contains:

- lifecycle badge;
- commercial model label (`Monthly`, `Prepaid`, or `Annual contract`);
- one model-specific primary value: monthly price, prepaid balance, or annual contract value;
- one important date: next renewal, scheduled model change, prepaid expiry if present, or contract end;
- count of active agent grants;
- primary action `Change commercial model` when an arrangement exists, otherwise `Set commercial model`.

Below the band, show customer/contact details and compact feature entitlements. Do not add charts.

### Commercial tab

The current arrangement appears as a bordered document-style record with status, effective date, model terms, and next date. Model-specific content is exclusive:

- **Monthly:** fixed monthly amount, effective date, next renewal date.
- **Prepaid:** current USD balance, effective date, optional expiry, and a clear note that detailed usage accounting is added in Phase 2.
- **Annual contract:** contract value, start/end dates, included allowance, allowance unit, and overage rate.

If a future change is scheduled, place a compact `Scheduled change` strip directly below the active record with its effective date and `Review scheduled change` action. Arrangement history is a table ordered newest first with model, status, effective range, primary terms, replacement/termination reason, and `View record` action. Historical records are read-only.

### Commercial arrangement drawer

Open a right-side drawer (desktop target width 520px; full-width sheet below 768px) from `Set commercial model`, `Change commercial model`, or `Review scheduled change`.

Flow:

1. Choose exactly one model using three radio-card options.
2. Choose `Effective now` or `Schedule for date`.
3. Enter only fields relevant to the selected model.
4. Review a concise consequence summary.
5. Commit with model-specific copy: `Start monthly subscription`, `Activate prepaid balance`, `Start annual contract`, or `Schedule commercial change`.

Changing an active arrangement must disclose that the current record will move to history. Terminating an arrangement must disclose the number of active agent grants that will be revoked. Invalid date ordering, negative money, and missing required terms are blocked inline before confirmation.

### Agent Access tab

Current grants are the focal collection. Each row shows human-readable agent name, stable product ID, granted date, optional end date, and status. Scheduled grants/revocations appear in a separate compact section above history. Historical access is read-only and ordered newest first.

Primary action: `Grant agent access`. Each active row exposes `View agent` and `Revoke access`; the destructive action is visually quiet until invoked. Never hard-delete an access record.

### Grant access drawer

Use a searchable catalog list in the existing drawer/sheet pattern. Each result shows name, category, version, short capability statement, and whether the customer already has active or scheduled access. Selecting one agent reveals start date, optional end date, and a final summary. Primary CTA: `Grant agent access` or `Schedule agent access`.

Already-active agents are disabled with the explanation `This customer already has access`. A scheduled future grant may be reviewed but not duplicated.

### Agent detail reverse view

The read-only catalog gains a detail route or detail surface. The focal content remains the agent product identity and capability. Add `Customer access` as a secondary section showing customers with active or scheduled access, effective dates, and links to their profiles. Catalog editing remains out of scope.

### Activity tab

Render a semantic chronological list, not a chart. Each event includes timestamp, action label, affected model or agent, resulting state, and operator/source. Automatic revocations caused by arrangement termination are separate events linked visually to the triggering commercial event. Stable record IDs may appear in expanded details.

## Interaction and Feedback

- Drawers retain the customer page behind them and return focus to the invoking control when closed.
- Unsaved drawer changes trigger an explicit `Discard commercial changes?` or `Discard access changes?` confirmation only after the form becomes dirty.
- Successful mutations update the visible summary/table immediately and announce a Sonner toast such as `Commercial model scheduled` or `Agent access revoked`.
- Submit buttons show an in-control pending label (`Scheduling change…`, `Granting access…`) and cannot be submitted twice.
- Focus order follows visual order. Tabs implement arrow-key navigation, Home/End, visible focus, and correct `tab`/`tabpanel` relationships.
- Dates are displayed in the existing locale format but stored as ISO timestamps. Date labels distinguish `Effective`, `Renews`, `Ends`, and `Scheduled for`.
- Money is displayed as USD with two decimals. Never show an unlabeled number as a balance, price, allowance, or rate.
- No animation is required beyond existing 150–200ms opacity/translation transitions. Reduced motion removes drawer translation and uses opacity only.

## Responsive Contract

- **Desktop ≥1280px:** retain the existing collapsible sidebar and up-to-1440px content surface. Summary values remain on one row where space permits.
- **Tablet 768–1279px:** summary wraps into two rows; tab strip may horizontally scroll; drawers remain right-aligned and no wider than 520px.
- **Mobile <768px:** sidebar uses the existing sheet behavior; drawers become full-width sheets; action groups stack; tables remain semantic and use bounded horizontal scrolling with the primary name/status column kept visible where feasible.
- Long customer names, agent names, domains, and IDs wrap or truncate with an accessible full-value title/description. Page-level horizontal overflow is forbidden.

## Accessibility Contract

- Meet WCAG 2.2 AA contrast for text, controls, focus indicators, and semantic status colors.
- All fields have persistent labels; placeholder text is never the only label.
- Validation messages are associated with fields and summarized at submit when more than one field fails.
- Status badges expose text, not color alone.
- Drawers and dialogs trap focus, close with Escape unless a mutation is being committed, and restore focus.
- Confirmation dialogs name the exact customer, arrangement, or agent and state whether the action is immediate or scheduled.
- Toasts use a polite live region; destructive failures use assertive messaging without removing entered form values.
- Minimum interactive target height is 36px desktop and 44px touch layouts.

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary Overview CTA | `Set commercial model` or `Change commercial model` |
| Commercial drawer CTAs | `Start monthly subscription`; `Activate prepaid balance`; `Start annual contract`; `Schedule commercial change` |
| Agent access CTA | `Grant agent access` or `Schedule agent access` |
| No commercial model heading | `No commercial model is active` |
| No commercial model body | `Choose how this customer uses Hivarium before granting agent access.` |
| No agent access heading | `No agents are available to this customer` |
| No agent access body | `Grant access to an agent from the Hivarium catalog.` |
| No matching agents heading | `No catalog agents match this search` |
| No matching agents body | `Clear the search or choose another category.` |
| Commercial save error | `Commercial changes were not saved. Review the highlighted fields and try again.` |
| Access save error | `Agent access was not changed. Review the dates and try again.` |
| Termination confirmation | `Terminate {model} for {customer}? {N} active agent access grants will be revoked and recorded in Activity.` Actions: `Keep arrangement`, `Terminate and revoke access`. |
| Access revocation confirmation | `Revoke {agent} access for {customer}? The access record will remain in history.` Actions: `Keep access`, `Revoke agent access`. |
| Dirty commercial drawer | `Discard commercial changes?` Actions: `Continue editing`, `Discard commercial changes`. |
| Dirty access drawer | `Discard access changes?` Actions: `Continue editing`, `Discard access changes`. |

## State Contract

- **Loading:** use existing skeleton primitives shaped like the final summary and rows; never replace the entire page with a spinner.
- **Populated:** show current records before scheduled and historical records; preserve deterministic ordering.
- **Empty:** use the exact empty-state copy above and one relevant action. Zero, one, and many states use grammatically correct count labels.
- **Partial legacy data:** show `Not recorded` for absent historical fields and never invent monetary terms or dates.
- **Error:** keep the last readable state, show the exact error copy above, and offer `Try saving again` or `Reload customer record` as appropriate.
- **Overflow:** tables use bounded horizontal scrolling; long labels wrap to two lines or truncate with full accessible text; action labels remain visible.

## UI Considerations

Applicable state considerations resolved: 40 covered, 0 backstop, 0 unresolved. The user confirmed the detected element kinds and the following explicit behavior on 2026-09-09.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | Commercial records, agent-access records, reverse customer access, Activity, forms | ✅ covered | Empty collections and unconfigured forms render the exact heading/body/action defined in the Copywriting Contract; Activity identifies that no commercial or access changes have been recorded yet. |
| loading | Profile navigation/content, forms, record collections, controls | ✅ covered | Loading surfaces use existing skeleton primitives shaped like their final summary and rows; submitting controls retain their label context, show the documented pending verb, and reject duplicate submission. |
| error | Profile navigation/content, forms, record collections, controls | ✅ covered | The last readable state and entered values remain visible; the exact Copywriting Contract error appears with `Try saving again` or `Reload customer record`. |
| populated | Commercial, agent-access, reverse customer-access, and Activity collections | ✅ covered | Typical populated state is ordered current first, scheduled second, history last; Activity is newest first and commercially-triggered automatic revocations remain linked to their cause. |
| partial | Commercial/access records, Activity, forms | ✅ covered | Missing legacy fields render `Not recorded`; the UI never fabricates money, dates, allowance, source, or access history, and required new-form fields block submission inline. |
| overflow | Profile shell/navigation and all record collections | ✅ covered | Tab strips and tables use bounded horizontal scrolling; long labels wrap to two lines or truncate with accessible full text; page-level horizontal overflow is forbidden. |
| zero-one-many | Commercial, agent-access, reverse customer-access, and Activity collections | ✅ covered | Zero uses the documented empty state and one/many counts use grammatically correct labels without changing the table/timeline structure. |
| long-text | Identity/detail content, forms, navigation, controls, commercial/access records | ✅ covered | Customer/agent names and reasons wrap where reading is important; IDs/domains may truncate visually but expose the complete value accessibly; action labels remain intact. |

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official / existing local components | Existing button, badge, card, table, tabs, drawer/sheet, alert-dialog, form, input, select, radio, calendar, skeleton, and toast components only | PASS — existing project-owned components; no new registry fetch |
| Third-party registries | None | Not applicable |

## Implementation Guardrails

- Do not create a second design-token system or parallel generic dashboard components.
- Do not add a chart for balances, usage, arrangement distribution, or activity in Phase 1.
- Do not add payment processing, ledger transactions, invoices, backend services, or production authentication.
- Do not hard-delete commercial or access history.
- Do not expose prepaid usage detail or annual overage calculations before Phase 2.
- Preserve the repository boundary and use typed domain records for every visible state.

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved 2026-09-09
