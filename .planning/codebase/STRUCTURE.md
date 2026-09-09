# Repository Structure

**Analysis Date:** 2026-09-08

## Root

- `package.json` contains runtime dependencies and quality scripts.
- `vite.config.ts` configures React, Tailwind, and the `@` source alias.
- `vitest.config.ts` configures component tests.
- `playwright.config.ts` configures browser tests.
- `wrangler.jsonc` configures Cloudflare static-asset deployment.
- `public/` contains deployment headers, robots rules, and favicon assets.
- `e2e/` contains browser-level smoke scenarios.

## Application Bootstrap

- `src/main.tsx` mounts React.
- `src/app/App.tsx` hosts the router provider.
- `src/app/router.tsx` is the route registry and composition root.

## Domain and Persistence

- `src/domain/types.ts` is the canonical domain-model file.
- `src/data/local-storage-repository.ts` contains the repository contract and browser implementation.
- `src/data/repository-context.tsx` contains React injection helpers.
- `src/data/seed-data.ts` contains deterministic demo customers, products, subscriptions, entitlements, and licenses.
- `src/data/data-table.tsx` contains shared table behavior.

## Feature Modules

- `src/features/customers/pages/CustomersPage.tsx` owns the customer index and deletion flow.
- `src/features/customers/pages/CreateCustomerPage.tsx` owns customer creation.
- `src/features/customers/pages/EditCustomerPage.tsx` owns customer editing.
- `src/features/customers/pages/CustomerProfilePage.tsx` owns customer details and related records.
- `src/features/agents/pages/AgentCatalogPage.tsx` owns the read-only catalog.
- `src/features/about/pages/AboutPage.tsx` describes the product phase and storage behavior.
- Tests are colocated beside their feature pages as `*.test.tsx`.

## Shared UI

- `src/components/layout/` contains product-specific shell components.
- `src/components/ui/` contains shadcn/Radix primitives.
- `src/components/refine-ui/` contains generated Refine-oriented components, many not used by current feature pages.
- `src/components/ui/primitives.tsx` contains small product-specific shared primitives.
- `src/hooks/`, `src/lib/`, and `src/test/` contain cross-cutting helpers.

## Legacy or Template Surface

- `src/pages/blog-posts/` and `src/pages/categories/` are Refine template pages not wired into the Hivarium router.
- `src/pages/login/`, `register/`, and `forgot-password/` are not part of the protected production route model.
- `src/providers/` appears tied to the template/Refine setup rather than the active local repository architecture.
- These paths increase cognitive and dependency surface until removed or intentionally adopted.

## Naming Conventions

- Components and pages use PascalCase filenames.
- Data and utility modules use kebab-case filenames.
- Tests are colocated and mirror the production component name.
- Domain IDs use stable string prefixes such as `cust_`, `agent_`, `sub_`, and `lic_`.
- The `@/` alias is preferred over deep relative imports.

---
*Structure analysis: 2026-09-08*
