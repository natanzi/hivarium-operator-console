/**
 * Hivarium Operator Console — E2E-test-only Worker entrypoint.
 *
 * This entrypoint wraps the shared production core (`worker/src/app.ts`)
 * with two test extensions that are never part of the deployed Worker:
 *
 *   1. Deterministic auth identity — when `E2E_TEST_AUTH` is `"true"`, the
 *      Access JWT verification is bypassed for the duration of local E2E
 *      runs and requests are attributed to the configured operator email.
 *      Any other value (including unset) falls back to real JWT
 *      verification, so a misconfigured run still fails closed.
 *   2. `POST /api/e2e/reset` — drops every customer-scoped row (respecting
 *      the append-only triggers), then re-seeds the deterministic store and
 *      agent catalog. Only callable when `E2E_TEST_AUTH` is `"true"`.
 *
 * Both extensions are implemented in this file only. The production
 * `wrangler.jsonc` points at `worker/src/index.ts`, so neither the reset
 * route nor the auth override can ship.
 *
 * Wiring: `wrangler.e2e.jsonc` points at this file and is only ever passed
 * to `npm run test:e2e`. It adds `E2E_TEST_AUTH: "true"` as a var that no
 * production config sets.
 */

import { createApp, type Env } from "../src/app";
import {
  authenticateRequest,
  type OperatorIdentity,
} from "../src/auth";
import { buildSeedStore } from "../../src/data/seed-data";
import {
  buildAuditEntry,
  commitStoreDiff,
  diffStores,
} from "../src/db";
import type { DataStore } from "../../src/domain/types";

/** E2E extensions on top of the production bindings. */
interface E2EEnv extends Env {
  /** When `"true"`, enables the deterministic test identity (see header). */
  E2E_TEST_AUTH?: string;
}

/**
 * Test-only reset statements: drop the append-only triggers so the
 * customer-scoped rows can be cleared, then restore the identical triggers.
 * Mirrors the reset behavior of the original single-file Worker entry.
 */
const RESET_STATEMENTS: readonly string[] = [
  "DROP TRIGGER IF EXISTS ledger_transactions_no_delete;",
  "DROP TRIGGER IF EXISTS usage_records_no_delete;",
  "DROP TRIGGER IF EXISTS audit_entries_no_delete;",
  "DROP TRIGGER IF EXISTS customers_no_delete_with_dependents;",
  "DELETE FROM usage_records;",
  "DELETE FROM ledger_transactions;",
  "DELETE FROM commercial_arrangements;",
  "DELETE FROM agent_access_grants;",
  "DELETE FROM activity_events;",
  "DELETE FROM audit_entries;",
  "DELETE FROM feature_entitlements;",
  "DELETE FROM customers;",
  "CREATE TRIGGER ledger_transactions_no_delete BEFORE DELETE ON ledger_transactions BEGIN SELECT RAISE(ABORT, 'ledger_transactions is append-only, deletes are forbidden.'); END;",
  "CREATE TRIGGER usage_records_no_delete BEFORE DELETE ON usage_records BEGIN SELECT RAISE(ABORT, 'usage_records is append-only, deletes are forbidden.'); END;",
  "CREATE TRIGGER audit_entries_no_delete BEFORE DELETE ON audit_entries BEGIN SELECT RAISE(ABORT, 'audit_entries is immutable, deletes are forbidden.'); END;",
  "CREATE TRIGGER customers_no_delete_with_dependents BEFORE DELETE ON customers BEGIN SELECT RAISE(ABORT, 'customers cannot be deleted, archive instead.') WHERE EXISTS (SELECT 1 FROM commercial_arrangements WHERE customer_id = OLD.id) OR EXISTS (SELECT 1 FROM agent_access_grants WHERE customer_id = OLD.id) OR EXISTS (SELECT 1 FROM activity_events WHERE customer_id = OLD.id) OR EXISTS (SELECT 1 FROM ledger_transactions WHERE customer_id = OLD.id) OR EXISTS (SELECT 1 FROM usage_records WHERE customer_id = OLD.id) OR EXISTS (SELECT 1 FROM feature_entitlements WHERE customer_id = OLD.id); END;",
];

