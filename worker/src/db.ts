/**
 * D1 data layer for the Worker API (D-01, D-06, D-12).
 *
 * This module is the only data boundary for the Worker: typed read queries,
 * prepared-statement builders, and the store-diff commit that runs every
 * mutation's rows plus its one immutable audit entry inside a single
 * `env.DB.batch()` transaction.
 *
 * Ledger and usage tables are append-only by convention and by schema
 * trigger; balances are always derived from the rows, never stored. Audit
 * entries are written only inside the mutation batch and are never updated
 * or deleted.
 */

import type {
  ActivityEvent,
  AgentAccessGrant,
  AgentProduct,
  AnnualRenewalStatus,
  AllowanceUnit,
  CommercialArrangement,
  Customer,
  DataStore,
  FeatureEntitlement,
  LedgerTransaction,
  LedgerTransactionKind,
  PrepaidCommercialArrangement,
  UsageRecord,
} from "../../src/domain/types";
import { AGENT_PRODUCTS } from "../../src/data/seed-data";
import type { OperatorIdentity } from "./auth";

// ---------------------------------------------------------------------------
// Audit entries (D-06)
// ---------------------------------------------------------------------------

/** Immutable operator audit row. `beforeJson`/`afterJson` hold JSON snapshots. */
export interface AuditEntry {
  id: string;
  occurredAt: string;
  operatorEmail: string;
  operatorSub: string;
  action: string;
  customerId: string | null;
  subjectType: string;
  subjectId: string;
  summary: string;
  beforeJson: string | null;
  afterJson: string | null;
}

/** Deterministic audit entry id derived from (action, subject, occurredAt). */
export function auditEntryId(
  action: string,
  subjectId: string,
  occurredAt: string
): string {
  return `audit_${action}_${subjectId}_${occurredAt}`;
}

export interface BuildAuditEntryInput {
  identity: OperatorIdentity;
  action: string;
  customerId: string | null;
  subjectType: string;
  subjectId: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  occurredAt: string;
}

/**
 * Build one immutable audit entry recording the verified operator identity,
 * action, timestamp, subject, and before/after summary. The caller commits it
 * in the same D1 batch as the mutation it records.
 */
export function buildAuditEntry(input: BuildAuditEntryInput): AuditEntry {
  return {
    id: auditEntryId(input.action, input.subjectId, input.occurredAt),
    occurredAt: input.occurredAt,
    operatorEmail: input.identity.email,
    operatorSub: input.identity.sub,
    action: input.action,
    customerId: input.customerId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    summary: input.summary,
    beforeJson: input.before === undefined ? null : JSON.stringify(input.before),
    afterJson: input.after === undefined ? null : JSON.stringify(input.after),
  };
}

// ---------------------------------------------------------------------------
// Row shapes and mappers (snake_case columns -> domain records)
// ---------------------------------------------------------------------------

interface CustomerRow {
  id: string;
  name: string;
  domain: string;
  contact: string;
  email: string;
  status: string;
  notes: string;
  created_at: string;
  origin_demo_request_id?: string | null;
  evaluation_expires_at?: string | null;
  evaluation_deployment_model?: string | null;
  approved_agent_capacity?: string | null;
  portal_membership_status?: string | null;
}

interface CommercialArrangementRow {
  id: string;
  customer_id: string;
  model: string;
  status: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  reason: string;
  replaced_by_arrangement_id: string | null;
  currency: string | null;
  billing_cadence: string | null;
  monthly_amount_cents: number | null;
  renews_at: string | null;
  warning_threshold_tokens: number | null;
  expires_at: string | null;
  notes: string | null;
  contract_value_cents: number | null;
  starts_at: string | null;
  ends_at: string | null;
  renewal_status: string | null;
  included_allowance: number | null;
  allowance_unit: string | null;
  overage_rate_cents_per_unit: number | null;
}

interface AgentAccessGrantRow {
  id: string;
  customer_id: string;
  agent_product_id: string;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  revoked_at: string | null;
  scheduled_revoke_at: string | null;
  activity_event_id: string | null;
  reason_for_change: string;
}

interface ActivityEventRow {
  id: string;
  occurred_at: string;
  source: string;
  type: string;
  customer_id: string;
  label: string;
  subject_id: string;
  subject_id2: string | null;
  resulting_state: string;
  causation_id: string | null;
}

