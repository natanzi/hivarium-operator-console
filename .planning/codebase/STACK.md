# Technology Stack

**Analysis Date:** 2026-09-08

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

---
*Stack analysis: 2026-09-08*
