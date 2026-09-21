/**
 * Hivarium Operator Console — shared Worker application (Phase 3, D-01..D-07).
 *
 * This module owns the whole request-handling pipeline and is the single
 * source of truth used by every Worker entrypoint:
 *
 *   * `worker/src/index.ts` (production) wraps {@link createApp} with no
 *     extensions, so the deployed surface has exactly one auth path —
 *     Cloudflare Access JWT verification (D-03) — and no test-only routes.
 *   * `worker/test/e2e-entry.ts` (local E2E only) wraps the same core with
 *     test-only extensions: a deterministic auth identity.
 *
 * The core itself serves both surfaces of one Worker:
 *   * `/api/*` — the purpose-built API. Every request is authenticated
 *     before any route logic runs; missing/invalid tokens get a stable 401
 *     envelope.
 *   * everything else — the static SPA assets with SPA fallback.
 *
 * Every mutation handler validates its typed DTO, loads the current rows,
 * runs the shared pure rules from `src/domain` (the server is authoritative,
 * D-07), produces the next-state rows plus one immutable audit entry, and
 * commits everything in one `env.DB.batch()` transaction (D-06).
 *
 * The endpoint surface maps one-to-one to console workflows: no generic CRUD
 * and no DELETE /api/customers/:id — archive replaces delete (D-05).
 */

import {
  authenticateRequest,
  type OperatorIdentity,
} from "./auth";
import {
  buildAuditEntry,
  commitStoreDiff,
  diffStores,
  getAgentProduct,
  getCustomer,
  listAgentProducts,
  listAuditEntries,
  listCustomers,
  loadCustomerStore,
  seedCatalog,
} from "./db";
import type { AuditEntry } from "./db";
import {
  normalizeCustomerStatus,
  type ActivityEvent,
  type AgentAccessGrant,
  type Customer,
  type DataStore,
  type LedgerTransaction,
  type LedgerTransactionKind,
  type PrepaidCommercialArrangement,
} from "../../src/domain/types";
import {
  applyAccessRevocation,
  applyCommercialTransition,
  commercialTerminatedEventId,
  findConflictingAccessGrant,
  projectCommercialState,
  reconcileCommercialLifecycle,
  resolveAgentAccessStatus,
  validateAgentAccessGrant,
  type AgentAccessGrantInput,
  type CommercialArrangementInput,
} from "../../src/domain/commercial-rules";
import {
  applyManualAdjustment,
  assertNoNegativeBalance,
  creditGrantTransactionId,
  deriveTokenBalance,
  filterStatement,
  groupUsageByAgent,
  normalizeUsageFingerprint,
  projectAccountStatement,
  recordUsage,
  reverseTransaction as applyReversal,
  sumPeriodUsage,
  validateLedgerTransaction,
  validateUsageIdempotency,
  type UsageAggregationFilter,
  type UsagePeriod,
} from "../../src/domain/ledger-rules";
import { handleLicensesApi, handleRequestsApi, licenseAdapter } from "./api-extensions";
import { handleLandingDemoIntake, handleOperatorDemoApi } from "./demo/http";

/**
 * Production environment bindings (D-01, D-03). This is the complete and
 * final Env for the deployed Worker — no test-only keys. Test entrypoints
 * widen it with their own extension interface via {@link createApp}.
 */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  LICENSE_SERVICE: Fetcher;
  CUSTOMER_PORTAL_SERVICE: Fetcher;
  LICENSE_SERVICE_TOKEN: string;
  PORTAL_SERVICE_TOKEN: string;
  PORTAL_CALLER_TOKEN: string;
  /** Inbound Landing site token for POST /service/v1/demo-requests. */
  LANDING_CALLER_TOKEN?: string;
  /** Operator notification recipient for demo intake. */
  OPERATOR_NOTIFY_EMAIL?: string;
  /** Transactional email provider secret. `test://memory` is tests-only. */
  EMAIL_PROVIDER_API_KEY?: string;
  /** Sender identity for the provider payload `from` field. */
  EMAIL_FROM_ADDRESS?: string;
  /** Reply address for the provider payload `reply_to` field. */
  EMAIL_REPLY_TO?: string;
  /** Provider HTTP endpoint. Defaults to `https://api.resend.com/emails`. */
  EMAIL_PROVIDER_URL?: string;
  /** Public Customer Portal origin used in customer emails. Never hardcoded. */
  CUSTOMER_PORTAL_URL?: string;
  /** Optional Agent Workspace origin. Omitted from welcome email when unset. */
  AGENT_WORKSPACE_URL?: string;
  /** Local-only origin for License Service. Never set in production. */
  LICENSE_SERVICE_URL?: string;
  /** Local-only origin for Customer Portal. Never set in production. */
  CUSTOMER_PORTAL_SERVICE_URL?: string;
  /** Access team domain, e.g. `example.cloudflareaccess.com`. */
  ACCESS_TEAM_DOMAIN: string;
  /** Access application AUD carried in the JWT `aud` claim. */
  ACCESS_AUD: string;
  /** Restricts access to exactly this email (Plan 03-01 authorization requirement). */
  AUTHORIZED_OPERATOR_EMAIL: string;
}

// ---------------------------------------------------------------------------
// Response and error helpers
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

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

function errorResponse(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new Error("Body must be a JSON object.");
    }
    return body as Record<string, unknown>;
  } catch {
    throw new ApiError(
      400,
      "validation-error",
      "Request body must be a JSON object."
    );
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function bodyTimestamp(body: Record<string, unknown>): string {
  return typeof body.occurredAt === "string" && body.occurredAt.length > 0
    ? body.occurredAt
    : nowIso();
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, "validation-error", `${key} is required.`);
  }
  return value.trim();
}

/**
 * Run a shared pure rule and map its descriptive rejection to the stable 409
 * conflict envelope. Validation problems are checked explicitly before the
 * transition; anything the rules reject here is a lifecycle/ledger conflict.
 */
function guardConflict<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Rule validation failed.";
    throw new ApiError(409, "conflict", message);
  }
}

function requireCustomer(
  store: DataStore,
  customerId: string
): Customer {
  const customer = store.customers.find((c) => c.id === customerId);
  if (!customer) {
    throw new ApiError(
      404,
      "not-found",
      `Customer "${customerId}" does not exist.`
    );
  }
  return customer;
}

