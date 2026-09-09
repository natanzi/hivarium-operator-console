# Testing Strategy

**Analysis Date:** 2026-09-08

## Test Stack

- Vitest 4 is the unit and component test runner.
- jsdom supplies the browser-like unit-test environment.
- Testing Library renders pages and queries accessible UI.
- `@testing-library/user-event` drives operator interactions.
- Playwright 1.63 runs browser-level E2E scenarios.

## Test Organization

- Feature tests are colocated under `src/features/**/pages/*.test.tsx`.
- Shared test setup lives in `src/test/setup.ts`.
- Shared rendering helpers live in `src/test/render.tsx`.
- Browser scenarios live in `e2e/console.spec.ts`.
- The existing suite covers About, Agent Catalog, customer list, profile, create, and edit screens.

## Data Isolation

- `createInMemoryRepository()` supplies a Map-backed storage adapter.
- Tests avoid mutating the browser's real localStorage when using the helper.
- Deterministic seed data makes counts, dates, labels, and relationships reproducible.
- Repository injection lets pages run against test-specific stores.
- The customer-deletion test verifies confirmation and related-record cascade behavior.

## Current Coverage Strengths

- Customer CRUD behavior has component-level coverage.
- Customer search, status filters, summary counts, and pagination are testable through the UI.
- Profile tabs expose subscriptions, entitlements, and licenses.
- The catalog is validated as a read-only product surface.
- Confirmed deletion protects against accidental one-click removal.

## Browser Coverage

- E2E currently checks pagination labels and disabled navigation.
- E2E checks search empty-state behavior and guards against the previous invalid range bug.
- E2E includes a customer profile/edit navigation flow.
- The edit scenario conditionally skips field interaction when an `Industry` field is absent, reducing its value.
- There is no E2E coverage for delete confirmation, Cloudflare logout, mobile navigation, or customer creation.

## Commands

- `npm run typecheck` performs a no-emit TypeScript check.
- `npm run build` runs TypeScript followed by Vite production build.
- `npm run lint` runs ESLint across the repository.
- `npm test` runs the Vitest suite once.
- `npm run test:e2e` runs Playwright.

## Gaps for the Planned Product

- No contract-model tests exist for monthly, token-credit, or annual commercial arrangements.
- No ledger invariants test credit grants, usage debits, balance calculations, or idempotency.
- No authorization tests prove one operator or role can access specific actions.
- No API integration or persistence migration tests exist because there is no backend.
- No accounting export, date-boundary, expiry, renewal, or overage tests exist.

## Required Future Test Shape

- Keep balance math in pure functions with exhaustive unit tests.
- Test immutable credit and usage transactions separately from UI summaries.
- Add repository contract tests that run against both demo and durable adapters.
- Add E2E flows for assigning agents, charging credit, recording usage, and viewing a statement.
- Add access-control tests at the deployment boundary and server API boundary.

---
*Testing analysis: 2026-09-08*
