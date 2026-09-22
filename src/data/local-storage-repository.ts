import type {
  ActivityEvent,
  AgentAccessGrant,
  AgentLicense,
  AgentProduct,
  CommercialArrangement,
  Customer,
  CustomerStatus,
  DataStore,
  FeatureEntitlement,
  LedgerTransaction,
  LedgerTransactionKind,
  LicenseStatus,
  MonthlyCommercialArrangement,
  PrepaidCommercialArrangement,
  Subscription,
  UsageRecord,
  AuditEntry,
  CustomerRequest,
  LicenseDocument,
} from "@/domain/types";
import { normalizeCustomerStatus, STORE_SCHEMA_VERSION } from "@/domain/types";
import {
  applyAccessRevocation,
  applyCommercialTransition,
  findConflictingAccessGrant,
  planTierFromMonthlyAmountCents,
  projectCommercialState,
  reconcileCommercialLifecycle,
  resolveAgentAccessStatus,
  subscriptionToMonthlyArrangement,
  validateAgentAccessGrant,
  type AgentAccessGrantInput,
  type CommercialArrangementInput,
} from "@/domain/commercial-rules";
import {
  applyManualAdjustment,
  assertNoNegativeBalance,
  creditGrantTransactionId,
  deriveTokenBalance,
  filterStatement,
  groupUsageByAgent,
  isLowBalance,
  normalizeUsageFingerprint,
  openingCreditReference,
  openingCreditTransactionId,
  projectAccountStatement,
  recordUsage,
  reverseTransaction as applyReversal,
  sumPeriodUsage,
  validateLedgerTransaction,
  validateUsageIdempotency,
  type AccountStatementRow,
  type AgentUsageTotal,
  type UsageAggregationFilter,
  type UsagePeriod,
} from "@/domain/ledger-rules";
import { buildSeedStore } from "@/data/seed-data";

/** In-memory + optional localStorage persistence for the demo data store. */

export interface CustomerInput {
  id: string;
  name: string;
  domain: string;
  contact: string;
  email: string;
  status: CustomerStatus;
  notes: string;
}

/**
 * Deterministic as-of projection of a customer's commercial arrangements.
 *
 * `active` is the single arrangement in force at `asOf` (or `null`), `scheduled`
 * is the earliest future-dated successor (or `null`), and `history` is every
 * arrangement for the customer ordered newest first.
 */
export interface CommercialSnapshot {
  customerId: string;
  asOf: string;
  active: CommercialArrangement | null;
  scheduled: CommercialArrangement | null;
  history: CommercialArrangement[];
}

/**
 * Deterministic as-of projection of a customer's agent access grants.
 *
 * `current` holds grants that are `active` at `asOf`, `scheduled` holds
 * future-dated grants, and `history` holds expired/revoked grants ordered
 * newest first.
 */
export interface AgentAccessSnapshot {
  customerId: string;
  asOf: string;
  current: AgentAccessGrant[];
  scheduled: AgentAccessGrant[];
  history: AgentAccessGrant[];
}

/**
 * A single customer holding `active` or `scheduled` access to an agent
 * product at a point in time. `status` mirrors the as-of grant state;
 * `startsAt`, `endsAt`, and `scheduledRevokeAt` are the grant's effective
 * dates (or `null`). The page renders active rows before scheduled rows.
 */
export interface AgentCustomerAccessRow {
  customerId: string;
  customerName: string;
  agentProductId: string;
  grantId: string;
  status: "active" | "scheduled";
  startsAt: string;
  endsAt: string | null;
  scheduledRevokeAt: string | null;
}

/**
 * Deterministic as-of projection of a customer's prepaid token account.
 *
 * `arrangement` is the single prepaid arrangement in force at `asOf` (or
 * `null`), `balanceTokens` is the derived balance (the signed sum of the
 * customer's immutable ledger transactions), `transactionCount` is the number
 * of immutable transactions behind that balance, and `lowBalance` is true
 * when the derived balance is at or below the arrangement's warning
 * threshold. The balance is always derived — no stored counter exists.
 */
export interface PrepaidSnapshot {
  customerId: string;
  asOf: string;
  arrangement: PrepaidCommercialArrangement | null;
  balanceTokens: number;
  transactionCount: number;
  lowBalance: boolean;
}

/**
 * One agent's row in the selected-period usage breakdown. `agentName` is the
 * catalog display name resolved by the repository; `netTokensConsumed` is the
 * signed net usage effect (negative = consumed, zero = fully reversed).
 */
export interface AgentUsageSummaryRow extends AgentUsageTotal {
  agentName: string;
}

/**
 * Read-only usage summary for a customer (USGE-03, USGE-04): the statement
 * rows after applying the date/agent/type filters, the signed net tokens
 * consumed for the selected period, and a compact per-agent breakdown ordered
 * highest consumption first. `rows` keep their full-account resulting
 * balances — filters never recalculate them.
 */
export interface UsageSummary {
  customerId: string;
  rows: AccountStatementRow[];
  netTokensConsumed: number;
  perAgent: AgentUsageSummaryRow[];
}

/**
 * The verified operator identity derived from the Cloudflare Access JWT.
 * Returned by {@link HiveRepository.getCurrentOperator} (which calls
 * `GET /api/me` on the API-backed repository).
 */
export interface OperatorIdentity {
  email: string;
  sub: string;
  name: string;
}

/**
 * Repository contract.
 *
 * All methods are asynchronous and return Promises so the data layer can move
 * to durable server-backed storage without changing the UI contract.
 * Mutations are persisted to localStorage when available.
 *
 * The commercial/access methods operate on the canonical schemaVersion 4
 * records. `getSubscriptions` and `getAgentLicenses` are narrow compatibility
 * projections derived from those canonical records for the pre-migration UI;
 * they are not competing active models.
 */
export interface HiveRepository {
  /** Whether the repository has any customers to display. */
  hasData(): Promise<boolean>;

  /**
   * The verified operator identity for the current session (calls
   * `GET /api/me` on the API-backed repository). Throws when the operator is
   * not signed in (HTTP 401).
   */
  getCurrentOperator(): Promise<OperatorIdentity>;

  /** Seed the store with the canonical six customers (replaces current). */
  reset(): Promise<void>;

