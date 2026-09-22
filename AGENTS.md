# Hivarium Operator Console — Agent Instructions

## Purpose

This repository contains Hivarium's private internal customer-operations console and its authoritative Worker API. It allows authorized Hivarium operators to manage customer master records, commercial arrangements, prepaid credits and usage, agent-access grants, lifecycle changes, and immutable audit history.

This is not the public marketing site, customer self-service portal, runtime agent-governance UI, general CRM/ERP, payment processor, or license-signing authority.

## Repository ownership

This service owns:

- customer master records and lifecycle state;
- monthly, annual, and prepaid commercial arrangements (the `commercial_arrangements.model` column accepts only these three values — do not write or assume a "negotiated" value; it is not in the schema's CHECK constraint);
- whole-token credit and immutable usage-ledger transactions;
- running balances derived from ledger transactions;
- agent catalog metadata used by customer operations;
- customer-to-agent access grants and their lifecycle;
- operator decisions and immutable audit history;
- demo/evaluation request intake, review, provisioning orchestration, and email outbox;
- the private operator UI and its API.

This service does not own:

- portal users, customer-facing requests, or machine-client credentials — these belong to `hivarium-customer-portal`;
- signed licenses, private signing keys, activations, or offline verification — these belong to `hivarium-license-service`;
- runtime governance or telemetry from the main Hivarium product.

## Current architecture

- React 19, TypeScript, React Router, Vite, Tailwind, Radix UI, and TanStack Table implement the SPA.
- Routes are defined in `src/app/router.tsx`.
- Feature pages live under `src/features/` and shared UI under `src/components/`.
- Pure commercial and ledger rules live under `src/domain/`.
- `HiveRepository` is the application data contract.
- `ApiRepository` is the production/default frontend adapter.
- `LocalStorageRepository` remains only for deterministic tests or explicitly local/demo use; it is not production authority.
- `worker/src/index.ts` is the production Worker entry point.
- `worker/src/app.ts` owns authenticated API routing and mutations.
- `worker/src/db.ts` owns D1 persistence and audit commits.
- `DB` is the authoritative D1 binding.
- Versioned migrations live under `migrations/`.
- The Worker serves both `/api/*` and the SPA asset fallback.

## Security and data invariants

- The public internet must not reach operator data without Cloudflare Access.
- Verify Access JWT signature, issuer, audience, and the exact authorized operator identity before route logic.
- Missing or invalid identity fails closed.
- Portal service authentication must be a separate explicit service principal; do not weaken human Access checks or blindly trust Service Bindings.
- Landing demo intake uses `LANDING_CALLER_TOKEN` on `POST /service/v1/demo-requests`. Ignore `X-Service-Name`. Missing tokens fail closed.
- Every mutation validates a typed DTO, runs shared domain rules, writes authoritative changes and an immutable audit entry atomically.
- Customer archive replaces destructive delete. Archived customers remain readable and retain contracts, access, ledger, usage, and audit history.
- Balances are derived from immutable transactions; never introduce a mutable balance counter as authority.
- Usage source references and financial mutations remain idempotent.
- Never allow a negative prepaid balance.
- Never rewrite applied migrations or delete retained financial/audit history.
- Never commit Access tokens, service tokens, private customer data, or signing keys.

## Integration boundaries

- Customer Portal reads a tenant-scoped subset of customer, commercial, ledger, usage, agent-access, catalog, and activity data through server-to-server calls.
- Add a dedicated internal-service authentication path for the Portal rather than forwarding or bypassing the human operator JWT policy.
- Operator decisions may update customer-request status through an authenticated Customer Portal internal endpoint; preserve append-only request history.
- License creation, issuance, replacement, renewal, suspension, and revocation must call the License Service internal API. Do not implement signing locally.
- Never pass the License Service private key through this service.
- Keep cross-service contracts typed, versioned, least-privilege, and auditable.

## Product and UX rules

- Preserve the warm, minimal Hivarium operator visual system and clear enterprise hierarchy.
- Prefer dense but readable operational information over decorative dashboards.
- Keep customer profile as the primary aggregation surface.
- Require explicit confirmation for archive, termination, reversal, revocation, and other consequential actions.
- Expose human-readable names separately from stable IDs.
- Preserve semantic controls, keyboard access, focus handling, responsive layouts, loading/error states, and Cloudflare Access sign-out.

## Development workflow

Before changing files:

1. Read this file and relevant `.planning/` artifacts.
2. Run `git status --short`; preserve unrelated work.
3. Inspect domain rules, repository contracts, API routes, and existing tests.
4. Make the smallest complete vertical change.

Primary gates:

```bash
npm clean-install
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npx vitest run -c vitest.worker.config.ts
npx wrangler deploy --dry-run
npm audit
git diff --check
```

When migrations change, apply them locally twice and prove the second application is idempotent. Never apply remote migrations, deploy, push, or change Cloudflare Access/DNS without explicit authorization.

## Change discipline

- Preserve endpoint compatibility unless a versioned contract change is planned across consumers.
- Do not return dummy success data for unsupported operations; fail explicitly.
- Do not move authoritative rules into React components.
- Do not weaken authentication, validation, audit, or concurrency behavior to satisfy a test.
- Do not use conditional skips to hide failing E2E behavior.
- Keep generated reports, screenshots, local D1 state, and secrets out of Git.
- Update tests and documentation with every contract or lifecycle change.
- End work by reporting exact files, test counts, migrations, deviations, `git diff --check`, and `git status --short`.
