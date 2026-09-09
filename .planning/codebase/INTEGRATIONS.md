# External Integrations

**Analysis Date:** 2026-09-08

## Cloudflare

- Production hosting is configured as a static-assets Worker in `wrangler.jsonc`.
- The intended custom domain is `ops.hivarium.dev`.
- Authentication is enforced outside the SPA by Cloudflare Access.
- `src/components/layout/Sidebar.tsx` links to `/cdn-cgi/access/logout` for a real Access logout.
- The frontend does not inspect Cloudflare identity headers or application tokens.
- Access policy configuration is infrastructure state and is not represented in this repository.

## Browser Storage

- Browser `localStorage` is the only active persistence integration.
- The storage key is `hivarium.operator-console.store.v1`.
- Seed data is written on first load and mutations persist only in the current browser profile.
- Invalid JSON falls back to deterministic seed data.
- Legacy customer status values are normalized during reads.
- Tests substitute a Map-backed `StorageLike` adapter for browser storage.

## Backend and Data Services

- No REST, GraphQL, RPC, or WebSocket backend is currently connected.
- No relational or document database is configured.
- No durable customer, contract, credit, or usage ledger exists.
- No billing provider such as Stripe is integrated.
- No email, notification, webhook, or event-stream provider is integrated.
- No Hivarium runtime or agent telemetry API is connected.

## Agent Catalog

- Catalog records are deterministic local fixtures in `src/data/seed-data.ts`.
- `AgentCatalogPage` reads the catalog through `HiveRepository`.
- Catalog entries contain product identity, category, version, description, and eligible plan tiers.
- There is no catalog publishing workflow or remote catalog source.
- Customer access is represented locally by subscriptions and agent licenses.

## Security and Search Controls

- `public/_headers` sets `X-Robots-Tag`, `nosniff`, `no-referrer`, and `DENY` framing.
- `public/robots.txt` disallows all crawler paths.
- Cloudflare Access is the actual authentication boundary; there is no public application login.
- No app-level RBAC, audit trail, session API, or operator identity model exists.

## Future Integration Boundaries

- `HiveRepository` is the natural seam for replacing localStorage with a durable API adapter.
- Billing models require a server-owned contract and balance source of truth.
- Token charging requires append-only credit and usage transactions, not a mutable browser counter.
- Agent entitlements should ultimately be enforced by the runtime as well as displayed in this console.
- Usage reporting needs ingestion from trusted runtime events with idempotency and customer attribution.

---
*Integrations analysis: 2026-09-08*
