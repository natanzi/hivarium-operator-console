# Claude Code Instructions — Hivarium Operator Console

`AGENTS.md` is the canonical repository instruction file. Read it completely before diagnosing, planning, or editing this project.

## Working contract

- Work only in `hivarium-operator-console` unless coordinated changes across repositories are explicitly authorized.
- Treat the Worker API and D1 as production authority; do not reintroduce browser `localStorage` as authoritative persistence.
- Keep commercial rules, ledger arithmetic, access lifecycle, and archive behavior in shared domain/repository layers rather than page JSX.
- Preserve immutable ledgers, idempotency, atomic audit writes, archive retention, and non-negative balance guarantees.
- Keep human Cloudflare Access authentication separate from future portal service authentication.
- Delegate license signing and lifecycle to `hivarium-license-service`; never add signing keys here.
- Do not implement customer portal identities or customer-facing request ownership here.
- Follow relevant `.planning/` artifacts and run every applicable gate listed in `AGENTS.md`.
- Do not push, deploy, apply remote migrations, or modify Cloudflare/DNS settings without explicit authorization.

If implementation and older planning text disagree, verify the current code and tests, then correct stale documentation without weakening current behavior.

