/**
 * Hivarium Operator Console — domain models.
 *
 * These are plain-data types shared by the data layer (repository, seed
 * data) and the UI. They are intentionally serializable so they can be
 * persisted to localStorage as-is.
 *
 * The store is versioned (`schemaVersion`). The active commercial/access
 * records for a customer are {@link CommercialArrangement} and
 * {@link AgentAccessGrant}; historical `Subscription` and `AgentLicense`
 * records are migration inputs only (see {@link DataStoreV1}).
 */

export type CustomerStatus = "evaluation" | "active" | "paused" | "churned";

/**
 * A billing/tenant customer of the Hivarium platform.
 *
 * @property id        Stable, deterministic identifier (e.g. "cust_northwind").
 * @property name      Display / legal company name.
 * @property domain    Primary email domain used for the customer's accounts.
 * @property contact   Primary account contact name.
 * @property email     Primary account contact email.
 * @property status    Commercial lifecycle state of the account.
 * @property notes     Free-form operator notes.
 * @property createdAt ISO-8601 timestamp of when the account was created.
 */
export interface Customer {
  id: string;
  name: string;
  domain: string;
  contact: string;
  email: string;
  status: CustomerStatus;
  notes: string;
  createdAt: string;
}

export type PlanTier = "starter" | "growth" | "scale" | "enterprise";

// ---------------------------------------------------------------------------
// Commercial arrangements
// ---------------------------------------------------------------------------

/** Lifecycle status of a normalized commercial arrangement. */
export type CommercialArrangementStatus =
  | "active"
  | "scheduled"
  | "ended"
  | "terminated";

/**
 * Common fields shared by every commercial arrangement record.
 *
 * `effectiveFrom` is the ISO-8601 date the arrangement started (already
 * effective) or will start (if still `scheduled`). `effectiveTo` is optional;
 * when present, no newer arrangement may exist for the customer with an
 * `effectiveFrom` before this date.
 *
 * `replacedByArrangementId` is set (and never cleared) when a later,
 * non-overlapping arrangement supersedes this record; it is the audit pointer
 * that keeps the replaced record in history without destroying it.
 */
export interface CommercialArrangementBase {
  id: string;
  customerId: string;
  status: CommercialArrangementStatus;
  effectiveFrom: string;
  /** Optional expiry/termination timestamp. `null` means still open-ended. */
  effectiveTo: string | null;
  createdAt: string;
  /** Operator-provided reason (replacement, termination, etc.). */
  reason: string;
  /**
   * Id of the later arrangement that supersedes this one, or `null` when this
   * record is still the effective one. Set only by a clean replacement whose
   * effective range does not overlap this record's.
   */
  replacedByArrangementId: string | null;
}

/**
 * Monthly subscription — fixed recurring monthly amount, always billed in USD.
 * `billingCadence` is fixed at `"monthly"`; the model discriminant is
 * `"monthly"`.
 */
export interface MonthlyCommercialArrangement
  extends CommercialArrangementBase {
  model: "monthly";
  currency: "USD";
  billingCadence: "monthly";
  /** Fixed monthly amount in integer cents (>= 0). */
  monthlyAmountCents: number;
  /** Next renewal date as an ISO-8601 timestamp. */
  renewsAt: string;
}

/**
 * Prepaid usage balance. The detailed usage ledger is added in Phase 2; this
 * record only stores the USD balance and optional expiry.
 */
export interface PrepaidCommercialArrangement
  extends CommercialArrangementBase {
  model: "prepaid";
  currency: "USD";
  /**
   * Current monetary balance in integer cents (>= 0). This is a stored term,
   * not a ledger balance: Phase 2 introduces the debit/adjustment ledger that
   * will drive this value.
   */
  balanceCents: number;
  expiresAt: string | null;
  /** Optional operator note (e.g. the origin of a top-up). May be empty. */
  notes?: string;
}

/**
 * Renewal posture of an annual contract at the current instant. This is a
 * stored term (operator-set), not a computed billing state.
 */
export type AnnualRenewalStatus =
  | "renewing"
  | "review"
  | "non-renewing"
  | "unknown";

/**
 * Unit of measurement for an annual contract's included allowance. An explicit
 * union keeps the UI and rules honest; free-form text is rejected on write.
 */
export type AllowanceUnit = "tokens" | "seats" | "requests" | "usd" | "other";

/**
 * Annual contract with an included allowance and overage rate. Detailed
 * usage/overage calculation is Phase 2; the terms are stored here only.
 */
export interface AnnualCommercialArrangement
  extends CommercialArrangementBase {
  model: "annual";
  currency: "USD";
  /** Total contract value in integer cents (>= 0). */
  contractValueCents: number;
  startsAt: string;
  endsAt: string;
  /**
   * Renewal posture of the contract. Defaults to `"unknown"` when not yet
   * recorded so history renders as "Not recorded" rather than a guess.
   */
  renewalStatus: AnnualRenewalStatus;
  /**
   * Operator note (renewal intent, closeout, etc.). Optional/empty when not
   * recorded.
   */
  notes?: string;
  /** Included usage allowance as a non-negative integer count. */
  includedAllowance: number;
  /** Unit of measurement for the included allowance. */
  allowanceUnit: AllowanceUnit;
  /**
   * Overage rate in integer cents per unit (>= 0). Stored only; no overage
   * amount is computed in this milestone.
   */
  overageRateCentsPerUnit: number;
}