interface LedgerTransactionRow {
  id: string;
  customer_id: string;
  occurred_at: string;
  kind: string;
  amount_tokens: number;
  reason: string;
  reference: string;
  usage_record_id: string | null;
  agent_product_id: string | null;
  reverses_transaction_id: string | null;
}

interface UsageRecordRow {
  id: string;
  customer_id: string;
  agent_product_id: string;
  occurred_at: string;
  token_quantity: number;
  source_reference: string;
  ledger_transaction_id: string;
}

interface AuditEntryRow {
  id: string;
  occurred_at: string;
  operator_email: string;
  operator_sub: string;
  action: string;
  customer_id: string | null;
  subject_type: string;
  subject_id: string;
  summary: string;
  before_json: string | null;
  after_json: string | null;
}

interface FeatureEntitlementRow {
  id: string;
  customer_id: string;
  feature: string;
  description: string;
  granted_at: string;
  expires_at: string | null;
}

interface AgentProductRow {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  plans_json: string;
}

function mapCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    contact: row.contact,
    email: row.email,
    status: row.status as Customer["status"],
    notes: row.notes,
    createdAt: row.created_at,
    originDemoRequestId: row.origin_demo_request_id ?? null,
    evaluationExpiresAt: row.evaluation_expires_at ?? null,
    evaluationDeploymentModel: row.evaluation_deployment_model ?? null,
    approvedAgentCapacity: row.approved_agent_capacity ?? null,
    portalMembershipStatus: row.portal_membership_status ?? null,
  };
}

function mapCommercialArrangement(
  row: CommercialArrangementRow
): CommercialArrangement {
  const base = {
    id: row.id,
    customerId: row.customer_id,
    status: row.status as CommercialArrangement["status"],
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdAt: row.created_at,
    reason: row.reason,
    replacedByArrangementId: row.replaced_by_arrangement_id,
  };
  if (row.model === "monthly") {
    return {
      ...base,
      model: "monthly",
      currency: "USD",
      billingCadence: "monthly",
      monthlyAmountCents: row.monthly_amount_cents ?? 0,
      renewsAt: row.renews_at ?? "",
    };
  }
  if (row.model === "prepaid") {
    return {
      ...base,
      model: "prepaid",
      warningThresholdTokens: row.warning_threshold_tokens ?? 100,
      expiresAt: row.expires_at,
      notes: row.notes ?? undefined,
    };
  }
  return {
    ...base,
    model: "annual",
    currency: "USD",
    contractValueCents: row.contract_value_cents ?? 0,
    startsAt: row.starts_at ?? "",
    endsAt: row.ends_at ?? "",
    renewalStatus: (row.renewal_status as AnnualRenewalStatus) ?? "unknown",
    notes: row.notes ?? undefined,
    includedAllowance: row.included_allowance ?? 0,
    allowanceUnit: (row.allowance_unit as AllowanceUnit) ?? "other",
    overageRateCentsPerUnit: row.overage_rate_cents_per_unit ?? 0,
  };
}

function mapAgentAccessGrant(row: AgentAccessGrantRow): AgentAccessGrant {
  return {
    id: row.id,
    customerId: row.customer_id,
    agentProductId: row.agent_product_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    scheduledRevokeAt: row.scheduled_revoke_at,
    activityEventId: row.activity_event_id ?? "",
    reasonForChange: row.reason_for_change,
  };
}

function mapActivityEvent(row: ActivityEventRow): ActivityEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    source: row.source as ActivityEvent["source"],
    type: row.type as ActivityEvent["type"],
    customerId: row.customer_id,
    label: row.label,
    subjectId: row.subject_id,
    subjectId2: row.subject_id2 ?? undefined,
    resultingState: row.resulting_state,
    causationId: row.causation_id ?? undefined,
  };
}

function mapLedgerTransaction(row: LedgerTransactionRow): LedgerTransaction {
  const base = {
    id: row.id,
    customerId: row.customer_id,
    occurredAt: row.occurred_at,
    amountTokens: row.amount_tokens,
    reason: row.reason,
    reference: row.reference,
  };
  if (row.kind === "credit_grant") {
    return { ...base, kind: "credit_grant" };
  }
  if (row.kind === "usage_debit") {
    return {
      ...base,
      kind: "usage_debit",
      usageRecordId: row.usage_record_id ?? "",
      agentProductId: row.agent_product_id ?? "",
    };
  }
  if (row.kind === "manual_adjustment") {
    return { ...base, kind: "manual_adjustment" };
  }
  return {
    ...base,
    kind: "reversal",
    reversesTransactionId: row.reverses_transaction_id ?? "",
  };
}

