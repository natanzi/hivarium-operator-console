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
  LicenseStatus,
  MonthlyCommercialArrangement,
  Subscription,
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
 * Repository contract.
 *
 * All methods are synchronous so that the UI can render without async
 * coordination. Mutations are persisted to localStorage when available.
 *
 * The commercial/access methods operate on the canonical schemaVersion 2
 * records. `getSubscriptions` and `getAgentLicenses` are narrow compatibility
 * projections derived from those canonical records for the pre-migration UI;
 * they are not competing active models.
 */
export interface HiveRepository {
  /** Whether the repository has any customers to display. */
  hasData(): boolean;

  /** Seed the store with the canonical six customers (replaces current). */
  reset(): void;

  // --- Customers -----------------------------------------------------------
  listCustomers(): Customer[];
  getCustomer(id: string): Customer | undefined;
  createCustomer(input: CustomerInput): Customer;
  updateCustomer(id: string, input: CustomerInput): Customer;
  deleteCustomer(id: string): void;

  // --- Legacy compatibility projections (derived from canonical records) ---
  getSubscriptions(customerId: string): Subscription[];
  getFeatureEntitlements(customerId: string): FeatureEntitlement[];
  getAgentLicenses(customerId: string): AgentLicense[];

  // --- Catalog -------------------------------------------------------------
  listAgentProducts(): AgentProduct[];
  getAgentProduct(id: string): AgentProduct | undefined;

  // --- Commercial arrangements --------------------------------------------
  listCommercialArrangements(customerId: string): CommercialArrangement[];
  getCommercialSnapshot(
    customerId: string,
    asOf: string | number
  ): CommercialSnapshot;
  saveCommercialArrangement(
    input: CommercialArrangementInput,
    occurredAt: string
  ): CommercialArrangement;
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
  ): CommercialArrangement;
  /**
   * Reconcile a customer's commercial and access lifecycle at `asOf`:
   * activate due scheduled arrangements, close expired arrangements, and
   * revoke any still-active grants when no active arrangement exists.
   * Idempotent for a repeated `asOf`.
   */
  reconcileCommercialLifecycle(customerId: string, asOf: string): void;

  // --- Agent access grants -------------------------------------------------
  listAgentAccessGrants(customerId: string): AgentAccessGrant[];
  getAgentAccessSnapshot(
    customerId: string,
    asOf: string | number
  ): AgentAccessSnapshot;
  grantAgentAccess(input: AgentAccessGrantInput, occurredAt: string): AgentAccessGrant;
  /**
   * Revoke an agent access grant immediately or on an explicit future date.
   * The grant record is retained and marked `revokedAt`/`scheduledRevokeAt`
   * rather than deleted.
   */
  revokeAgentAccess(
    input: { grantId: string; customerId: string; reason: string; effectiveAt?: string },
    occurredAt: string
  ): AgentAccessGrant;

  // --- Activity ------------------------------------------------------------
  /** Chronological (newest first) activity events for a customer. */
  listActivityEvents(customerId: string): ActivityEvent[];
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
  };
}