  // --- Customers -----------------------------------------------------------
  listCustomers(): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer | undefined>;
  createCustomer(input: CustomerInput): Promise<Customer>;
  updateCustomer(id: string, input: CustomerInput): Promise<Customer>;
  /**
   * Archive a customer: set its lifecycle status to `"archived"` while
   * retaining every dependent record (arrangements, grants, ledger, usage).
   */
  archiveCustomer(id: string): Promise<void>;

  // --- Legacy compatibility projections (derived from canonical records) ---
  getFeatureEntitlements(customerId: string): Promise<FeatureEntitlement[]>;

  // --- Catalog -------------------------------------------------------------
  listAgentProducts(): Promise<AgentProduct[]>;
  getAgentProduct(id: string): Promise<AgentProduct | undefined>;
  /**
   * Deterministic reverse projection: the set of customers holding an
   * `active` or `scheduled` access grant to `agentProductId` at `asOf`.
   * Returns one row per grant ordered current-first (active) then scheduled,
   * earliest effective date first. Catalog editing is intentionally absent.
   */
  listCustomersWithAgentAccess(
    agentProductId: string,
    asOf: string | number
  ): Promise<AgentCustomerAccessRow[]>;

  // --- Commercial arrangements --------------------------------------------
  listCommercialArrangements(
    customerId: string
  ): Promise<CommercialArrangement[]>;
  getCommercialSnapshot(
    customerId: string,
    asOf: string | number
  ): Promise<CommercialSnapshot>;
  saveCommercialArrangement(
    input: CommercialArrangementInput,
    occurredAt: string
  ): Promise<CommercialArrangement>;
  /**
   * Terminate a customer's commercial arrangement at `occurredAt`. The
   * arrangement is closed (`status: "terminated"`), every currently active
   * agent access grant is revoked, and one triggering commercial event plus
   * one `system`-sourced access event per grant (sharing its `causationId`)
   * are appended in a single write.
   */
  terminateCommercialArrangement(
    input: { arrangementId: string; customerId: string; reason: string },
    occurredAt: string
  ): Promise<CommercialArrangement>;
  /**
   * Reconcile a customer's commercial and access lifecycle at `asOf`:
   * activate due scheduled arrangements, close expired arrangements, and
   * revoke any still-active grants when no active arrangement exists.
   * Idempotent for a repeated `asOf`.
   */
  reconcileCommercialLifecycle(customerId: string, asOf: string): Promise<void>;

  // --- Agent access grants -------------------------------------------------
  listAgentAccessGrants(customerId: string): Promise<AgentAccessGrant[]>;
  getAgentAccessSnapshot(
    customerId: string,
    asOf: string | number
  ): Promise<AgentAccessSnapshot>;
  grantAgentAccess(
    input: AgentAccessGrantInput,
    occurredAt: string
  ): Promise<AgentAccessGrant>;
  /**
   * Revoke an agent access grant immediately or on an explicit future date.
   * The grant record is retained and marked `revokedAt`/`scheduledRevokeAt`
   * rather than deleted.
   */
  revokeAgentAccess(
    input: { grantId: string; customerId: string; reason: string; effectiveAt?: string },
    occurredAt: string
  ): Promise<AgentAccessGrant>;

  // --- Activity ------------------------------------------------------------
  /** Chronological (newest first) activity events for a customer. */
  listActivityEvents(customerId: string): Promise<ActivityEvent[]>;
  /** Real audit trail for a customer */
  listAuditEntries(customerId: string): Promise<AuditEntry[]>;

  // --- Requests and Licenses ------------------------------------------------
  listRequests(customerId: string): Promise<CustomerRequest[]>;
  getRequest(customerId: string, requestId: string): Promise<CustomerRequest>;
  recordDecision(customerId: string, requestId: string, decision: { status: string; note: string; idempotencyKey?: string; externalReference?: string }): Promise<CustomerRequest>;

  listLicenses(customerId: string): Promise<LicenseDocument[]>;
  issueLicense(customerId: string, req: any): Promise<LicenseDocument>;
  renewLicense(customerId: string, licenseId: string, req: any): Promise<LicenseDocument>;
  suspendLicense(customerId: string, licenseId: string, req: any): Promise<LicenseDocument>;
  revokeLicense(customerId: string, licenseId: string, req: any): Promise<LicenseDocument>;
  resumeLicense(customerId: string, licenseId: string, req: any): Promise<LicenseDocument>;
  markDeployed(customerId: string, licenseId: string, req: any): Promise<LicenseDocument>;
  replaceLicense(customerId: string, licenseId: string, req: any): Promise<LicenseDocument>;
  downloadLicense(customerId: string, licenseId: string): Promise<string>;


