/**
 * Hivarium Operator Console — domain models.
 *
 * These are plain-data types shared by the data layer (repository, seed
 * data) and the UI. They are intentionally serializable so they can be
 * persisted to localStorage as-is.
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

/**
 * An active or historical subscription tied to a customer.
 *
 * @property id                Stable, deterministic identifier.
 * @property customerId        Owning customer id.
 * @property plan              Commercial tier the customer is on.
 * @property agentProductId    Agent product the subscription unlocks.
 * @property seats             Provisioned seat count.
 * @property startedAt         ISO-8601 subscription start date.
 * @property renewsAt          ISO-8601 next renewal date.
 * @property status            Whether the subscription is currently live or not.
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
 *
 * @property id            Stable, deterministic identifier.
 * @property customerId    Owning customer id.
 * @property feature       Machine-readable feature key (e.g. "webhooks").
 * @property description   Human-readable summary of the capability.
 * @property grantedAt     ISO-8601 date the entitlement was granted.
 * @property expiresAt     ISO-8601 date the entitlement expires (nullable).
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
 *
 * @property id          Stable, deterministic identifier (e.g. "agent_sentinel").
 * @property name        Product display name.
 * @property description Short marketing/summary text.
 * @property category    Catalog grouping key.
 * @property version     Currently-published product version.
 * @property plans       Plan tiers at which the product is offered.
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
 *
 * @property id              Stable, deterministic identifier.
 * @property customerId      Owning customer id.
 * @property agentProductId  Licensed agent product id.
 * @property seats           Licensed seat count.
 * @property issuedAt        ISO-8601 issue date.
 * @property expiresAt       ISO-8601 expiry date (nullable).
 * @property status          Derived lifecycle state of the license.
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

/**
 * All collections the console operates on.
 */
export interface DataStore {
  customers: Customer[];
  subscriptions: Subscription[];
  featureEntitlements: FeatureEntitlement[];
  agentProducts: AgentProduct[];
  agentLicenses: AgentLicense[];
}

export const CUSTOMER_STATUSES: readonly CustomerStatus[] = [
  "evaluation",
  "active",
  "paused",
  "churned",
];

/**
 * Legacy status values that older persisted stores may still contain. These
 * are mapped to their current canonical form so the UI never renders a stale
 * label. (The "trial" → "evaluation" rename happened after v1 seeding.)
 */
const LEGACY_STATUS_ALIASES: Record<string, CustomerStatus> = {
  trial: "evaluation",
  evaluation: "evaluation",
  active: "active",
  paused: "paused",
  churned: "churned",
};

/**
 * Coerce an arbitrary (possibly unvalidated) status value into a canonical
 * {@link CustomerStatus}. Unknown values fall back to `"evaluation"`. This is
 * the single place the "trial" → "evaluation" migration is applied, and it is
 * used by the repository whenever a store is loaded from storage so that
 * legacy localStorage payloads normalize transparently.
 */
export function normalizeCustomerStatus(
  value: unknown
): CustomerStatus {
  if (typeof value !== "string") return "evaluation";
  return LEGACY_STATUS_ALIASES[value] ?? "evaluation";
}