function mapUsageRecord(row: UsageRecordRow): UsageRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    agentProductId: row.agent_product_id,
    occurredAt: row.occurred_at,
    tokenQuantity: row.token_quantity,
    sourceReference: row.source_reference,
    ledgerTransactionId: row.ledger_transaction_id,
  };
}

function mapAuditEntry(row: AuditEntryRow): AuditEntry {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    operatorEmail: row.operator_email,
    operatorSub: row.operator_sub,
    action: row.action,
    customerId: row.customer_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    summary: row.summary,
    beforeJson: row.before_json,
    afterJson: row.after_json,
  };
}

function mapFeatureEntitlement(row: FeatureEntitlementRow): FeatureEntitlement {
  return {
    id: row.id,
    customerId: row.customer_id,
    feature: row.feature,
    description: row.description,
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
  };
}

function mapAgentProduct(row: AgentProductRow): AgentProduct {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    version: row.version,
    plans: JSON.parse(row.plans_json) as AgentProduct["plans"],
  };
}

// ---------------------------------------------------------------------------
// Read queries
// ---------------------------------------------------------------------------

/** List customers, optionally narrowed to one lifecycle status. */
export async function listCustomers(
  db: D1Database,
  status?: string
): Promise<Customer[]> {
  const result = status
    ? await db
        .prepare("SELECT * FROM customers WHERE status = ? ORDER BY name")
        .bind(status)
        .all<CustomerRow>()
    : await db.prepare("SELECT * FROM customers ORDER BY name").all<CustomerRow>();
  return result.results.map(mapCustomer);
}

/** Fetch one customer by id, or `null` when absent. */
export async function getCustomer(
  db: D1Database,
  id: string
): Promise<Customer | null> {
  const row = await db
    .prepare("SELECT * FROM customers WHERE id = ?")
    .bind(id)
    .first<CustomerRow>();
  return row ? mapCustomer(row) : null;
}

/** All commercial arrangements for one customer. */
export async function listCommercialArrangements(
  db: D1Database,
  customerId: string
): Promise<CommercialArrangement[]> {
  const result = await db
    .prepare("SELECT * FROM commercial_arrangements WHERE customer_id = ?")
    .bind(customerId)
    .all<CommercialArrangementRow>();
  return result.results.map(mapCommercialArrangement);
}

/** All agent access grants for one customer. */
export async function listAgentAccessGrants(
  db: D1Database,
  customerId: string
): Promise<AgentAccessGrant[]> {
  const result = await db
    .prepare("SELECT * FROM agent_access_grants WHERE customer_id = ?")
    .bind(customerId)
    .all<AgentAccessGrantRow>();
  return result.results.map(mapAgentAccessGrant);
}

/** All activity events for one customer, newest first. */
export async function listActivityEvents(
  db: D1Database,
  customerId: string
): Promise<ActivityEvent[]> {
  const result = await db
    .prepare(
      "SELECT * FROM activity_events WHERE customer_id = ? ORDER BY occurred_at DESC, id DESC"
    )
    .bind(customerId)
    .all<ActivityEventRow>();
  return result.results.map(mapActivityEvent);
}

/** All immutable ledger transactions for one customer, oldest first. */
export async function listLedgerTransactions(
  db: D1Database,
  customerId: string
): Promise<LedgerTransaction[]> {
  const result = await db
    .prepare(
      "SELECT * FROM ledger_transactions WHERE customer_id = ? ORDER BY occurred_at ASC, id ASC"
    )
    .bind(customerId)
    .all<LedgerTransactionRow>();
  return result.results.map(mapLedgerTransaction);
}

/** All usage records for one customer. */
export async function listUsageRecords(
  db: D1Database,
  customerId: string
): Promise<UsageRecord[]> {
  const result = await db
    .prepare("SELECT * FROM usage_records WHERE customer_id = ?")
    .bind(customerId)
    .all<UsageRecordRow>();
  return result.results.map(mapUsageRecord);
}