  // --- Prepaid token ledger ------------------------------------------------
  /**
   * Chronological (oldest first) immutable ledger transactions for a customer.
   */
  listLedgerTransactions(customerId: string): Promise<LedgerTransaction[]>;
  /**
   * Derived token balance for a customer: the signed sum of the customer's
   * immutable ledger transactions. Zero for an empty ledger. No stored
   * balance counter exists.
   */
  getTokenBalance(customerId: string): Promise<number>;
  /**
   * As-of projection of the customer's prepaid token account: the active
   * prepaid arrangement (or `null`), the derived balance, the transaction
   * count behind it, and the low-balance flag.
   */
  getPrepaidSnapshot(
    customerId: string,
    asOf: string | number
  ): Promise<PrepaidSnapshot>;
  /**
   * Append exactly one immutable `credit_grant` transaction for a customer
   * with an active prepaid arrangement. Validates positive whole tokens and a
   * required trimmed reference before one atomic write.
   */
  addCreditGrant(
    input: {
      customerId: string;
      amountTokens: number;
      reference: string;
      reason?: string;
    },
    occurredAt: string
  ): Promise<LedgerTransaction>;
  /**
   * Record an atomic usage debit: one {@link UsageRecord} plus one linked
   * `usage_debit` ledger transaction in a single write (D-08, USGE-01).
   * Re-submitting the same source reference with an identical normalized
   * fingerprint returns the existing pair without writing; reusing the
   * reference with any differing fingerprint field throws a descriptive
   * conflict error naming the reference (D-09, USGE-02). A debit that would
   * make the derived balance negative is rejected before any write (D-03).
   */
  recordUsageDebit(
    input: {
      customerId: string;
      agentProductId: string;
      tokenQuantity: number;
      sourceReference: string;
      reason?: string;
    },
    occurredAt: string
  ): Promise<{ usage: UsageRecord; transaction: LedgerTransaction }>;
  /**
   * Append exactly one immutable `manual_adjustment` transaction with a
   * required reason and reference (D-06, LEDG-04). The amount must be a
   * non-zero signed whole-token value, and an adjustment that would make the
   * derived balance negative is rejected before any write.
   */
  addManualAdjustment(
    input: {
      customerId: string;
      amountTokens: number;
      reference: string;
      reason: string;
    },
    occurredAt: string
  ): Promise<LedgerTransaction>;
  /**
   * Append exactly one immutable `reversal` transaction that negates the full
   * amount of its target exactly once, with a required reason and reference
   * (D-05, LEDG-04). Rejects a missing target, a target from a different
   * customer, a reversal-of-reversal, a second reversal of the same target,
   * and any reversal that would make the derived balance negative — all before
   * any write.
   */
  reverseTransaction(
    input: {
      customerId: string;
      transactionId: string;
      reference: string;
      reason: string;
    },
    occurredAt: string
  ): Promise<LedgerTransaction>;
  /**
   * Update the warning threshold (non-negative whole tokens) on the active
   * prepaid arrangement. Configuration only — never creates a ledger
   * transaction.
   */
  updateWarningThreshold(
    customerId: string,
    thresholdTokens: number
  ): Promise<PrepaidCommercialArrangement>;
  /**
   * Derived chronological statement rows for a customer (LEDG-05): newest-first
   * display rows with full-account running balances. Read-only; never writes.
   */
  getAccountStatement(customerId: string): Promise<AccountStatementRow[]>;
  /**
   * Filtered statement rows plus the selected-period usage summary (USGE-03,
   * USGE-04): net tokens consumed and a compact per-agent breakdown ordered
   * highest consumption first. Date boundaries are inclusive; an inverted
   * range throws "From date must be on or before To date." Read-only; never
   * writes.
   */
  getUsageSummary(
    customerId: string,
    period: UsagePeriod,
    agentProductId?: string,
    type?: LedgerTransactionKind
  ): Promise<UsageSummary>;
}

export type StorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;

/**
 * Storage key is intentionally kept as the original v1 key so that existing
 * browser payloads are found and upgraded by {@link migrateStore} instead of
 * being orphaned by a rename.
 */
const STORAGE_KEY = "hivarium.operator-console.store.v1";

/**
 * Fixed deterministic timestamp used by the v1 → v2 migration so that
 * migrated records and activity events are reproducible across reads.
 */
const MIGRATION_TIMESTAMP = "2026-09-09T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeCustomers(value: unknown): Customer[] {
  return (asArray(value) as Customer[]).map((customer) => ({
    ...customer,
    status: normalizeCustomerStatus(customer.status),
  }));
}

function migrateSubscriptions(
  subscriptions: Subscription[],
  existing: CommercialArrangement[]
): CommercialArrangement[] {
  const existingIds = new Set(existing.map((arrangement) => arrangement.id));
  const migrated: CommercialArrangement[] = [];
  for (const subscription of subscriptions) {
    const id = `arr_${subscription.id}`;
    if (existingIds.has(id)) continue;
    migrated.push(
      subscriptionToMonthlyArrangement(
        {
          id,
          customerId: subscription.customerId,
          plan: subscription.plan,
          seats: subscription.seats,
          startedAt: subscription.startedAt,
          renewsAt: subscription.renewsAt,
          status: subscription.status,
        },
        { now: MIGRATION_TIMESTAMP }
      )
    );
  }
  return migrated;
}

function migrateLicenses(
  licenses: AgentLicense[],
  existing: AgentAccessGrant[]
): AgentAccessGrant[] {
  const existingIds = new Set(existing.map((grant) => grant.id));
  const migrated: AgentAccessGrant[] = [];
  for (const license of licenses) {
    const id = `grant_${license.id}`;
    if (existingIds.has(id)) continue;
    const revokedAt =
      license.status === "revoked"
        ? (license.expiresAt ?? license.issuedAt)
        : null;
    migrated.push({
      id,
      customerId: license.customerId,
      agentProductId: license.agentProductId,
      startsAt: license.issuedAt,
      endsAt: license.expiresAt,
      createdAt: MIGRATION_TIMESTAMP,
      revokedAt,
      scheduledRevokeAt: null,
      activityEventId: `evt_migrate_${license.id}`,
      reasonForChange: `Migrated from legacy ${license.status} license.`,
    });
  }
  return migrated;
}

function migrateEvents(
  subscriptions: Subscription[],
  licenses: AgentLicense[],
  existing: ActivityEvent[],
  migratedArrangements: CommercialArrangement[]
): ActivityEvent[] {
  const existingIds = new Set(existing.map((event) => event.id));
  const events: ActivityEvent[] = [];

  const arrangementStatus = new Map(
    migratedArrangements.map((arrangement) => [arrangement.id, arrangement.status])
  );

  for (const subscription of subscriptions) {
    const id = `evt_migrate_${subscription.id}`;
    if (existingIds.has(id)) continue;
    const arrangementId = `arr_${subscription.id}`;
    events.push({
      id,
      occurredAt: MIGRATION_TIMESTAMP,
      source: "migration",
      type: "commercial.created",
      customerId: subscription.customerId,
      label: `Migrated ${subscription.plan} subscription to a monthly arrangement.`,
      subjectId: arrangementId,
      resultingState: arrangementStatus.get(arrangementId) ?? "active",
    });
  }

  for (const license of licenses) {
    const id = `evt_migrate_${license.id}`;
    if (existingIds.has(id)) continue;
    const revoked = license.status === "revoked";
    events.push({
      id,
      occurredAt: MIGRATION_TIMESTAMP,
      source: "migration",
      type: revoked ? "access.revoked" : "access.granted",
      customerId: license.customerId,
      label: `Migrated ${license.status} license to an agent access grant.`,
      subjectId: `grant_${license.id}`,
      subjectId2: license.agentProductId,
      resultingState: revoked ? "revoked" : "active",
    });
  }

  return events;
}