/**
 * Upgrade an arbitrary persisted payload to the canonical schemaVersion 2
 * {@link DataStore}. This is the only persisted-format upgrade seam.
 *
 * - A canonical v2 payload is normalized (customer statuses) and returned.
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

  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    customers,
    featureEntitlements,
    agentProducts,
    commercialArrangements: [...existingArrangements, ...migratedArrangements],
    agentAccessGrants: [...existingGrants, ...migratedGrants],
    activityEvents: [...existingEvents, ...migratedEvents],
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
  hasData(): boolean {
    return this.listCustomers().length > 0;
  }

  reset(): void {
    const seeded = buildSeedStore();
    if (this.storage) {
      this.storage.removeItem(this.key);
    }
    this.write(seeded);
  }

  listCustomers(): Customer[] {
    return this.read().customers;
  }

  getCustomer(id: string): Customer | undefined {
    return this.read().customers.find((c) => c.id === id);
  }

  createCustomer(input: CustomerInput): Customer {
    const now = new Date(2026, 0, 1).toISOString(); // deterministic
    const store = this.read();
    if (store.customers.some((c) => c.id === input.id)) {
      throw new Error(`Customer with id "${input.id}" already exists`);
    }
    const created: Customer = { ...input, createdAt: now };
    this.write({ ...store, customers: [...store.customers, created] });
    return created;
  }

  updateCustomer(id: string, input: CustomerInput): Customer {
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

  deleteCustomer(id: string): void {
    const store = this.read();
    if (!store.customers.some((c) => c.id === id)) {
      throw new Error(`Customer with id "${id}" does not exist`);
    }
    this.write({
      ...store,
      customers: store.customers.filter((c) => c.id !== id),
      featureEntitlements: store.featureEntitlements.filter(
        (entitlement) => entitlement.customerId !== id
      ),
      commercialArrangements: store.commercialArrangements.filter(
        (arrangement) => arrangement.customerId !== id
      ),
      agentAccessGrants: store.agentAccessGrants.filter(
        (grant) => grant.customerId !== id
      ),
      activityEvents: store.activityEvents.filter(
        (event) => event.customerId !== id
      ),
    });
  }

  // -- Legacy compatibility projections -------------------------------------
  getSubscriptions(customerId: string): Subscription[] {
    return this.read()
      .commercialArrangements.filter(
        (arrangement) => arrangement.customerId === customerId
      )
      .filter(isMonthlyArrangement)
      .map((arrangement) => arrangementToSubscription(arrangement));
  }

  getFeatureEntitlements(customerId: string): FeatureEntitlement[] {
    return this.read().featureEntitlements.filter(
      (fe) => fe.customerId === customerId
    );
  }

  getAgentLicenses(customerId: string): AgentLicense[] {
    return this.read()
      .agentAccessGrants.filter((grant) => grant.customerId === customerId)
      .map((grant) => grantToLicense(grant));
  }

  listAgentProducts(): AgentProduct[] {
    return this.read().agentProducts;
  }

  getAgentProduct(id: string): AgentProduct | undefined {
    return this.read().agentProducts.find((p) => p.id === id);
  }

  // -- Commercial arrangements ----------------------------------------------
  listCommercialArrangements(customerId: string): CommercialArrangement[] {
    return this.read().commercialArrangements.filter(
      (arrangement) => arrangement.customerId === customerId
    );
  }

  getCommercialSnapshot(
    customerId: string,
    asOf: string | number
  ): CommercialSnapshot {
    const asOfIso = toIsoTimestamp(asOf);
    const arrangements = this.listCommercialArrangements(customerId);
    const projection = projectCommercialState(arrangements, asOf);
    return {
      customerId,
      asOf: asOfIso,
      active: projection.active,
      scheduled: projection.scheduled,
      history: projection.history,
    };
  }

  saveCommercialArrangement(
    input: CommercialArrangementInput,
    occurredAt: string
  ): CommercialArrangement {
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

  terminateCommercialArrangement(
    input: { arrangementId: string; customerId: string; reason: string },
    occurredAt: string
  ): CommercialArrangement {
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
          ? { ...a, status: "terminated", effectiveTo: occurredAt }
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

  reconcileCommercialLifecycle(customerId: string, asOf: string): void {
    const store = this.read();
    const result = reconcileCommercialLifecycle(store, customerId, asOf);
    if (result.changed) {
      this.write(result.store);
    }
  }

  // -- Agent access grants --------------------------------------------------
  listAgentAccessGrants(customerId: string): AgentAccessGrant[] {
    return this.read().agentAccessGrants.filter(
      (grant) => grant.customerId === customerId
    );
  }

  getAgentAccessSnapshot(
    customerId: string,
    asOf: string | number
  ): AgentAccessSnapshot {
    const asOfIso = toIsoTimestamp(asOf);
    const grants = this.listAgentAccessGrants(customerId);
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

  grantAgentAccess(
    input: AgentAccessGrantInput,
    occurredAt: string
  ): AgentAccessGrant {
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

  revokeAgentAccess(
    input: {
      grantId: string;
      customerId: string;
      reason: string;
      effectiveAt?: string;
    },
    occurredAt: string
  ): AgentAccessGrant {
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
  listActivityEvents(customerId: string): ActivityEvent[] {
    return this.read()
      .activityEvents.filter((event) => event.customerId === customerId)
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  }
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