/** Audit entries for one customer (or all), newest first. */
export async function listAuditEntries(
  db: D1Database,
  customerId?: string
): Promise<AuditEntry[]> {
  const result = customerId
    ? await db
        .prepare(
          "SELECT * FROM audit_entries WHERE customer_id = ? ORDER BY occurred_at DESC, id DESC"
        )
        .bind(customerId)
        .all<AuditEntryRow>()
    : await db
        .prepare("SELECT * FROM audit_entries ORDER BY occurred_at DESC, id DESC")
        .all<AuditEntryRow>();
  return result.results.map(mapAuditEntry);
}

/** The read-only agent catalog. */
export async function listAgentProducts(
  db: D1Database
): Promise<AgentProduct[]> {
  const result = await db
    .prepare("SELECT * FROM agent_products ORDER BY name")
    .all<AgentProductRow>();
  return result.results.map(mapAgentProduct);
}

/** Fetch one agent product by id, or `null` when absent. */
export async function getAgentProduct(
  db: D1Database,
  id: string
): Promise<AgentProduct | null> {
  const row = await db
    .prepare("SELECT * FROM agent_products WHERE id = ?")
    .bind(id)
    .first<AgentProductRow>();
  return row ? mapAgentProduct(row) : null;
}

/**
 * Load every collection relevant to one customer as a canonical
 * {@link DataStore} so the shared pure rules can operate on it. The agent
 * catalog is loaded in full because grant/usage validation checks product
 * existence.
 */
export async function loadCustomerStore(
  db: D1Database,
  customerId: string
): Promise<DataStore> {
  const [customers, arrangements, grants, events, ledger, usage, entitlements, products] =
    await Promise.all([
      db
        .prepare("SELECT * FROM customers WHERE id = ?")
        .bind(customerId)
        .all<CustomerRow>(),
      db
        .prepare("SELECT * FROM commercial_arrangements WHERE customer_id = ?")
        .bind(customerId)
        .all<CommercialArrangementRow>(),
      db
        .prepare("SELECT * FROM agent_access_grants WHERE customer_id = ?")
        .bind(customerId)
        .all<AgentAccessGrantRow>(),
      db
        .prepare("SELECT * FROM activity_events WHERE customer_id = ?")
        .bind(customerId)
        .all<ActivityEventRow>(),
      db
        .prepare("SELECT * FROM ledger_transactions WHERE customer_id = ?")
        .bind(customerId)
        .all<LedgerTransactionRow>(),
      db
        .prepare("SELECT * FROM usage_records WHERE customer_id = ?")
        .bind(customerId)
        .all<UsageRecordRow>(),
      db
        .prepare("SELECT * FROM feature_entitlements WHERE customer_id = ?")
        .bind(customerId)
        .all<FeatureEntitlementRow>(),
      db.prepare("SELECT * FROM agent_products").all<AgentProductRow>(),
    ]);
  return {
    schemaVersion: 4,
    customers: customers.results.map(mapCustomer),
    commercialArrangements: arrangements.results.map(mapCommercialArrangement),
    agentAccessGrants: grants.results.map(mapAgentAccessGrant),
    activityEvents: events.results.map(mapActivityEvent),
    ledgerTransactions: ledger.results.map(mapLedgerTransaction),
    usageRecords: usage.results.map(mapUsageRecord),
    featureEntitlements: entitlements.results.map(mapFeatureEntitlement),
    agentProducts: products.results.map(mapAgentProduct),
  };
}

// ---------------------------------------------------------------------------
// Statement builders (used inside env.DB.batch())
// ---------------------------------------------------------------------------

function insertCustomerStatement(db: D1Database, customer: Customer): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO customers (id, name, domain, contact, email, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      customer.id,
      customer.name,
      customer.domain,
      customer.contact,
      customer.email,
      customer.status,
      customer.notes,
      customer.createdAt
    );
}

function updateCustomerStatement(db: D1Database, customer: Customer): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE customers SET name = ?, domain = ?, contact = ?, email = ?, status = ?, notes = ?, created_at = ? WHERE id = ?"
    )
    .bind(
      customer.name,
      customer.domain,
      customer.contact,
      customer.email,
      customer.status,
      customer.notes,
      customer.createdAt,
      customer.id
    );
}