/**
 * Migrate legacy prepaid arrangements to the v3 shape and derive their
 * deterministic opening token credits (D-15). Each prepaid arrangement with a
 * positive legacy `balanceCents` receives exactly one `credit_grant` whose id
 * and reference derive from the arrangement id; zero balances append nothing.
 * The arrangement's `currency`/`balanceCents` are replaced by
 * `warningThresholdTokens` (default 100).
 */
function migratePrepaidLedger(
  arrangements: CommercialArrangement[]
): {
  arrangements: CommercialArrangement[];
  ledgerTransactions: LedgerTransaction[];
} {
  const ledgerTransactions: LedgerTransaction[] = [];
  const migrated = arrangements.map((arrangement) => {
    if (arrangement.model !== "prepaid") return arrangement;
    const legacy = arrangement as PrepaidCommercialArrangement & {
      currency?: string;
      balanceCents?: number;
    };
    const balanceCents = legacy.balanceCents ?? 0;
    if (balanceCents > 0) {
      ledgerTransactions.push({
        id: openingCreditTransactionId(arrangement.id),
        customerId: arrangement.customerId,
        occurredAt: MIGRATION_TIMESTAMP,
        kind: "credit_grant",
        amountTokens: balanceCents,
        reason: "Opening token credit from prototype migration",
        reference: openingCreditReference(arrangement.id),
      });
    }
    return {
      ...arrangement,
      warningThresholdTokens: legacy.warningThresholdTokens ?? 100,
    };
  });
  return { arrangements: migrated, ledgerTransactions };
}

function normalizeV2Store(raw: Record<string, unknown>): DataStore {
  const seed = buildSeedStore();
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    customers: normalizeCustomers(raw.customers),
    featureEntitlements: asArray(raw.featureEntitlements) as FeatureEntitlement[],
    agentProducts:
      asArray(raw.agentProducts).length > 0
        ? (asArray(raw.agentProducts) as AgentProduct[])
        : seed.agentProducts,
    commercialArrangements: asArray(
      raw.commercialArrangements
    ) as CommercialArrangement[],
    agentAccessGrants: asArray(raw.agentAccessGrants) as AgentAccessGrant[],
    activityEvents: asArray(raw.activityEvents) as ActivityEvent[],
    ledgerTransactions: asArray(raw.ledgerTransactions) as LedgerTransaction[],
    usageRecords: asArray(raw.usageRecords) as UsageRecord[],
  };
}

/**
 * Upgrade an arbitrary persisted payload to the canonical schemaVersion 4
 * {@link DataStore}. This is the only persisted-format upgrade seam.
 *
 * - A canonical v4 payload is normalized (customer statuses) and returned.
 * - A canonical v3 payload is upgraded deterministically (v3→v4): every
 *   generalized collection is preserved unchanged and only the schema version
 *   and customer status normalization change. The `archived` status passes
 *   through; records without it are unchanged. No legacy conversion runs, so
 *   ledger and usage rows are never dropped.
 * - A legacy v1 payload keeps every customer, entitlement, and catalog
 *   product while `Subscription` meaning becomes monthly
 *   {@link CommercialArrangement} records and `AgentLicense` meaning becomes
 *   {@link AgentAccessGrant} records, each with a linked migration
 *   {@link ActivityEvent}.
 * - Migration is deterministic and idempotent: records whose source identity
 *   (`arr_<subId>` / `grant_<licId>`) already exists are never duplicated.
 * - Corrupt or non-object payloads fall back to the complete deterministic
 *   seed.
 */
export function migrateStore(raw: unknown): DataStore {
  if (!isRecord(raw)) return buildSeedStore();

  if (raw.schemaVersion === STORE_SCHEMA_VERSION) {
    return normalizeV2Store(raw);
  }

  // v3 → v4 (D-05): a canonical v3 payload already carries every generalized
  // collection in the active shape. The only change is the schema version and
  // customer status normalization, so the canonical normalizer is sufficient.
  if (raw.schemaVersion === 3) {
    return normalizeV2Store(raw);
  }

  const seed = buildSeedStore();
  const customers = normalizeCustomers(raw.customers);
  const featureEntitlements = asArray(
    raw.featureEntitlements
  ) as FeatureEntitlement[];
  const agentProducts =
    asArray(raw.agentProducts).length > 0
      ? (asArray(raw.agentProducts) as AgentProduct[])
      : seed.agentProducts;

  // A partial v2 payload may already carry canonical collections; keep them.
  const existingArrangements = asArray(
    raw.commercialArrangements
  ) as CommercialArrangement[];
  const existingGrants = asArray(raw.agentAccessGrants) as AgentAccessGrant[];
  const existingEvents = asArray(raw.activityEvents) as ActivityEvent[];

  const subscriptions = asArray(raw.subscriptions) as Subscription[];
  const licenses = asArray(raw.agentLicenses) as AgentLicense[];

  const migratedArrangements = migrateSubscriptions(
    subscriptions,
    existingArrangements
  );
  const migratedGrants = migrateLicenses(licenses, existingGrants);
  const migratedEvents = migrateEvents(
    subscriptions,
    licenses,
    existingEvents,
    migratedArrangements
  );

  const prepaidMigration = migratePrepaidLedger(existingArrangements);

  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    customers,
    featureEntitlements,
    agentProducts,
    commercialArrangements: [
      ...prepaidMigration.arrangements,
      ...migratedArrangements,
    ],
    agentAccessGrants: [...existingGrants, ...migratedGrants],
    activityEvents: [...existingEvents, ...migratedEvents],
    ledgerTransactions: prepaidMigration.ledgerTransactions,
    usageRecords: [],
  };
}

// ---------------------------------------------------------------------------
// Record shaping helpers
// ---------------------------------------------------------------------------

function toIsoTimestamp(value: string | number): string {
  return typeof value === "number" ? new Date(value).toISOString() : value;
}

/**
 * Narrow compatibility projection: a monthly arrangement back into the legacy
 * `Subscription` shape. `agentProductId` and `seats` are not part of the
 * canonical commercial model and are reported as empty/zero rather than
 * fabricated.
 */
function isMonthlyArrangement(
  arrangement: CommercialArrangement
): arrangement is MonthlyCommercialArrangement {
  return arrangement.model === "monthly";
}

