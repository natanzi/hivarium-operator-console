# Code Conventions

**Analysis Date:** 2026-09-08

## TypeScript

- The codebase uses strict TypeScript and explicit domain interfaces.
- Type-only imports use `import type` where practical.
- Domain values use string unions instead of loose strings.
- Shared lookup maps convert domain values to labels and visual styles.
- Public repository methods and domain types include explanatory JSDoc.

## React

- Feature pages are function components with named exports.
- Remote-like data is read through `useRepository()` rather than importing storage directly.
- `useMemo` computes projections such as related records, counts, and table columns.
- Local UI state owns filters, tabs, and post-mutation table refreshes.
- Reusable product shell components live outside feature directories.

## Styling

- Tailwind utility classes are the primary styling mechanism.
- `cn()` merges conditional class names.
- Theme tokens such as `background`, `card`, `primary`, `sage`, and `gold` avoid literal colors in feature JSX.
- Typography generally uses compact `text-xs` and `text-sm` scales suited to an operator console.
- Responsive spacing is applied through `md:` and `lg:` modifiers.

## Data Modeling

- Browser-persisted types remain plain JSON-compatible values.
- IDs are deterministic and treated as stable references.
- Seed data uses explicit timestamps for repeatable rendering and tests.
- Repository methods throw descriptive errors for missing or duplicate customer IDs.
- Customer deletion removes dependent local records in the same write.

## Accessibility

- Interactive controls use semantic buttons, links, headings, tables, and dialogs.
- `aria-label`, `role`, and tab attributes are present on custom controls.
- Test IDs are used for stable product-level test selection.
- Radix primitives provide focus management for overlays such as delete confirmation.

## Navigation

- Route declarations are centralized in `src/app/router.tsx`.
- Many internal navigations use ordinary `<a href>` elements rather than React Router links.
- The root route uses `<Navigate>` to redirect without a transient stuck screen.
- Unknown routes render a product-specific 404 page.

## Error Handling

- Corrupt localStorage data falls back to seed data.
- Unknown legacy statuses normalize to `evaluation`.
- Missing customer profiles show a dedicated empty/error state.
- Mutations generally rely on repository exceptions rather than a typed result/error model.
- There is no global error boundary or remote request error convention yet.

## Change Discipline

- UI behavior is covered with colocated tests.
- Build, typecheck, lint, unit tests, and E2E are distinct scripts.
- Changes should preserve the warm minimal Hivarium visual language.
- Commercial fields should be modeled centrally rather than scattered through page JSX.

---
*Conventions analysis: 2026-09-08*
