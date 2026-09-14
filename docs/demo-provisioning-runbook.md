# Demo provisioning runbook

## Local migrations

Operator:

```bash
npx wrangler d1 migrations apply DB --local
```

Portal:

```bash
npx wrangler d1 migrations apply PORTAL_DB --local
```

Apply twice to confirm idempotence. Never apply remote migrations without explicit authorization.

## Approval

1. Open Demo Requests, start review, edit only the proposed configuration.
2. Confirm **Approve and provision demo** in the AlertDialog (no native `confirm()`).
3. Success: status `active`, customer id `demo_<requestId>`, Portal membership `customer_admin`.
4. Welcome email is sent only after Portal membership succeeds.

## Retry

If status is `provisioning_failed`:

1. Inspect audit history and `demo_provisioning_jobs`.
2. Use **Retry failed provisioning**. Retries must not create a second customer or membership.
3. Operator customer rows are retained on Portal failure.

Email delivery failures do not roll back customer or membership records. Re-drain `demo_email_outbox` rows with status `failed` after fixing the provider.

## Rollback

There is no hard-delete of demo history. To withdraw access:

- disable or expire the Portal membership;
- archive the Operator customer using the existing archive flow;
- leave `demo_requests` in place (`rejected`, `expired`, or `active` as appropriate).

## Production smoke

1. Submit `/request-demo/` with a test work email.
2. Confirm Operator list shows the organization and reference.
3. Approve after editing proposed dates/agents.
4. Confirm welcome email in the provider (or memory adapter in tests).
5. Sign in to `https://portal.hivarium.dev` with that email; overview shows only that evaluation customer.
6. Sign in with an unrelated email; no tenant data.
7. Replay approval; customer count remains 1.
