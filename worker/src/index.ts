/**
 * Hivarium Operator Console — production Worker entrypoint.
 *
 * This file is deliberately thin: it wraps the shared application core from
 * `./app` with no extensions, so the deployed surface contains exactly the
 * production behavior —
 *
 *   * `/api/*` — the purpose-built API, authenticated by Cloudflare Access
 *     JWT verification (D-03) and nothing else. Requests are never
 *     authenticated by configuration flags; invalid or missing identities
 *     receive a stable 401 envelope and no route logic runs.
 *   * everything else — the static SPA assets with SPA fallback.
 *
 * No other routes and no test-only surface exist in this file or anywhere
 * else in the production bundle defined by `wrangler.jsonc`.
 */

import { createApp, type Env } from "./app";

const app = createApp<Env>();

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export type { Env };
export type { AuditEntry } from "./app";
