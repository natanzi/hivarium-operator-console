# Cloudflare production checklist (demo evaluation workflow)

Do not deploy from this task. Complete these dashboard steps before production traffic.

## Order

1. Portal D1 migration `0005_demo_memberships.sql` (membership column).
2. Operator D1 migration `0002_demo_requests.sql`.
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
- Operator: `LANDING_CALLER_TOKEN`, `PORTAL_SERVICE_TOKEN`, `PORTAL_CALLER_TOKEN`, `LICENSE_SERVICE_TOKEN`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`, `OPERATOR_NOTIFY_EMAIL`.
- Portal: `OPERATOR_CALLER_TOKEN`, `OPERATOR_SERVICE_TOKEN`, `LICENSE_SERVICE_TOKEN`, Access vars.

Directional pairs must match exactly and must not be reused bidirectionally.

## Turnstile

Create a widget for `hivarium.dev`, put the site key in the form widget, store the secret as `TURNSTILE_SECRET_KEY`. Add a WAF rate-limit rule on `POST /api/demo-requests`.

## Email

Configure a transactional provider compatible with `HttpEmailGateway` (`EMAIL_PROVIDER_URL` defaults to Resend). Keep `EMAIL_PROVIDER_API_KEY=test://memory` only in tests.

## Cloudflare Access (preferred MVP)

Portal application at `https://portal.hivarium.dev`:

- Authentication: email one-time PIN (OTP). Do not require a single corporate IdP domain.
- Policy: allow authenticated users (any email). **Portal membership is the authorization layer.**
- Do not automatically mutate Access policies from these Workers.
- Unprovisioned authenticated users see “Your account has not been provisioned” with no tenant list.

Operator Console Access remains restricted to authorized operator emails.

## Headers

Operator and Portal already send `noindex, nofollow`. Keep that for internal/customer surfaces.