function arrangementToSubscription(
  arrangement: MonthlyCommercialArrangement
): Subscription {
  const status: Subscription["status"] =
    arrangement.status === "terminated" || arrangement.status === "ended"
      ? "cancelled"
      : arrangement.status === "scheduled"
        ? "trialing"
        : "active";
  return {
    id: arrangement.id,
    customerId: arrangement.customerId,
    plan: planTierFromMonthlyAmountCents(arrangement.monthlyAmountCents),
    agentProductId: "",
    seats: 0,
    startedAt: arrangement.effectiveFrom,
    renewsAt: arrangement.renewsAt,
    status,
  };
}

/**
 * Narrow compatibility projection: an access grant back into the legacy
 * `AgentLicense` shape. `seats` is not part of the canonical access model and
 * is reported as zero rather than fabricated.
 */
function grantToLicense(grant: AgentAccessGrant): AgentLicense {
  const status: LicenseStatus =
    grant.revokedAt !== null
      ? "revoked"
      : grant.endsAt !== null && Date.parse(grant.endsAt) < Date.now()
        ? "expired"
        : grant.endsAt !== null &&
          Date.parse(grant.endsAt) < Date.now() + 30 * 86_400_000
          ? "expiring"
          : "active";
  return {
    id: grant.id,
    customerId: grant.customerId,
    agentProductId: grant.agentProductId,
    seats: 0,
    issuedAt: grant.startsAt,
    expiresAt: grant.endsAt,
    status,
  };
}

/**
 * localStorage-based implementation of {@link HiveRepository}.
 *
 * The store is lazily seeded from {@link buildSeedStore} the first time it is
 * read. Subsequent reads are returned straight from localStorage so that a
 * refresh of the browser preserves the operator's changes. Legacy v1 payloads
 * are upgraded exactly once through {@link migrateStore}.
 */
export class LocalStorageRepository implements HiveRepository {
  private readonly key: string;
  private readonly storage: StorageLike | null;

  constructor(storage?: StorageLike, key: string = STORAGE_KEY) {
    this.storage =
      storage ??
      (typeof localStorage !== "undefined" ? localStorage : null);
    this.key = key;
  }

  // -- helpers --------------------------------------------------------------
  private read(): DataStore {
    if (!this.storage) return buildSeedStore();

    const raw = this.storage.getItem(this.key);
    if (!raw) {
      const seeded = buildSeedStore();
      this.storage.setItem(this.key, JSON.stringify(seeded));
      return seeded;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const migrated = migrateStore(parsed);
      // Re-persist only when migration actually changed the payload, so a
      // canonical store is not rewritten on every read.
      if (JSON.stringify(migrated) !== raw) {
        this.storage.setItem(this.key, JSON.stringify(migrated));
      }
      return migrated;
    } catch {
      const seeded = buildSeedStore();
      this.storage.setItem(this.key, JSON.stringify(seeded));
      return seeded;
    }
  }

  private write(store: DataStore): void {
    if (this.storage) {
      this.storage.setItem(this.key, JSON.stringify(store));
    }
  }

  // -- HiveRepository -------------------------------------------------------
  async hasData(): Promise<boolean> {
    return (await this.listCustomers()).length > 0;
  }

  async getCurrentOperator(): Promise<OperatorIdentity> {
    // The local demo has no authentication surface; report a deterministic
    // operator so the sidebar can render a signed-in state.
    return {
      email: "operator@hivarium.local",
      sub: "local-demo-operator",
      name: "Local Operator",
    };
  }

  async reset(): Promise<void> {
    const seeded = buildSeedStore();
    if (this.storage) {
      this.storage.removeItem(this.key);
    }
    this.write(seeded);
  }

  async listCustomers(): Promise<Customer[]> {
    return this.read().customers;
  }

  async getCustomer(id: string): Promise<Customer | undefined> {
    return this.read().customers.find((c) => c.id === id);
  }

  async createCustomer(input: CustomerInput): Promise<Customer> {
    const now = new Date(2026, 0, 1).toISOString(); // deterministic
    const store = this.read();
    if (store.customers.some((c) => c.id === input.id)) {
      throw new Error(`Customer with id "${input.id}" already exists`);
    }
    const created: Customer = { ...input, createdAt: now };
    this.write({ ...store, customers: [...store.customers, created] });
    return created;
  }

  async updateCustomer(id: string, input: CustomerInput): Promise<Customer> {
    const store = this.read();
    const existing = store.customers.find((c) => c.id === id);
    if (!existing) {
      throw new Error(`Customer with id "${id}" does not exist`);
    }
    const updated: Customer = { ...existing, ...input, id };
    this.write({
      ...store,
      customers: store.customers.map((c) => (c.id === id ? updated : c)),
    });
    return updated;
  }

  async archiveCustomer(id: string): Promise<void> {
    const store = this.read();
    if (!store.customers.some((c) => c.id === id)) {
      throw new Error(`Customer with id "${id}" does not exist`);
    }
    this.write({
      ...store,
      customers: store.customers.map((c) =>
        c.id === id ? { ...c, status: "archived" } : c
      ),
    });
  }

  // -- Legacy compatibility projections -------------------------------------
  async getSubscriptions(customerId: string): Promise<Subscription[]> {
    return this.read()
      .commercialArrangements.filter(
        (arrangement) => arrangement.customerId === customerId
      )
      .filter(isMonthlyArrangement)
      .map((arrangement) => arrangementToSubscription(arrangement));
  }

  async getFeatureEntitlements(
    customerId: string
  ): Promise<FeatureEntitlement[]> {
    return this.read().featureEntitlements.filter(
      (fe) => fe.customerId === customerId
    );
  }

  async getAgentLicenses(customerId: string): Promise<AgentLicense[]> {
    return this.read()
      .agentAccessGrants.filter((grant) => grant.customerId === customerId)
      .map((grant) => grantToLicense(grant));
  }

  async listAgentProducts(): Promise<AgentProduct[]> {
    return this.read().agentProducts;
  }

  async getAgentProduct(id: string): Promise<AgentProduct | undefined> {
    return this.read().agentProducts.find((p) => p.id === id);
  }

