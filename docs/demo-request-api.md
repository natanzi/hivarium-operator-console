# Demo request API

## Landing (public)

`POST /api/demo-requests`

- Same-origin browser POST from `/request-demo/`.
- Zod validation, Turnstile server verification, honeypot `website`, in-isolate rate limit (5 / 10 minutes / IP). Production should also attach a Cloudflare WAF rate-limit rule on `/api/demo-requests`.
- Generic body `{ ok, message }`. No request ids, tokens, or operator state.
- Forwards to Operator; does not access D1.

## Operator (Landing caller)

`POST /service/v1/demo-requests`

Authorization: `Authorization: Bearer` matching `LANDING_CALLER_TOKEN` with constant-time comparison. Unconfigured token → 503. Wrong token → 401.

Idempotency: `idempotencyKey` in JSON or `Idempotency-Key` header. Replay of the same body returns the original record. Same key, different body → 409.

## Operator (human Access JWT)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/demo-requests?status=&q=` | List |
| GET | `/api/demo-requests/:id` | Detail + events |
| PATCH | `/api/demo-requests/:id/configuration` | Proposed config only; `version` required |
| POST | `/api/demo-requests/:id/transition` | `start_review`, `needs_information`, `reject`, `approve`, `retry` |

Invalid transitions and stale versions return 409.

## Portal (Operator caller)

`PUT /service/v1/customers/:customerId/memberships/:normalizedEmail`

Authorization: `OPERATOR_CALLER_TOKEN` only. Customer Access JWTs and machine keys cannot call it.

Creates or reactivates membership idempotently. Cross-customer email conflict → 409 without leaking the other tenant id.