function arrangementToRow(
  arrangement: CommercialArrangement
): CommercialArrangementRow {
  const base: CommercialArrangementRow = {
    id: arrangement.id,
    customer_id: arrangement.customerId,
    model: arrangement.model,
    status: arrangement.status,
    effective_from: arrangement.effectiveFrom,
    effective_to: arrangement.effectiveTo,
    created_at: arrangement.createdAt,
    reason: arrangement.reason,
    replaced_by_arrangement_id: arrangement.replacedByArrangementId,
    currency: null,
    billing_cadence: null,
    monthly_amount_cents: null,
    renews_at: null,
    warning_threshold_tokens: null,
    expires_at: null,
    notes: null,
    contract_value_cents: null,
    starts_at: null,
    ends_at: null,
    renewal_status: null,
    included_allowance: null,
    allowance_unit: null,
    overage_rate_cents_per_unit: null,
  };
  if (arrangement.model === "monthly") {
    return {
      ...base,
      currency: arrangement.currency,
      billing_cadence: arrangement.billingCadence,
      monthly_amount_cents: arrangement.monthlyAmountCents,
      renews_at: arrangement.renewsAt,
    };
  }
  if (arrangement.model === "prepaid") {
    return {
      ...base,
      warning_threshold_tokens: arrangement.warningThresholdTokens,
      expires_at: arrangement.expiresAt,
      notes: arrangement.notes ?? null,
    };
  }
  return {
    ...base,
    contract_value_cents: arrangement.contractValueCents,
    starts_at: arrangement.startsAt,
    ends_at: arrangement.endsAt,
    renewal_status: arrangement.renewalStatus,
    notes: arrangement.notes ?? null,
    included_allowance: arrangement.includedAllowance,
    allowance_unit: arrangement.allowanceUnit,
    overage_rate_cents_per_unit: arrangement.overageRateCentsPerUnit,
  };
}

const ARRANGEMENT_COLUMNS =
  "id, customer_id, model, status, effective_from, effective_to, created_at, reason, replaced_by_arrangement_id, currency, billing_cadence, monthly_amount_cents, renews_at, warning_threshold_tokens, expires_at, notes, contract_value_cents, starts_at, ends_at, renewal_status, included_allowance, allowance_unit, overage_rate_cents_per_unit";