/**
 * Reject mutations on archived customers (D-05, SAFE-01): archived profiles
 * are read-only, so new usage, credit, access, and commercial changes are
 * forbidden while every retained record stays readable.
 */
function requireNotArchived(customer: Customer): Customer {
  if (customer.status === "archived") {
    throw new ApiError(
      409,
      "conflict",
      `Customer "${customer.id}" is archived; new usage, credit, and access changes are not allowed.`
    );
  }
  return customer;
}

function requireActivePrepaid(
  store: DataStore,
  customerId: string,
  occurredAt: string
): PrepaidCommercialArrangement {
  const active = projectCommercialState(
    store.commercialArrangements,
    occurredAt
  ).active;
  if (!active || active.model !== "prepaid") {
    throw new ApiError(
      409,
      "conflict",
      `Customer "${customerId}" does not have an active prepaid arrangement.`
    );
  }
  return active;
}

// ---------------------------------------------------------------------------
// Catalog seeding (D-11): idempotent, once per isolate
// ---------------------------------------------------------------------------

/**
 * Idempotent, once-per-instance agent-catalog seed (D-11). The promise lives
 * on the `seed` object instead of a module global so each app instance
 * (production and test entrypoints) tracks its own seeding state.
 */
function createCatalogSeeder(env: Env): { ensureSeeded: () => Promise<void> } {
  let seeding: Promise<void> | null = null;
  function ensureSeeded(): Promise<void> {
    if (seeding === null) {
      seeding = seedCatalog(env.DB).catch((error) => {
        seeding = null;
        throw error;
      });
    }
    return seeding;
  }
  return { ensureSeeded };
}

// ---------------------------------------------------------------------------
// Customer handlers
// ---------------------------------------------------------------------------

async function handleCreateCustomer(
  request: Request,
  env: Env,
  identity: OperatorIdentity
): Promise<Response> {
  const body = await readJson(request);
  const id = requireString(body, "id");
  const name = requireString(body, "name");
  const domain = requireString(body, "domain");
  const contact = requireString(body, "contact");
  const email = requireString(body, "email");
  const status = normalizeCustomerStatus(body.status);
  const notes = typeof body.notes === "string" ? body.notes : "";
  const createdAt = bodyTimestamp(body);

  const existing = await getCustomer(env.DB, id);
  if (existing) {
    throw new ApiError(
      409,
      "conflict",
      `Customer with id "${id}" already exists.`
    );
  }

  const customer: Customer = {
    id,
    name,
    domain,
    contact,
    email,
    status,
    notes,
    createdAt,
  };
  const before = await loadCustomerStore(env.DB, id);
  const after: DataStore = {
    ...before,
    customers: [...before.customers, customer],
  };
  const diff = diffStores(before, after);
  const audit = buildAuditEntry({
    identity,
    action: "customer.created",
    customerId: id,
    subjectType: "customer",
    subjectId: id,
    summary: `Created customer "${name}".`,
    after: customer,
    occurredAt: createdAt,
  });
  await commitStoreDiff(env.DB, diff, audit);
  return json({ customer }, 201);
}

async function handleUpdateCustomer(
  request: Request,
  env: Env,
  customerId: string,
  identity: OperatorIdentity
): Promise<Response> {
  const input = await request.json<{
    name: string;
    domain: string;
    contact: string;
    email?: string;
  }>();
  const before = await loadCustomerStore(env.DB, customerId);
  const existing = requireNotArchived(requireCustomer(before, customerId));

  const updated: Customer = {
    ...existing,
    name: input.name,
    domain: input.domain,
    contact: input.contact,
  };

  const after: DataStore = {
    ...before,
    customers: before.customers.map((c) => (c.id === customerId ? updated : c)),
  };

  const diff = diffStores(before, after);
  const occurredAt = new Date().toISOString();
  const audit = buildAuditEntry({
    identity,
    action: "customer.updated",
    customerId,
    subjectType: "customer",
    subjectId: customerId,
    summary: `Updated customer details for "${input.name}".`,
    before: { name: existing.name, domain: existing.domain, contact: existing.contact },
    after: { name: updated.name, domain: updated.domain, contact: updated.contact },
    occurredAt,
  });

  await commitStoreDiff(env.DB, diff, audit);
  return json({ customer: updated });
}

async function handleArchiveCustomer(
  request: Request,
  env: Env,
  customerId: string,
  identity: OperatorIdentity
): Promise<Response> {
  const body = await readJson(request);
  const occurredAt = bodyTimestamp(body);
  const before = await loadCustomerStore(env.DB, customerId);
  const customer = requireCustomer(before, customerId);
  if (customer.status === "archived") {
    throw new ApiError(
      409,
      "conflict",
      `Customer "${customerId}" is already archived.`
    );
  }

  const archived: Customer = { ...customer, status: "archived" };
  const event: ActivityEvent = {
    id: `evt_${customerId}_archived`,
    occurredAt,
    source: "operator",
    type: "customer.archived",
    customerId,
    label: `Archived customer "${customer.name}".`,
    subjectId: customerId,
    resultingState: "archived",
  };
  const after: DataStore = {
    ...before,
    customers: before.customers.map((c) =>
      c.id === customerId ? archived : c
    ),
    activityEvents: [...before.activityEvents, event],
  };
  const diff = diffStores(before, after);
  const audit = buildAuditEntry({
    identity,
    action: "customer.archived",
    customerId,
    subjectType: "customer",
    subjectId: customerId,
    summary: `Archived customer "${customer.name}".`,
    before: { status: customer.status },
    after: { status: "archived" },
    occurredAt,
  });
  await commitStoreDiff(env.DB, diff, audit);
  return json({ customer: archived });
}

// ---------------------------------------------------------------------------
// Commercial handlers
// ---------------------------------------------------------------------------

async function handleGetCommercial(
  env: Env,
  customerId: string
): Promise<Response> {
  const store = await loadCustomerStore(env.DB, customerId);
  requireCustomer(store, customerId);
  const asOf = nowIso();
  const projection = projectCommercialState(store.commercialArrangements, asOf);
  return json({
    customerId,
    asOf,
    active: projection.active,
    scheduled: projection.scheduled,
    history: projection.history,
  });
}

