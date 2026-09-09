# Architecture

**Analysis Date:** 2026-09-08

## System Pattern

The current application is a browser-only React SPA organized as a lightweight feature-layered frontend. Routing and layout sit above feature pages, while a repository interface separates UI reads and mutations from the current localStorage implementation.

## Entry Points

- `index.html` supplies the browser root element.
- `src/main.tsx` mounts the React application.
- `src/app/App.tsx` installs the `RouterProvider`.
- `src/app/router.tsx` defines every route and composes providers, layout, and toasts.

## Presentation Layer

- `src/components/layout/Layout.tsx` owns the shell, responsive sidebar, top bar, and page width.
- `src/components/layout/Sidebar.tsx` owns primary navigation and Cloudflare Access logout.
- `src/components/ui/` contains reusable visual primitives.
- `src/data/data-table.tsx` is a reusable table/pagination abstraction over TanStack Table.
- Feature pages under `src/features/` compose domain-specific screens.

## Domain Layer

- `src/domain/types.ts` defines customers, subscriptions, feature entitlements, agent products, and agent licenses.
- Types are intentionally serializable and contain no behavior.
- Customer lifecycle normalization is centralized in `normalizeCustomerStatus`.
- Current subscription modeling assumes plan tiers, seats, renewal date, agent product, and status.
- Monthly, token-credit, and annual-contract commercial models are not represented.

## Data Layer

- `HiveRepository` defines the frontend data contract.
- `LocalStorageRepository` implements synchronous reads and writes.
- `RepositoryProvider` injects the repository into feature pages.
- `buildSeedStore` provides deterministic fictional records.
- Customer deletion cascades across local subscriptions, entitlements, and licenses.

## Primary Data Flow

1. A route renders a feature page inside `RepositoryProvider` and `Layout`.
2. The page calls `useRepository()` to obtain `HiveRepository`.
3. The repository loads and normalizes one JSON data store from localStorage.
4. Pages copy relevant records into React state or memoized projections.
5. Mutations write the complete store back to localStorage.
6. The page refreshes local state and may emit a Sonner toast.

## Route Surface

- `/` redirects to `/customers`.
- `/customers` lists, filters, creates navigation, edits, and deletes customers.
- `/customers/new` creates a customer record.
- `/customers/:customerId` shows overview, subscriptions, entitlements, and licenses.
- `/customers/:customerId/edit` edits customer identity and lifecycle fields.
- `/agents` shows the read-only agent catalog.
- `/settings/about` describes the local demo build.

## Extension Seams

- Add commercial account types to `src/domain/types.ts` before building billing UI.
- Extend or replace `HiveRepository` for durable asynchronous persistence.
- Keep customer profile as the aggregation surface for contracts, balances, usage, and agent access.
- Treat runtime authorization and billing calculations as backend responsibilities.
- Preserve the current typed local fixture adapter for demos and deterministic tests.

---
*Architecture analysis: 2026-09-08*
