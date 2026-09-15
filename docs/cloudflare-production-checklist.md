# Cloudflare production checklist (demo evaluation workflow)

Do not deploy from this task. Complete these dashboard steps before production traffic.

## Order

1. Portal D1 migration `0005_demo_memberships.sql` (membership column).
2. Operator D1 migrations `0002_demo_requests.sql` and `0003_demo_evaluation_config.sql`.
3. Customer Portal Worker (membership PUT + Access pages).
4. Operator Console Worker (intake, UI, provisioning, email).
5. Landing Worker (form + `/api/demo-requests`).
6. Attach custom domains last: `portal.hivarium.dev`, operator hostname, `hivarium.dev`.

## Bindings

- Landing `OPERATOR_SERVICE` → `hivarium-operator-console`.
- Operator `CUSTOMER_PORTAL_SERVICE` → `hivarium-customer-portal`.
- Portal `OPERATOR_SERVICE` / `LICENSE_SERVICE` remain as today.
- Do not set `OPERATOR_SERVICE_URL` or `CUSTOMER_PORTAL_SERVICE_URL` in production.

## Secrets (placeholders locally in `.dev.vars.example`)

- Landing: `OPERATOR_DEMO_INTAKE_TOKEN`, `TURNSTILE_SECRET_KEY`.
- Operator: `LANDING_CALLER_TOKEN`, `PORTAL_SERVICE_TOKEN`, `PORTAL_CALLER_TOKEN`, `LICENSE_SERVICE_TOKEN`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_REPLY_TO`, `OPERATOR_NOTIFY_EMAIL`.
- Operator public vars: `CUSTOMER_PORTAL_URL` (customer-facing portal origin used in email copy; no code default), `AGENT_WORKSPACE_URL` (optional Agent Workspace origin; omit from welcome email when unset), `EMAIL_PROVIDER_URL` (optional; defaults to `https://api.resend.com/emails`).
- Portal: `OPERATOR_CALLER_TOKEN`, `OPERATOR_SERVICE_TOKEN`, `LICENSE_SERVICE_TOKEN`, Access vars.

Directional pairs must match exactly and must not be reused bidirectionally.

## Turnstile

Create a widget for `hivarium.dev`, put the site key in the form widget, store the secret as `TURNSTILE_SECRET_KEY`. Add a WAF rate-limit rule on `POST /api/demo-requests`.

## Email

Configure Resend (or a compatible transactional API):

| Variable | Role |
| --- | --- |
| `EMAIL_PROVIDER_API_KEY` | Provider secret. Use `test://memory` only in tests. |
| `EMAIL_PROVIDER_URL` | Optional. Defaults to `https://api.resend.com/emails`. |
| `EMAIL_FROM_ADDRESS` | Resend `from`. |
| `EMAIL_REPLY_TO` | Resend `reply_to`. Missing value fails closed (no HTTP send). |
| `OPERATOR_NOTIFY_EMAIL` | Operator notification recipient. |
| `CUSTOMER_PORTAL_URL` | Public portal origin used in the welcome email. If unset, provisioning still succeeds and the welcome outbox row is marked `portal_url_unconfigured` for safe retry. |
| `AGENT_WORKSPACE_URL` | Optional Agent Workspace origin. If unset, that section is omitted from the welcome email without failing provisioning. |

The HTTP adapter posts `{ from, reply_to, to, subject, text }`. Do not hardcode `https://portal.hivarium.dev` in templates.

## Cloudflare Access (preferred MVP)

Portal application at `https://portal.hivarium.dev`:

- Authentication: email one-time PIN (OTP). Do not require a single corporate IdP domain.
- Policy: allow authenticated users (any email). **Portal membership is the authorization layer.**
- Do not automatically mutate Access policies from these Workers.
- Unprovisioned authenticated users see “Your account has not been provisioned” with no tenant list.

Operator Console Access remains restricted to authorized operator emails.

## Headers

Operator and Portal already send `noindex, nofollow`. Keep that for internal/customer surfaces.
