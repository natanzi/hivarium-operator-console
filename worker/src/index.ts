/**
 * Hivarium Operator Console — Worker API entry (Phase 3, D-01..D-07).
 *
 * One Worker serves both surfaces:
 *   * `/api/*` — the purpose-built API. Every request is authenticated
 *     through Cloudflare Access JWT verification (D-03) before any route
 *     logic runs; missing/invalid tokens get a stable 401 envelope.
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
  type CommercialArrangement,
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
  resolveAgentAccessStatus,
  validateAgentAccessGrant,
  type AgentAccessGrantInput,
  type CommercialArrangementInput,
} from "../../src/domain/commercial-rules";
import {
  applyManualAdjustment,
  assertNoNegativeBalance,
  creditGrantTransactionId,
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

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Access team domain, e.g. `example.cloudflareaccess.com`. */
  ACCESS_TEAM_DOMAIN: string;
  /** Access application AUD carried in the JWT `aud` claim. */
  ACCESS_AUD: string;
}

// ---------------------------------------------------------------------------
// Response and error helpers
// ---------------------------------------------------------------------------

class ApiError extends Error {
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
    headers: { "content-type": "application/json; charset=utf-8" },
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

let catalogSeedPromise: Promise<void> | null = null;

function ensureCatalogSeeded(env: Env): Promise<void> {
  if (catalogSeedPromise === null) {
    catalogSeedPromise = seedCatalog(env.DB).catch((error) => {
      catalogSeedPromise = null;
      throw error;
    });
  }
  return catalogSeedPromise;
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

  const after: DataStore = {
    ...before,
    ledgerTransactions: [...before.ledgerTransactions, transaction],
  };
  const diff = diffStores(before, after);
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
    throw new ApiError(404, "not-found", "Unknown API route.");
  }

  if (resource === "customers") {
    return handleCustomers(request, env, url, segments, identity);
  }

  throw new ApiError(404, "not-found", "Unknown API route.");
}

// ---------------------------------------------------------------------------
// Request pipeline
// ---------------------------------------------------------------------------

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  // Liveness probe: no data exposure, no auth required.
  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({ ok: true, service: "hivarium-operator-console" });
  }

  // Auth middleware (D-03): every other /api/* request must carry a valid
  // Cf-Access-Jwt-Assertion header; rejection happens before any route logic.
  const auth = await authenticateRequest(request, {
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    audience: env.ACCESS_AUD,
  });
  if (!auth.ok) {
    return errorResponse(401, "unauthorized", auth.reason);
  }

  try {
    await ensureCatalogSeeded(env);
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// Re-exported so the audit DTO type is available to consumers of the Worker.
export type { AuditEntry };