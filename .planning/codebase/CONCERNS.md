# Codebase Concerns

**Analysis Date:** 2026-09-08

## High Priority

### Browser-only persistence

- All customer and entitlement data lives in localStorage through `src/data/local-storage-repository.ts`.
- Data is neither durable across devices nor suitable as an accounting source of truth.
- Any browser user with access can edit the stored JSON through developer tools.
- Concurrent operators, backups, migrations, and recovery are unsupported.
- Production customer or financial data must not rely on this adapter.

### Commercial model is incomplete

- `Subscription` only models tier, seats, agent product, dates, and status.
- Monthly subscription, prepaid token credit, and annual contract models cannot be represented accurately.
- There is no currency, price, billing cadence, contract value, credit balance, or renewal policy.
- There is no usage event or append-only transaction ledger.
- Current screens cannot explain how a balance was calculated or reconstruct historical consumption.

### Authorization is perimeter-only

- Cloudflare Access protects the site, but the SPA has no operator identity or role model.
- The frontend does not receive or display the authenticated operator.
- There is no server-side authorization for customer mutations because there is no server API.
- Hiding the application behind Access is appropriate for the demo but insufficient for multi-operator production use.

## Medium Priority

### Destructive lifecycle behavior

- `deleteCustomer` permanently removes a customer and related local records.
- Confirmation prevents accidental clicks, but there is no restore, archive-first workflow, or audit record.
- Financial and usage history should be retained even when a commercial relationship ends.

### Test drift

- `e2e/console.spec.ts` looks for an `Industry` field conditionally and silently skips the mutation if absent.
- Conditional assertions can allow an intended workflow to stop being tested without failing.
- Browser coverage does not yet exercise deletion, logout, mobile navigation, or full creation persistence.

### Template and dependency surface

- `src/components/refine-ui/`, `src/pages/blog-posts/`, and `src/pages/categories/` are not part of the active Hivarium route tree.
- Numerous Refine, chart, carousel, and form dependencies may be unused.
- Unused template code raises maintenance, audit, and bundle-comprehension costs.
- Removal should follow import analysis and should not precede core roadmap work unless it blocks quality gates.

### Synchronous repository assumptions

- `HiveRepository` is entirely synchronous and pages assume immediate reads after writes.
- A durable backend adapter will require async states, loading, retries, conflict handling, and typed errors.
- The migration should preserve a repository boundary without pretending remote I/O is synchronous.

## Lower Priority

- Internal links frequently use `<a href>` and trigger full document navigation instead of router transitions.
- There is no global error boundary for unexpected render errors.
- Runtime validation of parsed localStorage data is partial; TypeScript assertions do not validate JSON at runtime.
- `React.StrictMode` is enabled; this is normal here but side effects must remain idempotent.
- The fixed deterministic customer creation date is useful for tests but misleading for real operations.

## Security Positives

- `.env` is not tracked by Git.
- Search indexing is blocked through both response headers and `robots.txt`.
- Framing is denied and referrer leakage is disabled.
- Cloudflare Access logout is explicit in the operator UI.
- No third-party analytics or customer-data integrations are present.

## Recommended Sequence

1. Complete the local UX model for commercial arrangements, agent access, balance, and usage statements.
2. Define ledger invariants and retention rules before implementing charging logic.
3. Introduce a durable authenticated backend and migrate the repository boundary.
4. Add server-side authorization and audit logs before supporting multiple operators.
5. Harden E2E coverage and only then remove unused template surface.

---
*Concerns analysis: 2026-09-08*