/** Discriminated union of the three supported commercial models. */
export type CommercialArrangement =
  | MonthlyCommercialArrangement
  | PrepaidCommercialArrangement
  | AnnualCommercialArrangement;

// ---------------------------------------------------------------------------
// Agent access grants
// ---------------------------------------------------------------------------

/** Deterministic access state as of an explicit timestamp. */
export type AgentAccessStatus =
  | "scheduled"
  | "active"
  | "expired"
  | "revoked";

/**
 * A customer's access to run a catalog {@link AgentProduct}.
 *
 * `startsAt` is the ISO-8601 date access becomes active; `endsAt` is optional
 * and means access naturally expires before/during that date. `revokedAt`
 * records an operator-initiated immediate revocation, and `scheduledRevokeAt`
 * a revocation that will take effect on a future date. `reasonForChange`
 * explains the change in human-readable language.
 */
export interface AgentAccessGrant {
  id: string;
  customerId: string;
  agentProductId: string;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  scheduledRevokeAt: string | null;
  /** Linked activity event id that recorded the creation of this grant. */
  activityEventId: string;
  reasonForChange: string;
}

// ---------------------------------------------------------------------------
// Activity events
// ---------------------------------------------------------------------------

export type ActivitySource = "operator" | "system" | "migration";

/**
 * An immutable, append-only timeline entry for a commercial or access change.
 */
export interface ActivityEvent {
  id: string;
  occurredAt: string;
  source: ActivitySource;
  type: "commercial.created" | "commercial.ended" | "commercial.terminated" | "access.granted" | "access.revoked";
  /** Customer id for customer-scoped events. */
  customerId: string;
  /** Human-readable action label. */
  label: string;
  /** Primary subject (arrangement or grant) id. */
  subjectId: string;
  /** Optional secondary subject id (e.g. product id). */
  subjectId2?: string;
  /** Resulting state label for the subject (e.g. "active", "revoked"). */
  resultingState: string;
  /** Optional causation id (event that triggered this one). */
  causationId?: string;
}

// ---------------------------------------------------------------------------
// Storage schemas
// ---------------------------------------------------------------------------

/**
 * Canonical, versioned persisted store (`schemaVersion: 2`).
 *
 * `commercialArrangements`, `agentAccessGrants`, and `activityEvents` are the
 * active generalized records. `customers`, `featureEntitlements`, and
 * `agentProducts` continue to hold shared data. Legacy v1-only collections
 * (`subscriptions`, `agentLicenses`) are intentionally absent; their meaning
 * is carried by the active records after migration.
 */
export interface DataStore {
  schemaVersion: 2;
  customers: Customer[];
  featureEntitlements: FeatureEntitlement[];
  agentProducts: AgentProduct[];
  commercialArrangements: CommercialArrangement[];
  agentAccessGrants: AgentAccessGrant[];
  activityEvents: ActivityEvent[];
}

/**
 * Historical v1 store shape. Referenced by migration tests, never as the
 * active shape. `subscriptions` and `agentLicenses` are the migration inputs
 * only.
 */
export interface DataStoreV1 {
  customers: Customer[];
  subscriptions: Subscription[];
  featureEntitlements: FeatureEntitlement[];
  agentProducts: AgentProduct[];
  agentLicenses: AgentLicense[];
}

// ---------------------------------------------------------------------------
// Legacy records (migration inputs — DO NOT add new UI based on these)
// ---------------------------------------------------------------------------

/**
 * An active or historical subscription tied to a customer.
 * Retained for backward-compatible migration from v1 stores only.
 */
export interface Subscription {
  id: string;
  customerId: string;
  plan: PlanTier;
  agentProductId: string;
  seats: number;
  startedAt: string;
  renewsAt: string;
  status: "active" | "cancelled" | "trialing";
}

/**
 * A capability unlocked for a customer by a subscription.
 */
export interface FeatureEntitlement {
  id: string;
  customerId: string;
  feature: string;
  description: string;
  grantedAt: string;
  expiresAt: string | null;
}

/**
 * An agent product sold through the Hivarium catalog.
 */
export interface AgentProduct {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  plans: PlanTier[];
}

export type LicenseStatus = "active" | "expiring" | "expired" | "revoked";

/**
 * A customer's license to run a specific agent product.
 * Retained for backward-compatible migration from v1 stores only.
 */
export interface AgentLicense {
  id: string;
  customerId: string;
  agentProductId: string;
  seats: number;
  issuedAt: string;
  expiresAt: string | null;
  status: LicenseStatus;
}

// ---------------------------------------------------------------------------
// Constants and helpers
// ---------------------------------------------------------------------------

/** Current schema version for the persisted store. */
export const STORE_SCHEMA_VERSION = 2 as const;

export const CUSTOMER_STATUSES: readonly CustomerStatus[] = [
  "evaluation",
  "active",
  "paused",
  "churned",
];

const LEGACY_STATUS_ALIASES: Record<string, CustomerStatus> = {
  trial: "evaluation",
  evaluation: "evaluation",
  active: "active",
  paused: "paused",
  churned: "churned",
};

/**
 * Coerce an arbitrary (possibly unvalidated) status value into a canonical
 * {@link CustomerStatus}. Unknown values fall back to `"evaluation"`.
 */
export function normalizeCustomerStatus(value: unknown): CustomerStatus {
  if (typeof value !== "string") return "evaluation";
  return LEGACY_STATUS_ALIASES[value] ?? "evaluation";
}