function insertCommercialArrangementStatement(
  db: D1Database,
  arrangement: CommercialArrangement
): D1PreparedStatement {
  const row = arrangementToRow(arrangement);
  return db
    .prepare(
      `INSERT INTO commercial_arrangements (${ARRANGEMENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.id,
      row.customer_id,
      row.model,
      row.status,
      row.effective_from,
      row.effective_to,
      row.created_at,
      row.reason,
      row.replaced_by_arrangement_id,
      row.currency,
      row.billing_cadence,
      row.monthly_amount_cents,
      row.renews_at,
      row.warning_threshold_tokens,
      row.expires_at,
      row.notes,
      row.contract_value_cents,
      row.starts_at,
      row.ends_at,
      row.renewal_status,
      row.included_allowance,
      row.allowance_unit,
      row.overage_rate_cents_per_unit
    );
}

function updateCommercialArrangementStatement(
  db: D1Database,
  arrangement: CommercialArrangement
): D1PreparedStatement {
  const row = arrangementToRow(arrangement);
  return db
    .prepare(
      `UPDATE commercial_arrangements SET customer_id = ?, model = ?, status = ?, effective_from = ?, effective_to = ?, created_at = ?, reason = ?, replaced_by_arrangement_id = ?, currency = ?, billing_cadence = ?, monthly_amount_cents = ?, renews_at = ?, warning_threshold_tokens = ?, expires_at = ?, notes = ?, contract_value_cents = ?, starts_at = ?, ends_at = ?, renewal_status = ?, included_allowance = ?, allowance_unit = ?, overage_rate_cents_per_unit = ? WHERE id = ?`
    )
    .bind(
      row.customer_id,
      row.model,
      row.status,
      row.effective_from,
      row.effective_to,
      row.created_at,
      row.reason,
      row.replaced_by_arrangement_id,
      row.currency,
      row.billing_cadence,
      row.monthly_amount_cents,
      row.renews_at,
      row.warning_threshold_tokens,
      row.expires_at,
      row.notes,
      row.contract_value_cents,
      row.starts_at,
      row.ends_at,
      row.renewal_status,
      row.included_allowance,
      row.allowance_unit,
      row.overage_rate_cents_per_unit,
      row.id
    );
}

function insertAgentAccessGrantStatement(
  db: D1Database,
  grant: AgentAccessGrant
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO agent_access_grants (id, customer_id, agent_product_id, starts_at, ends_at, created_at, revoked_at, scheduled_revoke_at, activity_event_id, reason_for_change) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      grant.id,
      grant.customerId,
      grant.agentProductId,
      grant.startsAt,
      grant.endsAt,
      grant.createdAt,
      grant.revokedAt,
      grant.scheduledRevokeAt,
      grant.activityEventId,
      grant.reasonForChange
    );
}

function updateAgentAccessGrantStatement(
  db: D1Database,
  grant: AgentAccessGrant
): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE agent_access_grants SET customer_id = ?, agent_product_id = ?, starts_at = ?, ends_at = ?, created_at = ?, revoked_at = ?, scheduled_revoke_at = ?, activity_event_id = ?, reason_for_change = ? WHERE id = ?"
    )
    .bind(
      grant.customerId,
      grant.agentProductId,
      grant.startsAt,
      grant.endsAt,
      grant.createdAt,
      grant.revokedAt,
      grant.scheduledRevokeAt,
      grant.activityEventId,
      grant.reasonForChange,
      grant.id
    );
}

function insertActivityEventStatement(
  db: D1Database,
  event: ActivityEvent
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO activity_events (id, occurred_at, source, type, customer_id, label, subject_id, subject_id2, resulting_state, causation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      event.id,
      event.occurredAt,
      event.source,
      event.type,
      event.customerId,
      event.label,
      event.subjectId,
      event.subjectId2 ?? null,
      event.resultingState,
      event.causationId ?? null
    );
}

function insertLedgerTransactionStatement(
  db: D1Database,
  transaction: LedgerTransaction
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO ledger_transactions (id, customer_id, occurred_at, kind, amount_tokens, reason, reference, usage_record_id, agent_product_id, reverses_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      transaction.id,
      transaction.customerId,
      transaction.occurredAt,
      transaction.kind,
      transaction.amountTokens,
      transaction.reason,
      transaction.reference,
      transaction.kind === "usage_debit" ? transaction.usageRecordId : null,
      transaction.kind === "usage_debit" ? transaction.agentProductId : null,
      transaction.kind === "reversal" ? transaction.reversesTransactionId : null
    );
}

function insertUsageRecordStatement(
  db: D1Database,
  usage: UsageRecord
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO usage_records (id, customer_id, agent_product_id, occurred_at, token_quantity, source_reference, ledger_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      usage.id,
      usage.customerId,
      usage.agentProductId,
      usage.occurredAt,
      usage.tokenQuantity,
      usage.sourceReference,
      usage.ledgerTransactionId
    );
}

function insertAuditEntryStatement(
  db: D1Database,
  audit: AuditEntry
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO audit_entries (id, occurred_at, operator_email, operator_sub, action, customer_id, subject_type, subject_id, summary, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      audit.id,
      audit.occurredAt,
      audit.operatorEmail,
      audit.operatorSub,
      audit.action,
      audit.customerId,
      audit.subjectType,
      audit.subjectId,
      audit.summary,
      audit.beforeJson,
      audit.afterJson
    );
}

function insertFeatureEntitlementStatement(
  db: D1Database,
  entitlement: FeatureEntitlement
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO feature_entitlements (id, customer_id, feature, description, granted_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(
      entitlement.id,
      entitlement.customerId,
      entitlement.feature,
      entitlement.description,
      entitlement.grantedAt,
      entitlement.expiresAt
    );
}

function insertAgentProductStatement(
  db: D1Database,
  product: AgentProduct
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT OR IGNORE INTO agent_products (id, name, description, category, version, plans_json) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(
      product.id,
      product.name,
      product.description,
      product.category,
      product.version,
      JSON.stringify(product.plans)
    );
}

// ---------------------------------------------------------------------------
// Store diff and transactional commit (D-06)
// ---------------------------------------------------------------------------

/** Rows added or changed between two canonical stores. */
export interface StoreDiff {
  customers: { inserted: Customer[]; updated: Customer[] };
  commercialArrangements: {
    inserted: CommercialArrangement[];
    updated: CommercialArrangement[];
  };
  agentAccessGrants: { inserted: AgentAccessGrant[]; updated: AgentAccessGrant[] };
  activityEvents: { inserted: ActivityEvent[] };
  ledgerTransactions: { inserted: LedgerTransaction[]; updated: LedgerTransaction[] };
  usageRecords: { inserted: UsageRecord[]; updated: UsageRecord[] };
}

function recordsEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function diffCollection<T extends { id: string }>(
  before: readonly T[],
  after: readonly T[]
): { inserted: T[]; updated: T[] } {
  const beforeById = new Map(before.map((record) => [record.id, record]));
  const inserted: T[] = [];
  const updated: T[] = [];
  for (const record of after) {
    const prior = beforeById.get(record.id);
    if (prior === undefined) {
      inserted.push(record);
    } else if (
      !recordsEqual(
        prior as unknown as Record<string, unknown>,
        record as unknown as Record<string, unknown>
      )
    ) {
      updated.push(record);
    }
  }
  return { inserted, updated };
}

/** Compute the row-level difference between a before and after store. */
export function diffStores(before: DataStore, after: DataStore): StoreDiff {
  const beforeEventIds = new Set(before.activityEvents.map((event) => event.id));
  return {
    customers: diffCollection(before.customers, after.customers),
    commercialArrangements: diffCollection(
      before.commercialArrangements,
      after.commercialArrangements
    ),
    agentAccessGrants: diffCollection(
      before.agentAccessGrants,
      after.agentAccessGrants
    ),
    activityEvents: {
      inserted: after.activityEvents.filter(
        (event) => !beforeEventIds.has(event.id)
      ),
    },
    ledgerTransactions: diffCollection(
      before.ledgerTransactions,
      after.ledgerTransactions
    ),
    usageRecords: diffCollection(before.usageRecords, after.usageRecords),
  };
}

/**
 * Commit a store diff plus its one immutable audit entry in a single D1
 * transaction. Ledger and usage rows are append-only: any detected update
 * fails loudly instead of being silently dropped.
 */
export async function commitStoreDiff(
  db: D1Database,
  diff: StoreDiff,
  audit: AuditEntry
): Promise<void> {
  if (diff.ledgerTransactions.updated.length > 0) {
    throw new Error("Ledger transactions are append-only; updates are forbidden.");
  }
  if (diff.usageRecords.updated.length > 0) {
    throw new Error("Usage records are append-only; updates are forbidden.");
  }

  const statements: D1PreparedStatement[] = [];
  for (const customer of diff.customers.inserted) {
    statements.push(insertCustomerStatement(db, customer));
  }
  for (const customer of diff.customers.updated) {
    statements.push(updateCustomerStatement(db, customer));
  }
  for (const arrangement of diff.commercialArrangements.inserted) {
    statements.push(insertCommercialArrangementStatement(db, arrangement));
  }
  for (const arrangement of diff.commercialArrangements.updated) {
    statements.push(updateCommercialArrangementStatement(db, arrangement));
  }
  for (const grant of diff.agentAccessGrants.inserted) {
    statements.push(insertAgentAccessGrantStatement(db, grant));
  }
  for (const grant of diff.agentAccessGrants.updated) {
    statements.push(updateAgentAccessGrantStatement(db, grant));
  }
  for (const event of diff.activityEvents.inserted) {
    statements.push(insertActivityEventStatement(db, event));
  }
  for (const transaction of diff.ledgerTransactions.inserted) {
    statements.push(insertLedgerTransactionStatement(db, transaction));
  }
  for (const usage of diff.usageRecords.inserted) {
    statements.push(insertUsageRecordStatement(db, usage));
  }
  statements.push(insertAuditEntryStatement(db, audit));
  await db.batch(statements);
}

// ---------------------------------------------------------------------------
// Catalog seeding (D-11)
// ---------------------------------------------------------------------------

/**
 * Idempotently seed the read-only agent catalog from the canonical
 * deterministic seed. Safe to run on every cold start; `INSERT OR IGNORE`
 * keeps replays from duplicating rows.
 */
export async function seedCatalog(db: D1Database): Promise<void> {
  const statements = AGENT_PRODUCTS.map((product) =>
    insertAgentProductStatement(db, product)
  );
  if (statements.length > 0) {
    await db.batch(statements);
  }
}

// Re-exported for route handlers that need the ledger kind union.
export type { LedgerTransactionKind, PrepaidCommercialArrangement };