async function handleSaveCommercial(
  request: Request,
  env: Env,
  customerId: string,
  identity: OperatorIdentity
): Promise<Response> {
  const body = await readJson(request);
  const occurredAt = bodyTimestamp(body);
  const input: CommercialArrangementInput = {
    ...body,
    customerId,
    createdAt: body.createdAt ?? occurredAt,
  };
  const before = await loadCustomerStore(env.DB, customerId);
  requireNotArchived(requireCustomer(before, customerId));

  const result = guardConflict(() =>
    applyCommercialTransition(before, input, occurredAt)
  );
  const diff = diffStores(before, result.store);
  const audit = buildAuditEntry({
    identity,
    action: "commercial.created",
    customerId,
    subjectType: "commercial_arrangement",
    subjectId: result.arrangement.id,
    summary: `Created ${result.arrangement.model} commercial arrangement.`,
    after: result.arrangement,
    occurredAt,
  });
  await commitStoreDiff(env.DB, diff, audit);
  return json({ arrangement: result.arrangement }, 201);
}

async function handleTerminateCommercial(
  request: Request,
  env: Env,
  customerId: string,
  arrangementId: string,
  identity: OperatorIdentity
): Promise<Response> {
  const body = await readJson(request);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length === 0) {
    throw new ApiError(400, "validation-error", "reason is required.");
  }
  const occurredAt = bodyTimestamp(body);
  const before = await loadCustomerStore(env.DB, customerId);
  const arrangement = before.commercialArrangements.find(
    (a) => a.id === arrangementId && a.customerId === customerId
  );
  if (!arrangement) {
    throw new ApiError(
      404,
      "not-found",
      `Commercial arrangement with id "${arrangementId}" does not exist.`
    );
  }
  if (arrangement.status === "terminated") {
    throw new ApiError(
      409,
      "conflict",
      `Commercial arrangement "${arrangementId}" is already terminated.`
    );
  }

  const triggerEventId = commercialTerminatedEventId(arrangement.id);
  const triggerEvent: ActivityEvent = {
    id: triggerEventId,
    occurredAt,
    source: "operator",
    type: "commercial.terminated",
    customerId,
    label: `Terminated ${arrangement.model} commercial arrangement.`,
    subjectId: arrangement.id,
    resultingState: "terminated",
  };
  let next: DataStore = {
    ...before,
    commercialArrangements: before.commercialArrangements.map((a) =>
      a.id === arrangement.id
        ? { ...a, status: "terminated", effectiveTo: occurredAt, reason }
        : a
    ),
    activityEvents: [...before.activityEvents, triggerEvent],
  };

  const activeGrants = before.agentAccessGrants.filter(
    (g) =>
      g.customerId === customerId &&
      resolveAgentAccessStatus(g, occurredAt) === "active"
  );
  for (const grant of activeGrants) {
    const result = guardConflict(() =>
      applyAccessRevocation(next, {
        grantId: grant.id,
        customerId,
        reason,
        effectiveAt: occurredAt,
        occurredAt,
        source: "system",
        causationId: triggerEventId,
      })
    );
    next = result.store;
  }

  const diff = diffStores(before, next);
  const audit = buildAuditEntry({
    identity,
    action: "commercial.terminated",
    customerId,
    subjectType: "commercial_arrangement",
    subjectId: arrangement.id,
    summary: `Terminated ${arrangement.model} commercial arrangement.`,
    before: { status: arrangement.status },
    after: { status: "terminated" },
    occurredAt,
  });
  await commitStoreDiff(env.DB, diff, audit);
  const terminated = next.commercialArrangements.find(
    (a) => a.id === arrangement.id
  );
  return json({ arrangement: terminated });
}

async function handleReconcileCommercial(
  request: Request,
  env: Env,
  customerId: string,
  identity: OperatorIdentity
): Promise<Response> {
  const body = await readJson(request);
  const asOf =
    typeof body.asOf === "string" && body.asOf.trim().length > 0
      ? body.asOf.trim()
      : nowIso();
  if (Number.isNaN(Date.parse(asOf))) {
    throw new ApiError(
      400,
      "validation-error",
      "asOf must be a valid ISO-8601 timestamp."
    );
  }

  const before = await loadCustomerStore(env.DB, customerId);
  requireCustomer(before, customerId);

  const result = reconcileCommercialLifecycle(before, customerId, asOf);
  const diff = diffStores(before, result.store);
  const audit = buildAuditEntry({
    identity,
    action: "commercial.lifecycle_reconciled",
    customerId,
    subjectType: "commercial_arrangement",
    subjectId: customerId,
    summary: `Reconciled commercial lifecycle at ${asOf}.`,
    after: {
      activeCount: result.store.commercialArrangements.filter(
        (a) => a.customerId === customerId && a.status === "active"
      ).length,
    },
    occurredAt: asOf,
  });
  await commitStoreDiff(env.DB, diff, audit);
  return json({ customerId, asOf, changed: result.changed });
}

// ---------------------------------------------------------------------------
// Agent access handlers
// ---------------------------------------------------------------------------

