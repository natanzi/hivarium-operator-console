# Demo request flow

Hivarium evaluation requests are operator-approved research workspaces.
They are not sales checkout, billing, or automatic commercial onboarding.

## Ownership

| Store | Owner | Tables |
| --- | --- | --- |
| Landing Worker | `hivarium-landing` | none (no D1) |
| Operator D1 (`DB`) | `hivarium-operator-console` | `demo_requests`, `demo_request_events`, `demo_provisioning_jobs`, `demo_email_outbox`, plus existing customer/commercial/grant tables |
| Portal D1 (`PORTAL_DB`) | `hivarium-customer-portal` | `portal_memberships` (including `demo_expires_at`), `portal_audit_log`, `idempotency_records` |

Landing never writes Operator or Portal D1. Operator never writes Portal D1 directly; it calls the Portal service binding. Portal never writes Operator demo tables.

## Sequence

1. Visitor submits `POST /api/demo-requests` on the landing Worker.
2. Landing validates (Zod, Turnstile, honeypot, rate limit, idempotency key) and forwards to Operator `POST /service/v1/demo-requests` using `OPERATOR_DEMO_INTAKE_TOKEN`.
3. Operator stores the request (`submitted`), appends `demo.submitted`, enqueues operator notification and customer acknowledgment emails.
4. Operator UI `/demo-requests` lists and filters requests. Detail separates original payload, proposed configuration, provisioning status, and audit history.
5. Operator starts review, optionally requests information or rejects, then approves.
6. Approval orchestration (retry-safe):
   - version-check the request;
   - create or reuse customer id `demo_<requestId>` with evaluation status;
   - apply prepaid evaluation arrangement, feature entitlements, agent grants;
   - `PUT` Portal membership;
   - mark `active` only after mandatory steps succeed;
   - enqueue welcome email.
7. Portal failure leaves the Operator customer, sets `provisioning_failed`, skips welcome email, and allows Retry.
8. Customer authenticates at `https://portal.hivarium.dev` via Cloudflare Access. Membership, not the Access JWT alone, authorizes tenant data.

## Bindings and directional secrets

| From | Binding / secret | To |
| --- | --- | --- |
| Landing | `OPERATOR_SERVICE` + `OPERATOR_DEMO_INTAKE_TOKEN` | Operator `LANDING_CALLER_TOKEN` |
| Landing | `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile siteverify |
| Operator | `CUSTOMER_PORTAL_SERVICE` + `PORTAL_SERVICE_TOKEN` | Portal `OPERATOR_CALLER_TOKEN` |
| Operator | `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_PROVIDER_URL` | transactional email |
| Operator | `OPERATOR_NOTIFY_EMAIL` | operator notification recipient |
| Portal | `OPERATOR_CALLER_TOKEN` | inbound Operator membership PUT |
| Portal | existing Access vars | Cloudflare Access JWT verification |

Do not reuse one token for both directions. `X-Service-Name` is ignored.