function emptyStore(): DataStore {
  return {
    schemaVersion: 4,
    customers: [],
    commercialArrangements: [],
    agentAccessGrants: [],
    activityEvents: [],
    ledgerTransactions: [],
    usageRecords: [],
    featureEntitlements: [],
    agentProducts: [],
  };
}

// ---------------------------------------------------------------------------
// Test-only `POST /api/e2e/reset` handler (never shipped).
// ---------------------------------------------------------------------------

/**
 * Pre-auth interceptor: handles `POST /api/e2e/reset` when test auth is
 * enabled and returns `null` for every other route so the shared
 * auth + route pipeline takes over.
 */
async function e2eResetInterceptApi(
  request: Request,
  env: E2EEnv,
  url: URL
): Promise<Response | null> {
  if (!(request.method === "POST" && url.pathname === "/api/e2e/reset")) {
    return null;
  }
  if (env.E2E_TEST_AUTH !== "true") {
    return json(
      { error: { code: "e2e-reset-disabled", message: "E2E_TEST_AUTH is not enabled." } },
      403
    );
  }

  const demoTables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'demo_requests'",
  ).first<{ name: string }>();
  if (demoTables) {
    await env.DB.exec(`
      DROP TRIGGER IF EXISTS demo_request_events_no_update;
      DROP TRIGGER IF EXISTS demo_request_events_no_delete;
      DELETE FROM demo_email_outbox;
      DELETE FROM demo_provisioning_jobs;
      DELETE FROM demo_request_events;
      DELETE FROM demo_requests;
      CREATE TRIGGER IF NOT EXISTS demo_request_events_no_update BEFORE UPDATE ON demo_request_events BEGIN SELECT RAISE(ABORT, 'demo_request_events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS demo_request_events_no_delete BEFORE DELETE ON demo_request_events BEGIN SELECT RAISE(ABORT, 'demo_request_events are append-only'); END;
    `);
  }

  for (const stmt of RESET_STATEMENTS) {
    await env.DB.prepare(stmt).run();
  }

  // Re-seed using the canonical utility.
  const diff = diffStores(emptyStore(), buildSeedStore());
  await commitStoreDiff(
    env.DB,
    diff,
    buildAuditEntry({
      identity: { email: "e2e@hivarium.test", sub: "e2e", name: "E2E" },
      action: "reseed_for_e2e",
      customerId: "",
      subjectType: "system",
      subjectId: "e2e",
      summary: "E2E seed reset",
      occurredAt: new Date().toISOString(),
    })
  );

  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Test-only auth override (never shipped).
// ---------------------------------------------------------------------------

/**
 * Auth override: when `E2E_TEST_AUTH` is `"true"`, returns the deterministic
 * E2E operator identity matching the original single-file Worker entry.
 * Otherwise defers to real Cloudflare Access JWT verification (fail closed).
 */
type AuthResult =
  | { ok: true; identity: OperatorIdentity }
  | { ok: false; reason: string };

async function e2eAuthenticate(
  request: Request,
  env: E2EEnv
): Promise<AuthResult> {
  if (env.E2E_TEST_AUTH === "true") {
    return {
      ok: true,
      identity: {
        email: env.AUTHORIZED_OPERATOR_EMAIL,
        sub: "e2e-sub",
        name: "E2E Operator",
      },
    };
  }
  return authenticateRequest(request, {
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    audience: env.ACCESS_AUD,
    authorizedEmails: [env.AUTHORIZED_OPERATOR_EMAIL],
  });
}

// ---------------------------------------------------------------------------
// Response helper (test-only; the production core keeps its own private one).
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Operator data must never be cached by the browser, a CDN, or a proxy.
      "cache-control": "no-store",
    },
  });
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

const app = createApp<E2EEnv>({
  interceptApi: e2eResetInterceptApi,
  authenticate: e2eAuthenticate,
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<E2EEnv>;