async function handleGetAccess(
  env: Env,
  customerId: string
): Promise<Response> {
  const store = await loadCustomerStore(env.DB, customerId);
  requireCustomer(store, customerId);
  const asOf = nowIso();
  const current = store.agentAccessGrants.filter(
    (grant) => resolveAgentAccessStatus(grant, asOf) === "active"
  );
  const scheduled = store.agentAccessGrants.filter(
    (grant) => resolveAgentAccessStatus(grant, asOf) === "scheduled"
  );
  const history = store.agentAccessGrants
    .filter((grant) => {
      const status = resolveAgentAccessStatus(grant, asOf);
      return status === "expired" || status === "revoked";
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return json({ customerId, asOf, current, scheduled, history });
}

async function handleGrantAccess(
  request: Request,
  env: Env,
  customerId: string,
  identity: OperatorIdentity
): Promise<Response> {
  const body = await readJson(request);
  const occurredAt = bodyTimestamp(body);
  const input: AgentAccessGrantInput = {
    ...body,
    customerId,
    createdAt: body.createdAt ?? occurredAt,
  };
  const validation = validateAgentAccessGrant(input);
  if (!validation.ok) {
    throw new ApiError(400, "validation-error", validation.problems.join(" "));
  }

  const before = await loadCustomerStore(env.DB, customerId);
  requireNotArchived(requireCustomer(before, customerId));
  const agentProductId = input.agentProductId as string;
  if (!before.agentProducts.some((p) => p.id === agentProductId)) {
    throw new ApiError(
      404,
      "not-found",
      `Agent product with id "${agentProductId}" does not exist.`
    );
  }
  const conflict = findConflictingAccessGrant(
    before.agentAccessGrants,
    { customerId, agentProductId },
    occurredAt
  );
  if (conflict) {
    throw new ApiError(
      409,
      "conflict",
      `Customer "${customerId}" already has active or scheduled access to agent product "${agentProductId}".`
    );
  }

  const grantId =
    (input.id as string | undefined) ??
    `grant_${customerId}_${agentProductId}_${occurredAt}`;
  const eventId = `evt_${grantId}`;
  const grant: AgentAccessGrant = {
    id: grantId,
    customerId,
    agentProductId,
    startsAt: input.startsAt as string,
    endsAt: (input.endsAt as string | null) ?? null,
    createdAt: occurredAt,
    revokedAt: null,
    scheduledRevokeAt: null,
    activityEventId: eventId,
    reasonForChange: input.reasonForChange as string,
  };
  const event: ActivityEvent = {
    id: eventId,
    occurredAt,
    source: "operator",
    type: "access.granted",
    customerId,
    label: `Granted access to agent product "${agentProductId}".`,
    subjectId: grant.id,
    subjectId2: agentProductId,
    resultingState: "active",
  };
  const after: DataStore = {
    ...before,
    agentAccessGrants: [...before.agentAccessGrants, grant],
    activityEvents: [...before.activityEvents, event],
  };
  const diff = diffStores(before, after);
  const audit = buildAuditEntry({
    identity,
    action: "access.granted",
    customerId,
    subjectType: "agent_access_grant",
    subjectId: grant.id,
    summary: `Granted access to agent product "${agentProductId}".`,
    after: grant,
    occurredAt,
  });
  await commitStoreDiff(env.DB, diff, audit);
  return json({ grant }, 201);
}

async function handleRevokeAccess(
  request: Request,
  env: Env,
  customerId: string,
  grantId: string,
  identity: OperatorIdentity
): Promise<Response> {
  const body = await readJson(request);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length === 0) {
    throw new ApiError(400, "validation-error", "reason is required.");
  }
  const occurredAt = bodyTimestamp(body);
  const effectiveAt =
    typeof body.effectiveAt === "string" && body.effectiveAt.length > 0
      ? body.effectiveAt
      : occurredAt;

  const before = await loadCustomerStore(env.DB, customerId);
  const grant = before.agentAccessGrants.find(
    (g) => g.id === grantId && g.customerId === customerId
  );
  if (!grant) {
    throw new ApiError(
      404,
      "not-found",
      `Agent access grant with id "${grantId}" does not exist.`
    );
  }
  const result = guardConflict(() =>
    applyAccessRevocation(before, {
      grantId,
      customerId,
      reason,
      effectiveAt,
      occurredAt,
      source: "operator",
    })
  );
  const diff = diffStores(before, result.store);
  const audit = buildAuditEntry({
    identity,
    action: "access.revoked",
    customerId,
    subjectType: "agent_access_grant",
    subjectId: grant.id,
    summary: `Revoked access to agent product "${grant.agentProductId}".`,
    before: {
      revokedAt: grant.revokedAt,
      scheduledRevokeAt: grant.scheduledRevokeAt,
    },
    after: {
      revokedAt: result.grant.revokedAt,
      scheduledRevokeAt: result.grant.scheduledRevokeAt,
    },
    occurredAt,
  });
  await commitStoreDiff(env.DB, diff, audit);
  return json({ grant: result.grant });
}

// ---------------------------------------------------------------------------
// Ledger handlers (append-only, derived balances — D-12)
// ---------------------------------------------------------------------------

async function handleGetLedger(
  env: Env,
  customerId: string
): Promise<Response> {
  const store = await loadCustomerStore(env.DB, customerId);
  requireCustomer(store, customerId);
  const rows = projectAccountStatement(store.ledgerTransactions, customerId);
  return json({ customerId, rows });
}

export async function checkLedgerAutoSuspend(env: Env, customerId: string, identity: OperatorIdentity, afterStore: DataStore): Promise<void> {
  const prepaid = afterStore.commercialArrangements.find(a => a.status === "active" && a.model === "prepaid");
  if (!prepaid) return;

  const currentBalance = deriveTokenBalance(afterStore.ledgerTransactions, customerId);
  const adapter = licenseAdapter(env);
  const licenses = await adapter.listLicenses(customerId);

  if (currentBalance <= 0) {
    for (const lic of licenses) {
      if (lic.status === "active" || lic.status === "draft") {
        await adapter.suspendLicense(lic.id, {
          idempotencyKey: `aus-${lic.id}-${Date.now()}`,
          reason: "prepaid_balance_zero"
        });
        await env.DB.prepare("INSERT OR REPLACE INTO license_auto_suspensions (license_id, reason, suspended_at) VALUES (?, ?, ?)").bind(lic.id, "prepaid_balance_zero", nowIso()).run();

        const audit = buildAuditEntry({
          identity, action: "license.auto_suspended", customerId, subjectType: "license", subjectId: lic.id,
          summary: `Auto-suspended license ${lic.id} due to zero balance.`,
          after: lic, occurredAt: nowIso()
        });
        await commitStoreDiff(env.DB, diffStores(afterStore, afterStore), audit);
      }
    }
  } else {
    for (const lic of licenses) {
      if (lic.status === "suspended") {
        const marker = await env.DB.prepare("SELECT * FROM license_auto_suspensions WHERE license_id = ?").bind(lic.id).first();
        if (marker && marker.reason === "prepaid_balance_zero") {
          await adapter.resumeLicense(lic.id, {
            idempotencyKey: `aur-${lic.id}-${Date.now()}`,
            reason: "prepaid_balance_restored"
          });
          await env.DB.prepare("DELETE FROM license_auto_suspensions WHERE license_id = ?").bind(lic.id).run();

          const audit = buildAuditEntry({
            identity, action: "license.auto_resumed", customerId, subjectType: "license", subjectId: lic.id,
            summary: `Auto-resumed license ${lic.id} due to positive balance.`,
            after: lic, occurredAt: nowIso()
          });
          await commitStoreDiff(env.DB, diffStores(afterStore, afterStore), audit);
        }
      }
    }
  }
}

async function handleAddCredit(
  request: Request,
  env: Env,
  customerId: string,
  identity: OperatorIdentity
): Promise<Response> {
  const body = await readJson(request);
  const occurredAt = bodyTimestamp(body);
  const amountTokens = body.amountTokens;
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";

  const before = await loadCustomerStore(env.DB, customerId);
  requireNotArchived(requireCustomer(before, customerId));
  requireActivePrepaid(before, customerId, occurredAt);

  const transaction: LedgerTransaction = {
    id: creditGrantTransactionId(customerId, occurredAt),
    customerId,
    occurredAt,
    kind: "credit_grant",
    amountTokens: amountTokens as number,
    reason:
      typeof body.reason === "string" && body.reason.trim().length > 0
        ? body.reason.trim()
        : "Operator-confirmed token credit",
    reference,
  };
  const validation = validateLedgerTransaction(transaction);
  if (!validation.ok) {
    throw new ApiError(400, "validation-error", validation.problems.join(" "));
  }
  guardConflict(() =>
    assertNoNegativeBalance(
      before.ledgerTransactions,
      customerId,
      transaction.amountTokens
    )
  );

  const afterStore: DataStore = {
    ...before,
    ledgerTransactions: [...before.ledgerTransactions, transaction],
  };
  const diff = diffStores(before, afterStore);
  const audit = buildAuditEntry({
    identity,
    action: "ledger.credit_grant",
    customerId,
    subjectType: "ledger_transaction",
    subjectId: transaction.id,
    summary: `Granted ${transaction.amountTokens} tokens.`,
    after: transaction,
    occurredAt,
  });
  await commitStoreDiff(env.DB, diff, audit);
  await checkLedgerAutoSuspend(env, customerId, identity, afterStore);
  return json({ transaction }, 201);
}

async function handleRecordUsage(
  request: Request,
  env: Env,
  customerId: string,
  identity: OperatorIdentity
): Promise<Response> {
  const body = await readJson(request);
  const occurredAt = bodyTimestamp(body);
  const trimmedCustomerId = customerId.trim();

  const before = await loadCustomerStore(env.DB, trimmedCustomerId);
  requireNotArchived(requireCustomer(before, trimmedCustomerId));
  requireActivePrepaid(before, trimmedCustomerId, occurredAt);

  const agentProductId =
    typeof body.agentProductId === "string" ? body.agentProductId.trim() : "";
  if (!before.agentProducts.some((p) => p.id === agentProductId)) {
    throw new ApiError(
      404,
      "not-found",
      `Agent product with id "${agentProductId}" does not exist.`
    );
  }

  const fingerprint = normalizeUsageFingerprint({
    customerId: trimmedCustomerId,
    agentProductId,
    sourceReference: body.sourceReference,
    occurredAt,
    tokenQuantity: body.tokenQuantity,
  });
  if (!fingerprint) {
    throw new ApiError(
      400,
      "validation-error",
      "Usage requires a customer, agent product, positive whole token quantity, canonical ISO occurredAt, and a source reference."
    );
  }

  // Idempotency (D-09): an exact replay returns the existing pair without
  // writing; a conflicting reuse of the source reference is rejected.
  const existing = before.usageRecords.find(
    (usage) => usage.sourceReference === fingerprint.sourceReference
  );
  if (existing) {
    guardConflict(() => validateUsageIdempotency(existing, fingerprint));
    const existingTransaction = before.ledgerTransactions.find(
      (transaction) => transaction.id === existing.ledgerTransactionId
    );
    if (!existingTransaction) {
      throw new ApiError(
        500,
        "internal-error",
        `Usage record "${existing.id}" is missing its linked ledger transaction.`
      );
    }
    return json({
      usage: existing,
      transaction: existingTransaction,
      replay: true,
    });
  }

  const result = guardConflict(() =>
    recordUsage(
      before,
      {
        customerId: trimmedCustomerId,
        agentProductId,
        tokenQuantity: fingerprint.tokenQuantity,
        sourceReference: fingerprint.sourceReference,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      },
      occurredAt
    )
  );
  const diff = diffStores(before, result.store);
  const audit = buildAuditEntry({
    identity,
    action: "ledger.usage_debit",
    customerId: trimmedCustomerId,
    subjectType: "usage_record",
    subjectId: result.usage.id,
    summary: `Recorded ${fingerprint.tokenQuantity} tokens of usage for "${agentProductId}".`,
    after: { usage: result.usage, transaction: result.transaction },
    occurredAt,
  });
  await commitStoreDiff(env.DB, diff, audit);
  await checkLedgerAutoSuspend(env, trimmedCustomerId, identity, result.store);
  return json(
    { usage: result.usage, transaction: result.transaction, replay: false },
    201
  );
}

async function handleAddAdjustment(
  request: Request,
  env: Env,
  customerId: string,
  identity: OperatorIdentity
): Promise<Response> {
  const body = await readJson(request);
  const occurredAt = bodyTimestamp(body);

  const before = await loadCustomerStore(env.DB, customerId);
  requireNotArchived(requireCustomer(before, customerId));
  requireActivePrepaid(before, customerId, occurredAt);

  const result = guardConflict(() =>
    applyManualAdjustment(
      before,
      {
        customerId,
        amountTokens: body.amountTokens as number,
        reference: typeof body.reference === "string" ? body.reference : "",
        reason: typeof body.reason === "string" ? body.reason : "",
      },
      occurredAt
    )
  );
  const diff = diffStores(before, result.store);
  const audit = buildAuditEntry({
    identity,
    action: "ledger.manual_adjustment",
    customerId,
    subjectType: "ledger_transaction",
    subjectId: result.transaction.id,
    summary: `Applied manual adjustment of ${result.transaction.amountTokens} tokens.`,
    after: result.transaction,
    occurredAt,
  });
  await commitStoreDiff(env.DB, diff, audit);
  await checkLedgerAutoSuspend(env, customerId, identity, result.store);
  return json({ transaction: result.transaction }, 201);
}

async function handleAddReversal(
  request: Request,
  env: Env,
  customerId: string,
  identity: OperatorIdentity
): Promise<Response> {
  const body = await readJson(request);
  const occurredAt = bodyTimestamp(body);
  const transactionId =
    typeof body.transactionId === "string" ? body.transactionId.trim() : "";

  const before = await loadCustomerStore(env.DB, customerId);
  requireNotArchived(requireCustomer(before, customerId));
  requireActivePrepaid(before, customerId, occurredAt);

  const result = guardConflict(() =>
    applyReversal(
      before,
      {
        customerId,
        transactionId,
        reference: typeof body.reference === "string" ? body.reference : "",
        reason: typeof body.reason === "string" ? body.reason : "",
      },
      occurredAt
    )
  );
  const diff = diffStores(before, result.store);
  const audit = buildAuditEntry({
    identity,
    action: "ledger.reversal",
    customerId,
    subjectType: "ledger_transaction",
    subjectId: result.transaction.id,
    summary: `Reversed ledger transaction "${transactionId}".`,
    after: result.transaction,
    occurredAt,
  });
  await commitStoreDiff(env.DB, diff, audit);
  await checkLedgerAutoSuspend(env, customerId, identity, result.store);
  return json({ transaction: result.transaction }, 201);
}

async function handleUpdateThreshold(
  request: Request,
  env: Env,
  customerId: string,
  identity: OperatorIdentity
): Promise<Response> {
  const body = await readJson(request);
  const thresholdTokens = body.thresholdTokens;
  if (
    typeof thresholdTokens !== "number" ||
    !Number.isFinite(thresholdTokens) ||
    !Number.isInteger(thresholdTokens) ||
    thresholdTokens < 0
  ) {
    throw new ApiError(
      400,
      "validation-error",
      "thresholdTokens must be a non-negative whole number."
    );
  }
  const occurredAt = nowIso();

  const before = await loadCustomerStore(env.DB, customerId);
  requireNotArchived(requireCustomer(before, customerId));
  const active = requireActivePrepaid(before, customerId, occurredAt);

  const updated: PrepaidCommercialArrangement = {
    ...active,
    warningThresholdTokens: thresholdTokens,
  };
  const after: DataStore = {
    ...before,
    commercialArrangements: before.commercialArrangements.map((a) =>
      a.id === active.id ? updated : a
    ),
  };
  const diff = diffStores(before, after);
  const audit = buildAuditEntry({
    identity,
    action: "ledger.threshold",
    customerId,
    subjectType: "commercial_arrangement",
    subjectId: active.id,
    summary: `Updated warning threshold to ${thresholdTokens} tokens.`,
    before: { warningThresholdTokens: active.warningThresholdTokens },
    after: { warningThresholdTokens: thresholdTokens },
    occurredAt,
  });
  await commitStoreDiff(env.DB, diff, audit);
  return json({ arrangement: updated });
}

// ---------------------------------------------------------------------------
// Usage summary handler
// ---------------------------------------------------------------------------

async function handleGetUsageSummary(
  env: Env,
  url: URL,
  customerId: string
): Promise<Response> {
  const store = await loadCustomerStore(env.DB, customerId);
  requireCustomer(store, customerId);

  const period: UsagePeriod = {
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  };
  const agentProductId = url.searchParams.get("agentProductId") ?? undefined;
  const typeParam = url.searchParams.get("type");
  const type =
    typeParam === null ? undefined : (typeParam as LedgerTransactionKind);
  const aggregationFilter: UsageAggregationFilter = { agentProductId, type };

  const statement = projectAccountStatement(
    store.ledgerTransactions,
    customerId
  );
  const rows = filterStatement(statement, {
    from: period.from,
    to: period.to,
    agentProductId,
    type,
  });
  const netTokensConsumed = sumPeriodUsage(
    store.ledgerTransactions,
    customerId,
    period,
    aggregationFilter
  );
  const agentNames = new Map(
    store.agentProducts.map((product) => [product.id, product.name])
  );
  const perAgent = groupUsageByAgent(
    store.ledgerTransactions,
    customerId,
    period,
    agentNames,
    aggregationFilter
  ).map((row) => ({
    ...row,
    agentName: agentNames.get(row.agentProductId) ?? row.agentProductId,
  }));
  return json({ customerId, rows, netTokensConsumed, perAgent });
}

// ---------------------------------------------------------------------------
// Route table (purpose-built, one endpoint per console workflow — D-02)
// ---------------------------------------------------------------------------

async function handleCustomers(
  request: Request,
  env: Env,
  url: URL,
  segments: string[],
  identity: OperatorIdentity
): Promise<Response> {
  const method = request.method;
  const rest = segments.slice(2);

  if (rest.length === 0) {
    if (method === "GET") {
      const status = url.searchParams.get("status") ?? undefined;
      return json({ customers: await listCustomers(env.DB, status) });
    }
    if (method === "POST") {
      return handleCreateCustomer(request, env, identity);
    }
    throw new ApiError(405, "method-not-allowed", "Method not allowed.");
  }

  const customerId = rest[0];

  if (rest.length === 1) {
    if (method === "GET") {
      const customer = await getCustomer(env.DB, customerId);
      if (!customer) {
        throw new ApiError(
          404,
          "not-found",
          `Customer "${customerId}" does not exist.`
        );
      }
      return json({ customer });
    }
    if (method === "PUT") {
      return handleUpdateCustomer(request, env, customerId, identity);
    }
    throw new ApiError(405, "method-not-allowed", "Method not allowed.");
  }

  if (rest[1] === "archive" && rest.length === 2 && method === "POST") {
    return handleArchiveCustomer(request, env, customerId, identity);
  }

  if (rest[1] === "commercial") {
    if (rest.length === 2) {
      if (method === "GET") return handleGetCommercial(env, customerId);
      if (method === "POST") {
        return handleSaveCommercial(request, env, customerId, identity);
      }
    }
    if (rest.length === 3 && rest[2] === "reconcile" && method === "POST") {
      return handleReconcileCommercial(request, env, customerId, identity);
    }
    if (rest.length === 4 && rest[3] === "terminate" && method === "POST") {
      return handleTerminateCommercial(
        request,
        env,
        customerId,
        rest[2],
        identity
      );
    }
    throw new ApiError(404, "not-found", "Unknown API route.");
  }

  if (rest[1] === "access") {
    if (rest.length === 2) {
      if (method === "GET") return handleGetAccess(env, customerId);
      if (method === "POST") {
        return handleGrantAccess(request, env, customerId, identity);
      }
    }
    if (rest.length === 4 && rest[3] === "revoke" && method === "POST") {
      return handleRevokeAccess(request, env, customerId, rest[2], identity);
    }
    throw new ApiError(404, "not-found", "Unknown API route.");
  }

  if (rest[1] === "ledger") {
    if (rest.length === 2 && method === "GET") {
      return handleGetLedger(env, customerId);
    }
    if (rest.length === 3) {
      if (rest[2] === "threshold" && method === "PUT") {
        return handleUpdateThreshold(request, env, customerId, identity);
      }
      if (method === "POST") {
        if (rest[2] === "credit") {
          return handleAddCredit(request, env, customerId, identity);
        }
        if (rest[2] === "usage") {
          return handleRecordUsage(request, env, customerId, identity);
        }
        if (rest[2] === "adjustment") {
          return handleAddAdjustment(request, env, customerId, identity);
        }
        if (rest[2] === "reversal") {
          return handleAddReversal(request, env, customerId, identity);
        }
      }
    }
    throw new ApiError(404, "not-found", "Unknown API route.");
  }

  if (rest[1] === "usage-summary" && rest.length === 2 && method === "GET") {
    return handleGetUsageSummary(env, url, customerId);
  }

  if (rest[1] === "audit" && rest.length === 2 && method === "GET") {
    const entries = await listAuditEntries(env.DB, customerId);
    return json({ entries });
  }

  if (rest[1] === "activity" && rest.length === 2 && method === "GET") {
    const store = await loadCustomerStore(env.DB, customerId);
    requireCustomer(store, customerId);
    return json({ events: store.activityEvents });
  }

  if (rest[1] === "features" && rest.length === 2 && method === "GET") {
    const store = await loadCustomerStore(env.DB, customerId);
    requireCustomer(store, customerId);
    return json({ entitlements: store.featureEntitlements });
  }

  throw new ApiError(404, "not-found", "Unknown API route.");
}

async function route(
  request: Request,
  env: Env,
  url: URL,
  identity: OperatorIdentity
): Promise<Response> {
  const method = request.method;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "api") {
    throw new ApiError(404, "not-found", "Unknown API route.");
  }
  const resource = segments[1];

  if (resource === "me") {
    if (method !== "GET") {
      throw new ApiError(405, "method-not-allowed", "Method not allowed.");
    }
    return json({ identity });
  }

  if (resource === "audit") {
    if (method !== "GET") {
      throw new ApiError(405, "method-not-allowed", "Method not allowed.");
    }
    const entries = await listAuditEntries(env.DB);
    return json({ entries });
  }

  if (resource === "agents") {
    if (method !== "GET") {
      throw new ApiError(405, "method-not-allowed", "Method not allowed.");
    }
    if (segments.length === 2) {
      return json({ products: await listAgentProducts(env.DB) });
    }
    if (segments.length === 3) {
      const product = await getAgentProduct(env.DB, segments[2]);
      if (!product) {
        throw new ApiError(
          404,
          "not-found",
          `Agent product "${segments[2]}" does not exist.`
        );
      }
      return json({ product });
    }
    if (segments.length === 4 && segments[3] === "customers") {
      const agentId = segments[2];
      const asOf = url.searchParams.get("asOf") || new Date().toISOString();
      // D-08: Authorized customers query
      const { results } = await env.DB.prepare(`
        SELECT
          c.id as customerId,
          c.name as customerName,
          g.agent_product_id as agentProductId,
          g.id as grantId,
          g.starts_at as startsAt,
          g.ends_at as endsAt,
          g.scheduled_revoke_at as scheduledRevokeAt
        FROM agent_access_grants g
        JOIN customers c ON c.id = g.customer_id
        WHERE g.agent_product_id = ?
          AND c.status NOT IN ('archived', 'churned')
      `).bind(agentId).all<any>();
      const rows = results.map(row => {
        let status = "scheduled";
        if (row.startsAt <= asOf && (!row.endsAt || row.endsAt > asOf)) {
          status = "active";
        }
        return {
          customerId: row.customerId,
          customerName: row.customerName,
          agentProductId: row.agentProductId,
          grantId: row.grantId,
          status,
          startsAt: row.startsAt,
          endsAt: row.endsAt || undefined,
          scheduledRevokeAt: row.scheduledRevokeAt || undefined,
        };
      });
      // Sort logic
      rows.sort((a, b) => a.customerName.localeCompare(b.customerName) || a.grantId.localeCompare(b.grantId));
      return json({ rows });
    }
    throw new ApiError(404, "not-found", "Unknown API route.");
  }

  if (resource === "demo-requests") {
    return handleOperatorDemoApi(request, env, url, segments, identity);
  }

  if (resource === "customers") {
    // Inject requests/licenses logic early
    if (segments.length >= 4 && segments[3] === "requests") {
      return handleRequestsApi(request, env, segments, identity);
    }
    if (segments.length >= 4 && segments[3] === "licenses") {
      return handleLicensesApi(request, env, segments, identity);
    }
    return handleCustomers(request, env, url, segments, identity);
  }

  throw new ApiError(404, "not-found", "Unknown API route.");
}

