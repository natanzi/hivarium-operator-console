/**
 * Pure, side-effect-free rules for commercial arrangements and agent access.
 *
 * These functions are deterministic and operate only on their arguments, so
 * they are trivially unit-testable and safe to call from the UI and the
 * repository alike. The repository uses them for validation on write and
 * for as-of state resolution at read time.
 */

import {
  normalizeCustomerStatus,
  type AgentAccessGrant,
  type AgentAccessStatus,
  type CommercialArrangement,
  type CustomerStatus,
  type MonthlyCommercialArrangement,
  type PlanTier,
} from "./types";

// ---------------------------------------------------------------------------
// Instant helpers
// ---------------------------------------------------------------------------

function parseInstant(value: string): number {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

// ---------------------------------------------------------------------------
// Commercial arrangement validation
// ---------------------------------------------------------------------------

export type CommercialArrangementModel =
  | Exclude<CommercialArrangement["model"], string>
  | "monthly"
  | "prepaid"
  | "annual";

const ARRANGEMENT_MODELS: CommercialArrangementModel[] = [
  "monthly",
  "prepaid",
  "annual",
];

const ISO_DATE_REGEX =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function isIso(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    ISO_DATE_REGEX.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isNonNegInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

export interface CommercialArrangementValidation {
  ok: boolean;
  problems: string[];
}

/**
 * Loose, unvalidated input shape accepted by the arrangement validators.
 *
 * Every field is `unknown` so callers can pass untrusted form or storage
 * values; the validators narrow and reject anything malformed. This is the
 * input contract for {@link validateCommercialArrangement} and the
 * repository's `saveCommercialArrangement`.
 */
export interface CommercialArrangementInput {
  model?: unknown;
  id?: unknown;
  customerId?: unknown;
  status?: unknown;
  effectiveFrom?: unknown;
  effectiveTo?: unknown;
  createdAt?: unknown;
  reason?: unknown;
  currency?: unknown;
  billingCadence?: unknown;
  monthlyAmountCents?: unknown;
  renewsAt?: unknown;
  balanceCents?: unknown;
  expiresAt?: unknown;
  contractValueCents?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  includedAllowance?: unknown;
  allowanceUnit?: unknown;
  overageRateCents?: unknown;
}

function fail(...problems: string[]): CommercialArrangementValidation {
  return { ok: false, problems };
}

function ok(): CommercialArrangementValidation {
  const problems: string[] = [];
  return { ok: problems.length === 0, problems };
}

interface ArrangementCoreIssues {
  problems: string[];
  customerId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

function validateCore(
  input: CommercialArrangementInput
): ArrangementCoreIssues | null {
  const problems: string[] = [];

  if (!ARRANGEMENT_MODELS.includes(input.model as CommercialArrangementModel)) {
    problems.push("model must be 'monthly', 'prepaid', or 'annual'.");
    return null;
  }

  if (typeof input.id !== "string" || input.id.trim().length === 0) {
    problems.push("id is required.");
  }
  if (typeof input.customerId !== "string" || input.customerId.trim().length === 0) {
    problems.push("customerId is required.");
  }
  if (!isIso(input.effectiveFrom)) {
    problems.push("effectiveFrom must be a valid ISO-8601 timestamp.");
  }
  // effectiveTo is only required as-is when the status is not open-ended;
  // the type allows null, but a `null` value is acceptable for active/scheduled.
  if (
    input.effectiveTo !== null &&
    input.effectiveTo !== undefined &&
    !isIso(input.effectiveTo)
  ) {
    problems.push("effectiveTo must be a valid ISO-8601 timestamp or null.");
  }
  // effectiveFrom must be <= effectiveTo when both are present
  if (
    isIso(input.effectiveFrom) &&
    input.effectiveTo !== null &&
    input.effectiveTo !== undefined &&
    isIso(input.effectiveTo) &&
    parseInstant(input.effectiveTo!) < parseInstant(input.effectiveFrom)
  ) {
    problems.push(
      "effectiveTo must not be earlier than effectiveFrom."
    );
  }
  if (typeof input.createdAt !== "string" || !isIso(input.createdAt)) {
    problems.push("createdAt must be a valid ISO-8601 timestamp.");
  }

  if (
    typeof input.status !== "string" ||
    !["active", "scheduled", "ended", "terminated"].includes(
      input.status as string
    )
  ) {
    problems.push("status must be active, scheduled, ended, or terminated.");
  }

  const effectiveFrom = (
    typeof input.effectiveFrom === "string" ? input.effectiveFrom : ""
  ).trim();
  const effectiveTo =
    input.effectiveTo === null || input.effectiveTo === undefined
      ? null
      : (input.effectiveTo as string).trim();
  const customerId =
    typeof input.customerId === "string" ? input.customerId.trim() : "";

  return {
    problems,
    customerId,
    effectiveFrom,
    effectiveTo,
  };
}

interface ModelSpecificIssues {
  ok: boolean;
  problems: string[];
}

function validateMonthly(
  input: CommercialArrangementInput
): ModelSpecificIssues {
  const problems: string[] = [];
  if (input.currency !== "USD") problems.push("currency must be 'USD'.");
  if (input.billingCadence !== "monthly") {
    problems.push("billingCadence must be 'monthly'.");
  }
  if (!isNonNegInt(input.monthlyAmountCents)) {
    problems.push(
      "monthlyAmountCents must be a non-negative integer number of cents."
    );
  }
  if (!isIso(input.renewsAt)) {
    problems.push("renewsAt must be a valid ISO-8601 timestamp.");
  }
  return { ok: problems.length === 0, problems };
}

function validatePrepaid(
  input: CommercialArrangementInput
): ModelSpecificIssues {
  const problems: string[] = [];
  if (input.currency !== "USD") problems.push("currency must be 'USD'.");
  if (!isNonNegInt(input.balanceCents)) {
    problems.push("balanceCents must be a non-negative integer number of cents.");
  }
  if (
    input.expiresAt !== null &&
    input.expiresAt !== undefined &&
    !isIso(input.expiresAt)
  ) {
    problems.push("expiresAt must be a valid ISO-8601 timestamp or null.");
  }
  return { ok: problems.length === 0, problems };
}

function validateAnnual(
  input: CommercialArrangementInput
): ModelSpecificIssues {
  const problems: string[] = [];
  if (input.currency !== "USD") problems.push("currency must be 'USD'.");
  if (!isNonNegInt(input.contractValueCents)) {
    problems.push(
      "contractValueCents must be a non-negative integer number of cents."
    );
  }
  if (!isIso(input.startsAt)) {
    problems.push("startsAt must be a valid ISO-8601 timestamp.");
  }
  if (!isIso(input.endsAt)) {
    problems.push("endsAt must be a valid ISO-8601 timestamp.");
  }
  if (
    isIso(input.startsAt) &&
    isIso(input.endsAt) &&
    parseInstant(input.endsAt) < parseInstant(input.startsAt)
  ) {
    problems.push("endsAt must not be earlier than startsAt.");
  }
  if (!isNonNegInt(input.includedAllowance)) {
    problems.push("includedAllowance must be a non-negative integer.");
  }
  if (
    typeof input.allowanceUnit !== "string" ||
    input.allowanceUnit.trim().length === 0
  ) {
    problems.push("allowanceUnit is required (e.g. 'tokens').");
  }
  if (!isNonNegInt(input.overageRateCents)) {
    problems.push(
      "overageRateCents must be a non-negative integer number of cents."
    );
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Validate a single commercial arrangement record, including model-specific
 * invariants. Returns `ok: true` when the record is internally consistent.
 */
export function validateCommercialArrangement(
  input: CommercialArrangementInput
): CommercialArrangementValidation {
  const core = validateCore(input);
  if (core === null) {
    return fail("model must be 'monthly', 'prepaid', or 'annual'.");
  }
  const problems = [...core.problems];

  const model = input.model as CommercialArrangementModel;
  if (model === "monthly") {
    const m = validateMonthly(input);
    problems.push(...m.problems);
  } else if (model === "prepaid") {
    const m = validatePrepaid(input);
    problems.push(...m.problems);
  } else if (model === "annual") {
    const m = validateAnnual(input);
    problems.push(...m.problems);
  }

  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    problems.push("reason is required.");
  }

  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// As-of commercial arrangement state
// ---------------------------------------------------------------------------

export type ArrangementAsOfStatus =
  | "active"
  | "scheduled"
  | "ended"
  | "terminated";

/**
 * Compute the as-of lifecycle state of a commercial arrangement at a point
 * in time. The result is deterministic given `(arrangement, at)`.
 *
 * - `terminated` always wins (human action, irreversible).
 * - `ended` wins over time-based evaluation.
 * - `active` if `effectiveFrom <= at` and no expiry, or `at <= effectiveTo`.
 * - `scheduled` if `at < effectiveFrom`.
 * - If `at` is past `effectiveTo` (and status is not terminated/ended), the
 *   arrangement is treated as `ended` — a natural expiry.
 */
export function resolveArrangementAsOf(
  arrangement: CommercialArrangement,
  at: string | number
): ArrangementAsOfStatus {
  const atMs =
    typeof at === "number" ? at : parseInstant(at);

  if (arrangement.status === "terminated") return "terminated";
  if (arrangement.status === "ended") return "ended";

  const fromMs = parseInstant(arrangement.effectiveFrom);
  if (atMs < fromMs) return "scheduled";

  // Annual contracts have a hard end; natural expiry beyond endsAt is "ended".
  if (arrangement.model === "annual" && parseInstant(arrangement.endsAt) < atMs) {
    return "ended";
  }

  if (
    arrangement.effectiveTo !== null &&
    arrangement.effectiveTo !== undefined &&
    parseInstant(arrangement.effectiveTo) < atMs
  ) {
    return "ended";
  }

  return "active";
}

/**
 * Resolve a customer status from a legacy subscription `status` value into a
 * normalized {@link CustomerStatus}. Kept as a convenience for the migration
 * step so the repository doesn't need to know legacy alias names.
 */
export function legacySubscriptionStatusToCustomerStatus(
  legacyStatus: string
): CustomerStatus {
  switch (legacyStatus) {
    case "active":
      return "active";
    case "cancelled":
      return "churned";
    case "trialing":
      return "evaluation";
    default:
      return normalizeCustomerStatus(legacyStatus);
  }
}

/**
 * Deterministic monthly amount (in cents) for a plan tier when migrating a
 * legacy subscription to a monthly arrangement. These are placeholder USD
 * prices that keep seeded monthly values stable and human-readable.
 */
export function planTierMonthlyAmountCents(
  plan: string
): number {
  switch (plan) {
    case "starter":
      return 4900;
    case "growth":
      return 14900;
    case "scale":
      return 49000;
    case "enterprise":
      return 199000;
    default:
      return 4900;
  }
}

/**
 * Inverse of {@link planTierMonthlyAmountCents}: recover the canonical plan
 * tier from a monthly amount in cents. Used only by the legacy compatibility
 * projection in the repository; unknown amounts fall back to `"starter"`.
 */
export function planTierFromMonthlyAmountCents(
  amountCents: number
): PlanTier {
  switch (amountCents) {
    case 4900:
      return "starter";
    case 14900:
      return "growth";
    case 49000:
      return "scale";
    case 199000:
      return "enterprise";
    default:
      return "starter";
  }
}

/**
 * Build a canonical `MonthlyCommercialArrangement` from a legacy
 * `Subscription`-shaped record. Used only by the v1 → v2 store migration.
 *
 * The caller is responsible for assigning a stable `id` (the migration maps
 * each legacy subscription to `arr_<subscription id>`); this helper only
 * shapes the rest of the record.
 */
export function subscriptionToMonthlyArrangement(
  input: {
    id: string;
    customerId: string;
    plan: string;
    seats: number;
    startedAt: string;
    renewsAt: string;
    status: "active" | "cancelled" | "trialing";
  },
  options: { now: string }
): MonthlyCommercialArrangement {
  const fromMs = parseInstant(input.startedAt);
  const nowMs = parseInstant(options.now);
  const renewedMs = parseInstant(input.renewsAt);

  const status: MonthlyCommercialArrangement["status"] =
    input.status === "cancelled"
      ? "terminated"
      : fromMs > nowMs
        ? "scheduled"
        : renewedMs < nowMs
          ? (renewedMs > fromMs ? "active" : "ended")
          : "active";

  // If the subscription is expired (renewed before now and now after renewal)
  // keep it as "active" if the renewal date is in the future relative to
  // start — i.e., a recurring subscription with an upcoming renewal is
  // still active. The `status: "ended"` fallback only applies when the
  // renewal date was before the start date (data anomaly).
  if (status === "active" && renewedMs < nowMs) {
    // The renewal has passed; a recurring subscription implicitly rolls
    // forward, so it remains active. No further action is needed here.
  }

  return {
    id: input.id,
    customerId: input.customerId,
    status,
    model: "monthly",
    currency: "USD",
    billingCadence: "monthly",
    monthlyAmountCents: planTierMonthlyAmountCents(input.plan),
    effectiveFrom: input.startedAt,
    effectiveTo: null,
    renewsAt: input.renewsAt,
    createdAt: options.now,
    reason: `Migrated from legacy ${input.plan} subscription.`,
  };
}

// ---------------------------------------------------------------------------
// Agent access grant validation and as-of state
// ---------------------------------------------------------------------------

/**
 * Loose, unvalidated input shape accepted by the agent-access validators.
 * Every field is `unknown` so untrusted form or storage values can be passed
 * in and narrowed by {@link validateAgentAccessGrant}.
 */
export interface AgentAccessGrantInput {
  id?: unknown;
  customerId?: unknown;
  agentProductId?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  createdAt?: unknown;
  revokedAt?: unknown;
  scheduledRevokeAt?: unknown;
  activityEventId?: unknown;
  reasonForChange?: unknown;
}

export interface AgentAccessGrantValidation {
  ok: boolean;
  problems: string[];
}

/**
 * Validate the operator-supplied fields of an agent access grant. The
 * repository additionally checks customer/product existence and duplicate
 * active/scheduled access before writing.
 */
export function validateAgentAccessGrant(
  input: AgentAccessGrantInput
): AgentAccessGrantValidation {
  const problems: string[] = [];

  if (
    typeof input.customerId !== "string" ||
    input.customerId.trim().length === 0
  ) {
    problems.push("customerId is required.");
  }
  if (
    typeof input.agentProductId !== "string" ||
    input.agentProductId.trim().length === 0
  ) {
    problems.push("agentProductId is required.");
  }
  if (!isIso(input.startsAt)) {
    problems.push("startsAt must be a valid ISO-8601 timestamp.");
  }
  if (
    input.endsAt !== null &&
    input.endsAt !== undefined &&
    !isIso(input.endsAt)
  ) {
    problems.push("endsAt must be a valid ISO-8601 timestamp or null.");
  }
  if (
    isIso(input.startsAt) &&
    input.endsAt !== null &&
    input.endsAt !== undefined &&
    isIso(input.endsAt) &&
    parseInstant(input.endsAt) < parseInstant(input.startsAt)
  ) {
    problems.push("endsAt must not be earlier than startsAt.");
  }
  if (
    typeof input.reasonForChange !== "string" ||
    input.reasonForChange.trim().length === 0
  ) {
    problems.push("reasonForChange is required.");
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Compute the as-of access state of an agent access grant at a point in time.
 * The result is deterministic given `(grant, at)`.
 *
 * - `revoked` wins (immediate `revokedAt` or a `scheduledRevokeAt` that has
 *   taken effect).
 * - `scheduled` if `at` is before `startsAt`.
 * - `expired` if `endsAt` is present and `at` is past it.
 * - otherwise `active`.
 */
export function resolveAgentAccessStatus(
  grant: AgentAccessGrant,
  at: string | number
): AgentAccessStatus {
  const atMs = typeof at === "number" ? at : parseInstant(at);

  if (grant.revokedAt !== null && parseInstant(grant.revokedAt) <= atMs) {
    return "revoked";
  }
  if (
    grant.scheduledRevokeAt !== null &&
    parseInstant(grant.scheduledRevokeAt) <= atMs
  ) {
    return "revoked";
  }
  if (atMs < parseInstant(grant.startsAt)) {
    return "scheduled";
  }
  if (grant.endsAt !== null && parseInstant(grant.endsAt) < atMs) {
    return "expired";
  }
  return "active";
}

/**
 * Find an existing grant that would conflict with a new grant for the same
 * customer and agent product: one that is already `active` or `scheduled` as
 * of `at`. Returns the conflicting grant, or `undefined` when the access can
 * be granted.
 */
export function findConflictingAccessGrant(
  grants: readonly AgentAccessGrant[],
  input: { customerId: string; agentProductId: string },
  at: string | number
): AgentAccessGrant | undefined {
  return grants.find(
    (grant) =>
      grant.customerId === input.customerId &&
      grant.agentProductId === input.agentProductId &&
      (resolveAgentAccessStatus(grant, at) === "active" ||
        resolveAgentAccessStatus(grant, at) === "scheduled")
  );
}

/**
 * Convenience boolean form of {@link findConflictingAccessGrant}.
 */
export function hasActiveOrScheduledAccess(
  grants: readonly AgentAccessGrant[],
  input: { customerId: string; agentProductId: string },
  at: string | number
): boolean {
  return findConflictingAccessGrant(grants, input, at) !== undefined;
}
