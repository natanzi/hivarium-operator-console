<!-- GSD:project-start source:PROJECT.md -->

## Project

**Hivarium Operator Console**

Hivarium Operator Console is an internal administration system for managing the organizations that use Agenis/Hivarium services. It gives the operator one reliable place to understand each customer's commercial arrangement, granted agent products, account balance, usage, and contract lifecycle.

The current implementation is a protected browser-based prototype backed by deterministic local data. The project will evolve it into a trustworthy customer-operations console without turning it into a generic CRM, public customer portal, or full accounting suite.

**Core Value:** The operator can understand and control each customer's commercial relationship, agent access, balance, and usage from one clear and dependable profile.

### Constraints

- **Product scope**: Remain an internal customer-operations console — prevents drift into CRM, ERP, or runtime-governance products
- **Security**: No public authentication surface; keep Cloudflare Access as the perimeter while adding server authorization before multi-user use — protects private operational data
- **Data integrity**: Balances must be derived from immutable transactions — mutable counters cannot support auditable usage or corrections
- **Persistence**: localStorage is acceptable only for deterministic demo flows — real customer and financial records require durable server-owned storage
- **Delivery**: Build vertical, visible slices that remain testable at every phase — the project should stay usable rather than waiting for all backend layers
- **UX**: Preserve the warm, minimal Hivarium visual system and accessible confirmation patterns — operators need clarity, not decorative dashboards
- **Deployment**: Maintain Cloudflare static SPA compatibility until a backend deployment is deliberately introduced

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Application Runtime

- TypeScript 5.8 with strict compiler settings in `tsconfig.json`.
- React 19.1 and React DOM 19.1 provide the UI runtime.
- Vite 6.3 is the development server and production bundler.
- The application targets ES2020 and modern evergreen browsers.
- Source imports use the `@/*` alias mapped to `src/*`.

## UI and Styling

- Tailwind CSS 4.1 is integrated through `@tailwindcss/vite` in `vite.config.ts`.
- Radix UI primitives back dialogs, forms, menus, tabs, and accessible overlays.
- shadcn-style components live under `src/components/ui/`.
- Lucide React supplies interface icons.
- Sonner supplies toast notifications.
- The visual system is defined primarily in `src/index.css` and utility classes.

## Application Frameworks

- React Router 7 owns client-side routes in `src/app/router.tsx`.
- TanStack React Table 8 powers reusable tables in `src/data/data-table.tsx`.
- React Hook Form and Zod are installed for form state and validation.
- Refine packages and generated Refine UI components remain in the dependency tree.
- Current Hivarium feature pages mostly use direct React composition rather than Refine resources.

## Data and State

- Domain contracts are plain serializable interfaces in `src/domain/types.ts`.
- `LocalStorageRepository` in `src/data/local-storage-repository.ts` is the active persistence adapter.
- `RepositoryProvider` in `src/data/repository-context.tsx` provides dependency injection for pages and tests.
- Deterministic fixtures are defined in `src/data/seed-data.ts`.
- There is no server database, API client, query cache, or background synchronization.

## Quality Tooling

- Vitest 4 with jsdom runs component and repository-facing tests.
- Testing Library and user-event exercise UI behavior.
- Playwright 1.63 provides browser E2E coverage through `e2e/console.spec.ts`.
- ESLint 9 and TypeScript ESLint enforce static analysis.
- Build gate: `npm run build`; type gate: `npm run typecheck`; lint gate: `npm run lint`.

## Deployment

- `wrangler.jsonc` deploys `dist/` as Cloudflare Worker static assets.
- SPA fallback is enabled with `not_found_handling: "single-page-application"`.
- `public/_headers` supplies noindex and baseline security headers.
- `public/robots.txt` blocks all crawlers.
- `Dockerfile` provides an additional container-oriented packaging path.

## Repository State

- Current branch is `main` and is one local commit ahead of `origin/main`.
- The current local-only commit adds confirmed customer deletion.
- `.env` exists locally but is not tracked by Git.

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

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

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Pattern

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

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