// ---------------------------------------------------------------------------
// Request pipeline
// ---------------------------------------------------------------------------

/**
 * Authentication resolver. The production core always verifies the
 * Cloudflare Access JWT (D-03) and fails closed. Test entrypoints may supply
 * an override that bypasses verification with a deterministic identity; the
 * core never makes that decision itself.
 */
type AuthResult = { ok: true; identity: OperatorIdentity } | { ok: false; reason: string };

interface AppExtensions {
  /**
   * Optional pre-auth route handler.
   * Returning null falls through to the shared auth + route pipeline.
   */
  interceptApi?: (request: Request, env: Env, url: URL) => Promise<Response | null>;
  /** Optional override for the auth middleware (E2E deterministic identity). */
  authenticate?: (request: Request, env: Env) => Promise<AuthResult>;
}

/**
 * Build a Worker fetch handler over the shared API core + SPA fallback.
 * Every behavior (auth, routes, seed, D1 batch commits) is identical across
 * entrypoints; extensions are the only way a surface gains extra behavior,
 * and production passes none.
 */
export function createApp<TEnv extends Env>(
  extensions: AppExtensions = {}
): ExportedHandler<TEnv> {
  // The seeder is created per app instance so each entrypoint (which owns
  // its own D1 binding in tests) seeds its own database exactly once.
  let seeder: { ensureSeeded: () => Promise<void> } | null = null;

  async function handleApi(request: Request, env: TEnv, url: URL): Promise<Response> {
    // Liveness probe: no data exposure, no auth required.
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true, service: "hivarium-operator-console" });
    }

    // Optional pre-auth extension (test-only routes).
    if (extensions.interceptApi) {
      const intercepted = await extensions.interceptApi(request, env, url);
      if (intercepted !== null) {
        return intercepted;
      }
    }

    // Auth middleware (D-03): every /api/* request must carry a valid
    // Cf-Access-Jwt-Assertion header; rejection happens before any route
    // logic. The core never bypasses verification itself.
    const auth =
      extensions.authenticate !== undefined
        ? await extensions.authenticate(request, env)
        : await authenticateRequest(request, {
          teamDomain: env.ACCESS_TEAM_DOMAIN,
          audience: env.ACCESS_AUD,
          authorizedEmails: [env.AUTHORIZED_OPERATOR_EMAIL],
        });
    if (!auth.ok) {
      return errorResponse(401, "unauthorized", auth.reason);
    }

    try {
      if (seeder === null) {
        seeder = createCatalogSeeder(env);
      }
      await seeder.ensureSeeded();
      return await route(request, env, url, auth.identity);
    } catch (error) {
      if (error instanceof ApiError) {
        return errorResponse(error.status, error.code, error.message);
      }
      const message =
        error instanceof Error ? error.message : "Unexpected server error.";
      return errorResponse(500, "internal-error", message);
    }
  }

  return {
    async fetch(request: Request, env: TEnv): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        return handleApi(request, env, url);
      }
      if (url.pathname.startsWith("/service/")) {
        return handleService(request, env, url);
      }
      // For non-API routes on a SPA, ask the asset router for index.html.
      return env.ASSETS
        ? env.ASSETS.fetch(request)
        : fetch(new URL("/", request.url), request);
    },
  };
}