  async listCustomersWithAgentAccess(
    agentProductId: string,
    asOf: string | number
  ): Promise<AgentCustomerAccessRow[]> {
    const asOfIso = toIsoTimestamp(asOf);
    const rows: AgentCustomerAccessRow[] = [];
    for (const grant of this.read().agentAccessGrants) {
      if (grant.agentProductId !== agentProductId) continue;
      const status = resolveAgentAccessStatus(grant, asOfIso);
      if (status !== "active" && status !== "scheduled") continue;
      const customer = this.read().customers.find(
        (c) => c.id === grant.customerId
      );
      rows.push({
        customerId: grant.customerId,
        customerName: customer?.name ?? grant.customerId,
        agentProductId: grant.agentProductId,
        grantId: grant.id,
        status,
        startsAt: grant.startsAt,
        endsAt: grant.endsAt,
        scheduledRevokeAt: grant.scheduledRevokeAt,
      });
    }

    // Active (current) rows before scheduled, earliest effective first.
    rows.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "active" ? -1 : 1;
      }
      return a.startsAt.localeCompare(b.startsAt);
    });

    return rows;
  }

  // -- Commercial arrangements ----------------------------------------------
  async listCommercialArrangements(
    customerId: string
  ): Promise<CommercialArrangement[]> {
    return this.read().commercialArrangements.filter(
      (arrangement) => arrangement.customerId === customerId
    );
  }

  async getCommercialSnapshot(
    customerId: string,
    asOf: string | number
  ): Promise<CommercialSnapshot> {
    const asOfIso = toIsoTimestamp(asOf);
    const arrangements = await this.listCommercialArrangements(customerId);
    const projection = projectCommercialState(arrangements, asOf);
    return {
      customerId,
      asOf: asOfIso,
      active: projection.active,
      scheduled: projection.scheduled,
      history: projection.history,
    };
  }

  async saveCommercialArrangement(
    input: CommercialArrangementInput,
    occurredAt: string
  ): Promise<CommercialArrangement> {
    const store = this.read();
    const customerId = input.customerId as string;
    if (!store.customers.some((c) => c.id === customerId)) {
      throw new Error(`Customer with id "${customerId}" does not exist`);
    }

    // The pure transition validates the input, applies immediate/scheduled
    // replacement semantics (closing the current effective range and setting
    // replacedByArrangementId), and produces one atomic store write.
    const result = applyCommercialTransition(store, input, occurredAt);
    this.write(result.store);
    return result.arrangement;
  }

  async terminateCommercialArrangement(
    input: { arrangementId: string; customerId: string; reason: string },
    occurredAt: string
  ): Promise<CommercialArrangement> {
    const store = this.read();
    const arrangement = store.commercialArrangements.find(
      (a) => a.id === input.arrangementId && a.customerId === input.customerId
    );
    if (!arrangement) {
      throw new Error(
        `Commercial arrangement with id "${input.arrangementId}" does not exist.`
      );
    }
    if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
      throw new Error("reason is required.");
    }
    if (arrangement.status === "terminated") {
      throw new Error(
        `Commercial arrangement "${input.arrangementId}" is already terminated.`
      );
    }

    const triggerEventId = `evt_${arrangement.id}_terminated`;
    const triggerEvent: ActivityEvent = {
      id: triggerEventId,
      occurredAt,
      source: "operator",
      type: "commercial.terminated",
      customerId: input.customerId,
      label: `Terminated ${arrangement.model} commercial arrangement.`,
      subjectId: arrangement.id,
      resultingState: "terminated",
    };

    // Compute every affected record before the single write: the closed
    // arrangement, each revoked grant, and the linked activity events.
    let next: DataStore = {
      ...store,
      commercialArrangements: store.commercialArrangements.map((a) =>
        a.id === arrangement.id
          ? { ...a, status: "terminated", effectiveTo: occurredAt, reason: input.reason }
          : a
      ),
      activityEvents: [...store.activityEvents, triggerEvent],
    };

    const activeGrants = store.agentAccessGrants.filter(
      (g) =>
        g.customerId === input.customerId &&
        resolveAgentAccessStatus(g, occurredAt) === "active"
    );
    for (const grant of activeGrants) {
      const result = applyAccessRevocation(next, {
        grantId: grant.id,
        customerId: input.customerId,
        reason: input.reason,
        effectiveAt: occurredAt,
        occurredAt,
        source: "system",
        causationId: triggerEventId,
      });
      next = result.store;
    }

    this.write(next);
    return next.commercialArrangements.find((a) => a.id === arrangement.id)!;
  }

  async reconcileCommercialLifecycle(
    customerId: string,
    asOf: string
  ): Promise<void> {
    const store = this.read();
    const result = reconcileCommercialLifecycle(store, customerId, asOf);
    if (result.changed) {
      this.write(result.store);
    }
  }

  // -- Agent access grants --------------------------------------------------
  async listAgentAccessGrants(customerId: string): Promise<AgentAccessGrant[]> {
    return this.read().agentAccessGrants.filter(
      (grant) => grant.customerId === customerId
    );
  }

  async getAgentAccessSnapshot(
    customerId: string,
    asOf: string | number
  ): Promise<AgentAccessSnapshot> {
    const asOfIso = toIsoTimestamp(asOf);
    const grants = await this.listAgentAccessGrants(customerId);
    const current = grants.filter(
      (grant) => resolveAgentAccessStatus(grant, asOf) === "active"
    );
    const scheduled = grants.filter(
      (grant) => resolveAgentAccessStatus(grant, asOf) === "scheduled"
    );
    const history = grants
      .filter((grant) => {
        const status = resolveAgentAccessStatus(grant, asOf);
        return status === "expired" || status === "revoked";
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return { customerId, asOf: asOfIso, current, scheduled, history };
  }

  async grantAgentAccess(
    input: AgentAccessGrantInput,
    occurredAt: string
  ): Promise<AgentAccessGrant> {
    const normalizedInput: AgentAccessGrantInput = {
      ...input,
      createdAt: input.createdAt ?? occurredAt,
    };
    const validation = validateAgentAccessGrant(normalizedInput);
    if (!validation.ok) {
      throw new Error(validation.problems.join(" "));
    }

    const store = this.read();
    const customerId = normalizedInput.customerId as string;
    const agentProductId = normalizedInput.agentProductId as string;
    if (!store.customers.some((c) => c.id === customerId)) {
      throw new Error(`Customer with id "${customerId}" does not exist`);
    }
    if (!store.agentProducts.some((p) => p.id === agentProductId)) {
      throw new Error(
        `Agent product with id "${agentProductId}" does not exist`
      );
    }

    const conflict = findConflictingAccessGrant(
      store.agentAccessGrants,
      { customerId, agentProductId },
      occurredAt
    );
    if (conflict) {
      throw new Error(
        `Customer "${customerId}" already has active or scheduled access to agent product "${agentProductId}".`
      );
    }

    const grantId =
      (normalizedInput.id as string | undefined) ??
      `grant_${customerId}_${agentProductId}_${occurredAt}`;
    const eventId = `evt_${grantId}`;
    const grant: AgentAccessGrant = {
      id: grantId,
      customerId,
      agentProductId,
      startsAt: normalizedInput.startsAt as string,
      endsAt: (normalizedInput.endsAt as string | null) ?? null,
      createdAt: occurredAt,
      revokedAt: null,
      scheduledRevokeAt: null,
      activityEventId: eventId,
      reasonForChange: normalizedInput.reasonForChange as string,
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

    this.write({
      ...store,
      agentAccessGrants: [...store.agentAccessGrants, grant],
      activityEvents: [...store.activityEvents, event],
    });
    return grant;
  }

  async revokeAgentAccess(
    input: {
      grantId: string;
      customerId: string;
      reason: string;
      effectiveAt?: string;
    },
    occurredAt: string
  ): Promise<AgentAccessGrant> {
    const store = this.read();
    const grant = store.agentAccessGrants.find(
      (g) => g.id === input.grantId && g.customerId === input.customerId
    );
    if (!grant) {
      throw new Error(
        `Agent access grant with id "${input.grantId}" does not exist.`
      );
    }
    if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
      throw new Error("reason is required.");
    }

    const effectiveAt = input.effectiveAt ?? occurredAt;
    const result = applyAccessRevocation(store, {
      grantId: input.grantId,
      customerId: input.customerId,
      reason: input.reason,
      effectiveAt,
      occurredAt,
      source: "operator",
    });
    this.write(result.store);
    return result.grant;
  }

  // -- Activity ------------------------------------------------------------
  async listActivityEvents(customerId: string): Promise<ActivityEvent[]> {
    return this.read()
      .activityEvents.filter((event) => event.customerId === customerId)
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  }

  async listAuditEntries(_customerId: string): Promise<AuditEntry[]> {
    return [];
  }

  // -- Prepaid token ledger ------------------------------------------------
  async listLedgerTransactions(
    customerId: string
  ): Promise<LedgerTransaction[]> {
    return this.read()
      .ledgerTransactions.filter(
        (transaction) => transaction.customerId === customerId
      )
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  }

  async getTokenBalance(customerId: string): Promise<number> {
    return deriveTokenBalance(this.read().ledgerTransactions, customerId);
  }

  async getPrepaidSnapshot(
    customerId: string,
    asOf: string | number
  ): Promise<PrepaidSnapshot> {
    const asOfIso = toIsoTimestamp(asOf);
    const transactions = this.read().ledgerTransactions.filter(
      (transaction) => transaction.customerId === customerId
    );
    const balanceTokens = deriveTokenBalance(transactions, customerId);
    const commercial = await this.getCommercialSnapshot(customerId, asOf);
    const arrangement =
      commercial.active?.model === "prepaid" ? commercial.active : null;
    return {
      customerId,
      asOf: asOfIso,
      arrangement,
      balanceTokens,
      transactionCount: transactions.length,
      lowBalance:
        arrangement !== null &&
        isLowBalance(balanceTokens, arrangement.warningThresholdTokens),
    };
  }

  async addCreditGrant(
    input: {
      customerId: string;
      amountTokens: number;
      reference: string;
      reason?: string;
    },
    occurredAt: string
  ): Promise<LedgerTransaction> {
    const store = this.read();
    const customerId = input.customerId;
    if (!store.customers.some((c) => c.id === customerId)) {
      throw new Error(`Customer with id "${customerId}" does not exist`);
    }
    const active = (await this.getCommercialSnapshot(customerId, occurredAt))
      .active;
    if (!active || active.model !== "prepaid") {
      throw new Error(
        `Customer "${customerId}" does not have an active prepaid arrangement.`
      );
    }
    const transaction: LedgerTransaction = {
      id: creditGrantTransactionId(customerId, occurredAt),
      customerId,
      occurredAt,
      kind: "credit_grant",
      amountTokens: input.amountTokens,
      reason: input.reason?.trim() || "Operator-confirmed token credit",
      reference: input.reference.trim(),
    };
    const validation = validateLedgerTransaction(transaction);
    if (!validation.ok) {
      throw new Error(validation.problems.join(" "));
    }
    assertNoNegativeBalance(
      store.ledgerTransactions,
      customerId,
      transaction.amountTokens
    );
    this.write({
      ...store,
      ledgerTransactions: [...store.ledgerTransactions, transaction],
    });
    return transaction;
  }

  async recordUsageDebit(
    input: {
      customerId: string;
      agentProductId: string;
      tokenQuantity: number;
      sourceReference: string;
      reason?: string;
    },
    occurredAt: string
  ): Promise<{ usage: UsageRecord; transaction: LedgerTransaction }> {
    const store = this.read();
    const customerId = input.customerId.trim();
    if (!store.customers.some((c) => c.id === customerId)) {
      throw new Error(`Customer with id "${customerId}" does not exist`);
    }
    const active = (await this.getCommercialSnapshot(customerId, occurredAt))
      .active;
    if (!active || active.model !== "prepaid") {
      throw new Error(
        `Customer "${customerId}" does not have an active prepaid arrangement.`
      );
    }
    const agentProductId = input.agentProductId.trim();
    if (!store.agentProducts.some((p) => p.id === agentProductId)) {
      throw new Error(
        `Agent product with id "${agentProductId}" does not exist`
      );
    }

    const fingerprint = normalizeUsageFingerprint({
      customerId,
      agentProductId,
      sourceReference: input.sourceReference,
      occurredAt,
      tokenQuantity: input.tokenQuantity,
    });
    if (!fingerprint) {
      throw new Error(
        "Usage requires a customer, agent product, positive whole token quantity, canonical ISO occurredAt, and a source reference."
      );
    }

    // Idempotency (D-09, USGE-02): look up the existing usage record by exact
    // sourceReference across the whole store before any balance validation or
    // write. An exact replay returns the existing pair without calling
    // write(); a conflicting reuse throws a descriptive error.
    const existing = store.usageRecords.find(
      (usage) => usage.sourceReference === fingerprint.sourceReference
    );
    if (existing) {
      validateUsageIdempotency(existing, fingerprint);
      const existingTransaction = store.ledgerTransactions.find(
        (transaction) => transaction.id === existing.ledgerTransactionId
      );
      if (!existingTransaction) {
        throw new Error(
          `Usage record "${existing.id}" is missing its linked ledger transaction.`
        );
      }
      return { usage: existing, transaction: existingTransaction };
    }

    const result = recordUsage(store, input, occurredAt);
    this.write(result.store);
    return { usage: result.usage, transaction: result.transaction };
  }

  async addManualAdjustment(
    input: {
      customerId: string;
      amountTokens: number;
      reference: string;
      reason: string;
    },
    occurredAt: string
  ): Promise<LedgerTransaction> {
    const store = this.read();
    const customerId = input.customerId.trim();
    if (!store.customers.some((c) => c.id === customerId)) {
      throw new Error(`Customer with id "${customerId}" does not exist`);
    }
    const active = (await this.getCommercialSnapshot(customerId, occurredAt))
      .active;
    if (!active || active.model !== "prepaid") {
      throw new Error(
        `Customer "${customerId}" does not have an active prepaid arrangement.`
      );
    }
    const result = applyManualAdjustment(store, input, occurredAt);
    this.write(result.store);
    return result.transaction;
  }

  async reverseTransaction(
    input: {
      customerId: string;
      transactionId: string;
      reference: string;
      reason: string;
    },
    occurredAt: string
  ): Promise<LedgerTransaction> {
    const store = this.read();
    const customerId = input.customerId.trim();
    if (!store.customers.some((c) => c.id === customerId)) {
      throw new Error(`Customer with id "${customerId}" does not exist`);
    }
    const active = (await this.getCommercialSnapshot(customerId, occurredAt))
      .active;
    if (!active || active.model !== "prepaid") {
      throw new Error(
        `Customer "${customerId}" does not have an active prepaid arrangement.`
      );
    }
    const result = applyReversal(store, input, occurredAt);
    this.write(result.store);
    return result.transaction;
  }

  async updateWarningThreshold(
    customerId: string,
    thresholdTokens: number
  ): Promise<PrepaidCommercialArrangement> {
    const store = this.read();
    const active = (
      await this.getCommercialSnapshot(customerId, new Date().toISOString())
    ).active;
    if (!active || active.model !== "prepaid") {
      throw new Error(
        `Customer "${customerId}" does not have an active prepaid arrangement.`
      );
    }
    if (
      typeof thresholdTokens !== "number" ||
      !Number.isFinite(thresholdTokens) ||
      !Number.isInteger(thresholdTokens) ||
      thresholdTokens < 0
    ) {
      throw new Error("thresholdTokens must be a non-negative whole number.");
    }
    const updated: PrepaidCommercialArrangement = {
      ...active,
      warningThresholdTokens: thresholdTokens,
    };
    this.write({
      ...store,
      commercialArrangements: store.commercialArrangements.map((a) =>
        a.id === active.id ? updated : a
      ),
    });
    return updated;
  }

  async getAccountStatement(customerId: string): Promise<AccountStatementRow[]> {
    return projectAccountStatement(
      this.read().ledgerTransactions,
      customerId
    );
  }

  async getUsageSummary(
    customerId: string,
    period: UsagePeriod,
    agentProductId?: string,
    type?: LedgerTransactionKind
  ): Promise<UsageSummary> {
    const store = this.read();
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
    const aggregationFilter: UsageAggregationFilter = {
      agentProductId,
      type,
    };
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
    return { customerId, rows, netTokensConsumed, perAgent };
  }

  // --- Requests and Licenses (Dummy unsupported implementations) ---
  async listRequests(_customerId: string): Promise<CustomerRequest[]> { return []; }
  async getRequest(_customerId: string, _requestId: string): Promise<CustomerRequest> { throw new Error("not implemented"); }
  async recordDecision(_customerId: string, _requestId: string, _decision: { status: string; note: string; idempotencyKey?: string; externalReference?: string }): Promise<CustomerRequest> { throw new Error("not implemented"); }
  async listLicenses(_customerId: string): Promise<LicenseDocument[]> { return []; }
  async issueLicense(_customerId: string, _req: any): Promise<LicenseDocument> { throw new Error("not implemented"); }
  async renewLicense(_customerId: string, _licenseId: string, _req: any): Promise<LicenseDocument> { throw new Error("not implemented"); }
  async suspendLicense(_customerId: string, _licenseId: string, _req: any): Promise<LicenseDocument> { throw new Error("not implemented"); }
  async revokeLicense(_customerId: string, _licenseId: string, _req: any): Promise<LicenseDocument> { throw new Error("not implemented"); }
  async resumeLicense(_customerId: string, _licenseId: string, _req: any): Promise<LicenseDocument> { throw new Error("not implemented"); }
  async markDeployed(_customerId: string, _licenseId: string, _req: any): Promise<LicenseDocument> { throw new Error("not implemented"); }
  async replaceLicense(_customerId: string, _licenseId: string, _req: any): Promise<LicenseDocument> { throw new Error("not implemented"); }
  async downloadLicense(_customerId: string, _licenseId: string): Promise<string> { throw new Error("not implemented"); }
}

/**
 * Build a throw-away in-memory repository for tests.
 * Passes a Map-backed StorageLike so no real browser storage is used.
 */
export function createInMemoryRepository(seedWith = true): {
  repository: LocalStorageRepository;
  storage: StorageLike;
} {
  const map = new Map<string, string>();
  if (seedWith) {
    map.set(STORAGE_KEY, JSON.stringify(buildSeedStore()));
  }
  const storage: StorageLike = {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  return { repository: new LocalStorageRepository(storage), storage };
}

/**
 * Default shared singleton. The application renders through this instance so
 * that navigating between pages does not re-seed data.
 */
export const repository: LocalStorageRepository = new LocalStorageRepository();