async function handleService(request: Request, env: Env, url: URL): Promise<Response> {
  const method = request.method;
  const segments = url.pathname.split("/").filter(Boolean);

  if (segments[0] !== "service") {
    return errorResponse(404, "not-found", "Unknown API route.");
  }

  if (segments[1] === "v1" && segments[2] === "demo-requests" && segments.length === 3 && method === "POST") {
    try {
      return await handleLandingDemoIntake(request, env);
    } catch (error) {
      if (error instanceof ApiError) {
        return errorResponse(error.status, error.code, error.message);
      }
      const message = error instanceof Error ? error.message : "Unexpected server error.";
      return errorResponse(500, "internal-error", message);
    }
  }

  if (!env.PORTAL_CALLER_TOKEN) {
    return errorResponse(503, "service_unavailable", "PORTAL_CALLER_TOKEN is not configured.");
  }
  const authHeader = request.headers.get("Authorization");
  const presented = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!presented || presented !== env.PORTAL_CALLER_TOKEN) {
    return errorResponse(401, "unauthorized", "Invalid or missing service token.");
  }

  if (segments[1] === "v1" && segments[2] === "customers" && segments[4] === "portal-view" && segments.length === 5) {
    if (method !== "GET") return errorResponse(405, "method-not-allowed", "Method not allowed.");
    const customerId = segments[3];
    const store = await loadCustomerStore(env.DB, customerId);
    const customer = store.customers.find((c) => c.id === customerId);
    if (!customer) {
      return errorResponse(404, "not-found", "Customer not found.");
    }

    const asOf = nowIso();
    const commercialState = projectCommercialState(store.commercialArrangements, asOf);
    const mapGrant = (g: (typeof store.agentAccessGrants)[number]) => ({
      grantId: g.id,
      agentProductId: g.agentProductId,
      agentName: g.agentProductId,
      category: null,
      version: null,
      status: resolveAgentAccessStatus(g, asOf),
      startsAt: g.startsAt,
      endsAt: g.endsAt,
      licenseId: null,
      deploymentId: null,
    });
    const activeGrants = store.agentAccessGrants.filter((g) => resolveAgentAccessStatus(g, asOf) === "active").map(mapGrant);
    const scheduledGrants = store.agentAccessGrants.filter((g) => resolveAgentAccessStatus(g, asOf) === "scheduled").map(mapGrant);

    let tokenBalance: number | null = null;
    let warningThresholdTokens: number | null = null;
    const active = commercialState.active;
    const activePrepaid = active?.model === "prepaid" ? active : undefined;
    if (activePrepaid) {
      const statement = projectAccountStatement(store.ledgerTransactions, customerId);
      tokenBalance = statement.length > 0 ? statement[0].resultingBalanceTokens : 0;
      warningThresholdTokens = activePrepaid.warningThresholdTokens;
    }

    let lastUpdated = customer.createdAt;
    if (store.activityEvents.length > 0) {
      store.activityEvents.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
      lastUpdated = store.activityEvents[0].occurredAt;
    }

    const features = store.featureEntitlements
      .filter((entitlement) => entitlement.customerId === customerId)
      .map((entitlement) => entitlement.feature);

    return json({
      organization: {
        customerId: customer.id,
        name: customer.name,
        status: customer.status,
      },
      commercial: active
        ? {
          model: active.model,
          effectiveDate: active.effectiveFrom,
          endDate: active.effectiveTo,
          renewalDate: active.model === "monthly" ? active.renewsAt : null,
        }
        : null,
      prepaid: activePrepaid
        ? {
          balanceTokens: tokenBalance,
          warningThresholdTokens,
        }
        : null,
      features,
      access: {
        active: activeGrants,
        scheduled: scheduledGrants,
      },
      lastUpdated,
    });
  }

  return errorResponse(404, "not-found", "Unknown API route.");
}

// Re-exported so the audit DTO type is available to consumers of the Worker.
export type { AuditEntry };