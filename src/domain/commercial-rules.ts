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
  type ActivityEvent,
  type ActivitySource,
  type AgentAccessGrant,
  type AgentAccessStatus,
  type AnnualCommercialArrangement,
  type AnnualRenewalStatus,
  type AllowanceUnit,
  type CommercialArrangement,
  type CommercialArrangementStatus,
  type CustomerStatus,
  type DataStore,
  type MonthlyCommercialArrangement,
  type PlanTier,
  type PrepaidCommercialArrangement,
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
  replacedByArrangementId?: unknown;
  notes?: unknown;
  currency?: unknown;
  billingCadence?: unknown;
  monthlyAmountCents?: unknown;
  renewsAt?: unknown;
  warningThresholdTokens?: unknown;
  expiresAt?: unknown;
  contractValueCents?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  renewalStatus?: unknown;
  includedAllowance?: unknown;
  allowanceUnit?: unknown;
  overageRateCents?: unknown;
  overageRateCentsPerUnit?: unknown;
}

const RENEWAL_STATUSES: AnnualRenewalStatus[] = [
  "renewing",
  "review",
  "non-renewing",
  "unknown",
];

const ALLOWANCE_UNITS: AllowanceUnit[] = [
  "tokens",
  "seats",
  "requests",
  "usd",
  "other",
];

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

  // replacedByArrangementId is optional; when present it must reference a
  // non-empty arrangement id. Its non-cyclicity is enforced by the transition
  // rules, not here.
  if (
    input.replacedByArrangementId !== null &&
    input.replacedByArrangementId !== undefined &&
    (typeof input.replacedByArrangementId !== "string" ||
      (input.replacedByArrangementId as string).trim().length === 0)
  ) {
    problems.push(
      "replacedByArrangementId must be a non-empty string or null."
    );
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
  if (
    input.warningThresholdTokens !== undefined &&
    input.warningThresholdTokens !== null &&
    !isNonNegInt(input.warningThresholdTokens)
  ) {
    problems.push(
      "warningThresholdTokens must be a non-negative integer number of tokens."
    );
  }
  if (
    input.expiresAt !== null &&
    input.expiresAt !== undefined &&
    !isIso(input.expiresAt)
  ) {
    problems.push("expiresAt must be a valid ISO-8601 timestamp or null.");
  }
  if (input.notes !== undefined && input.notes !== null && typeof input.notes !== "string") {
    problems.push("notes must be a string when provided.");
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
    !ALLOWANCE_UNITS.includes(input.allowanceUnit as AllowanceUnit)
  ) {
    problems.push(
      "allowanceUnit must be 'tokens', 'seats', 'requests', 'usd', or 'other'."
    );
  }
  if (!isNonNegInt(input.overageRateCentsPerUnit)) {
    problems.push(
      "overageRateCentsPerUnit must be a non-negative integer number of cents."
    );
  }
  if (
    input.renewalStatus !== undefined &&
    input.renewalStatus !== null &&
    !RENEWAL_STATUSES.includes(input.renewalStatus as AnnualRenewalStatus)
  ) {
    problems.push(
      "renewalStatus must be 'renewing', 'review', 'non-renewing', or 'unknown'."
    );
  }
  if (
    input.notes !== undefined &&
    input.notes !== null &&
    typeof input.notes !== "string"
  ) {
    problems.push("notes must be a string when provided.");
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
    replacedByArrangementId: null,
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

// ---------------------------------------------------------------------------
// Stable event-ID helpers
// ---------------------------------------------------------------------------

/**
 * Stable activity event id for the creation of a commercial arrangement.
 * Deterministic per arrangement id so replays never duplicate the record.
 */
export function commercialCreatedEventId(arrangementId: string): string {
  return `evt_${arrangementId}`;
}

/**
 * Stable activity event id for the natural expiry of a commercial arrangement.
 */
export function commercialEndedEventId(arrangementId: string): string {
  return `evt_${arrangementId}_ended`;
}

/**
 * Stable activity event id for the operator-initiated termination of a
 * commercial arrangement. This id doubles as the `causationId` for every
 * automatic access revocation the termination triggers.
 */
export function commercialTerminatedEventId(arrangementId: string): string {
  return `evt_${arrangementId}_terminated`;
}

/**
 * Stable activity event id for an immediate access revocation. Deterministic
 * per grant id so automatic revocations are idempotent across replays.
 */
export function accessRevokedEventId(grantId: string): string {
  return `evt_${grantId}_revoked`;
}

/**
 * Stable activity event id for a scheduled (future-dated) access revocation.
 * Distinct from {@link accessRevokedEventId} so an immediate override of a
 * scheduled revocation never collides with the earlier event.
 */
export function accessRevokeScheduledEventId(grantId: string): string {
  return `evt_${grantId}_revoke_scheduled`;
}

// ---------------------------------------------------------------------------
// Arrangement shaping
// ---------------------------------------------------------------------------

/**
 * Build a canonical {@link CommercialArrangement} from validated input.
 *
 * The caller is responsible for running {@link validateCommercialArrangement}
 * first; this helper only narrows the loose input shape into the typed record.
 * Missing optional fields default deterministically (`replacedByArrangementId`
 * to `null`, annual `renewalStatus` to `"unknown"`).
 */
export function buildArrangementFromInput(
  input: CommercialArrangementInput,
  occurredAt: string
): CommercialArrangement {
  const base = {
    id: input.id as string,
    customerId: input.customerId as string,
    status: input.status as CommercialArrangementStatus,
    effectiveFrom: input.effectiveFrom as string,
    effectiveTo: (input.effectiveTo as string | null) ?? null,
    createdAt: (input.createdAt as string) ?? occurredAt,
    reason: input.reason as string,
    replacedByArrangementId:
      (input.replacedByArrangementId as string | null) ?? null,
  };
  const model = input.model as CommercialArrangement["model"];
  if (model === "monthly") {
    return {
      ...base,
      model,
      currency: "USD",
      billingCadence: "monthly",
      monthlyAmountCents: input.monthlyAmountCents as number,
      renewsAt: input.renewsAt as string,
    };
  }
  if (model === "prepaid") {
    return {
      ...base,
      model,
      warningThresholdTokens:
        (input.warningThresholdTokens as number | undefined) ?? 100,
      expiresAt: (input.expiresAt as string | null) ?? null,
      notes: input.notes as string | undefined,
    };
  }
  return {
    ...base,
    model: "annual",
    currency: "USD",
    contractValueCents: input.contractValueCents as number,
    startsAt: input.startsAt as string,
    endsAt: input.endsAt as string,
    renewalStatus: (input.renewalStatus as AnnualRenewalStatus) ?? "unknown",
    notes: input.notes as string | undefined,
    includedAllowance: input.includedAllowance as number,
    allowanceUnit: input.allowanceUnit as AllowanceUnit,
    overageRateCentsPerUnit: input.overageRateCentsPerUnit as number,
  };
}

// ---------------------------------------------------------------------------
// As-of commercial state projection
// ---------------------------------------------------------------------------

/**
 * Deterministic as-of projection of a customer's commercial arrangements.
 *
 * - `active` is the single arrangement in force at `asOf`, or `null`.
 * - `scheduled` is the earliest future-dated successor, or `null`.
 * - `history` is every arrangement ordered newest first (by `effectiveFrom`).
 *
 * The projection is pure: it never mutates the input records.
 */
export interface CommercialStateProjection {
  active: CommercialArrangement | null;
  scheduled: CommercialArrangement | null;
  history: CommercialArrangement[];
}

export function projectCommercialState(
  records: readonly CommercialArrangement[],
  asOf: string | number
): CommercialStateProjection {
  const active =
    records.find(
      (arrangement) => resolveArrangementAsOf(arrangement, asOf) === "active"
    ) ?? null;
  const scheduled =
    records
      .filter(
        (arrangement) =>
          resolveArrangementAsOf(arrangement, asOf) === "scheduled"
      )
      .sort(
        (a, b) => parseInstant(a.effectiveFrom) - parseInstant(b.effectiveFrom)
      )[0] ?? null;
  const history = [...records].sort(
    (a, b) => parseInstant(b.effectiveFrom) - parseInstant(a.effectiveFrom)
  );
  return { active, scheduled, history };
}

// ---------------------------------------------------------------------------
// Commercial transitions
// ---------------------------------------------------------------------------

export interface CommercialTransitionResult {
  store: DataStore;
  arrangement: CommercialArrangement;
  event: ActivityEvent;
}

/**
 * Apply a validated commercial arrangement write to a store, handling both
 * first arrangements and immediate/scheduled replacements.
 *
 * - Immediate (`effectiveFrom <= occurredAt`): the currently active
 *   arrangement is closed at the boundary (`status: "ended"`,
 *   `effectiveTo` set, `replacedByArrangementId` pointing at the successor)
 *   and the successor is appended as `active`.
 * - Scheduled (`effectiveFrom > occurredAt`): the current arrangement stays
 *   active and the successor is appended as `scheduled`; the boundary close
 *   is performed later by {@link reconcileCommercialLifecycle}.
 *
 * The prior records are never mutated in place: a closed arrangement is a new
 * immutable copy, and the original object in the store is replaced by it.
 * Returns the new store, the created arrangement, and its typed activity
 * event. Throws on validation failure or duplicate arrangement id without
 * writing anything.
 */
export function applyCommercialTransition(
  store: DataStore,
  input: CommercialArrangementInput,
  occurredAt: string
): CommercialTransitionResult {
  const normalizedInput: CommercialArrangementInput = {
    ...input,
    createdAt: input.createdAt ?? occurredAt,
  };
  const validation = validateCommercialArrangement(normalizedInput);
  if (!validation.ok) {
    throw new Error(validation.problems.join(" "));
  }

  const customerId = normalizedInput.customerId as string;
  const effectiveFrom = normalizedInput.effectiveFrom as string;
  const isImmediate = parseInstant(effectiveFrom) <= parseInstant(occurredAt);

  const arrangement = buildArrangementFromInput(normalizedInput, occurredAt);
  const status: CommercialArrangementStatus = isImmediate
    ? "active"
    : "scheduled";
  const finalArrangement: CommercialArrangement = { ...arrangement, status };

  if (store.commercialArrangements.some((a) => a.id === finalArrangement.id)) {
    throw new Error(
      `Commercial arrangement with id "${finalArrangement.id}" already exists.`
    );
  }

  let arrangements = store.commercialArrangements;
  const active = arrangements.find(
    (a) =>
      a.customerId === customerId &&
      resolveArrangementAsOf(a, occurredAt) === "active"
  );

  if (active) {
    if (isImmediate) {
      // Close the current effective range at the boundary where the successor
      // takes over, keeping the replaced record immutable in history.
      const boundary =
        parseInstant(effectiveFrom) > parseInstant(active.effectiveFrom)
          ? effectiveFrom
          : occurredAt;
      arrangements = arrangements.map((a) =>
        a.id === active.id
          ? {
              ...a,
              status: "ended",
              effectiveTo: boundary,
              replacedByArrangementId: finalArrangement.id,
            }
          : a
      );
    }
    // Scheduled replacement: the current arrangement stays active until the
    // boundary; reconcileCommercialLifecycle closes it when the time arrives.
  }

  const event: ActivityEvent = {
    id: commercialCreatedEventId(finalArrangement.id),
    occurredAt,
    source: "operator",
    type: "commercial.created",
    customerId,
    label: `Created ${finalArrangement.model} commercial arrangement.`,
    subjectId: finalArrangement.id,
    resultingState: finalArrangement.status,
  };

  return {
    store: {
      ...store,
      commercialArrangements: [...arrangements, finalArrangement],
      activityEvents: [...store.activityEvents, event],
    },
    arrangement: finalArrangement,
    event,
  };
}

// ---------------------------------------------------------------------------
// Access revocation
// ---------------------------------------------------------------------------

export interface AccessRevocationInput {
  grantId: string;
  customerId: string;
  reason: string;
  /** Instant the revocation takes effect (now or an explicit future date). */
  effectiveAt: string;
  /** Instant the operator/system performed the action. */
  occurredAt: string;
  source?: ActivitySource;
  causationId?: string;
}

export interface AccessRevocationResult {
  store: DataStore;
  grant: AgentAccessGrant;
  event: ActivityEvent;
}

/**
 * Apply an access revocation to a store.
 *
 * - Immediate (`effectiveAt <= occurredAt`): the grant is marked `revokedAt`
 *   and any pending `scheduledRevokeAt` is cleared.
 * - Scheduled (`effectiveAt > occurredAt`): the grant keeps working until the
 *   boundary and records `scheduledRevokeAt`.
 *
 * The original grant record is retained (never deleted). A grant that is
 * already revoked rejects further revocation; a grant that is already
 * scheduled for revocation may be overridden by an immediate revocation.
 * Returns the new store, the updated grant, and its typed activity event.
 */
export function applyAccessRevocation(
  store: DataStore,
  input: AccessRevocationInput
): AccessRevocationResult {
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
  if (grant.revokedAt !== null) {
    throw new Error(`Agent access grant "${input.grantId}" is already revoked.`);
  }

  const immediate =
    parseInstant(input.effectiveAt) <= parseInstant(input.occurredAt);

  if (grant.scheduledRevokeAt !== null && !immediate) {
    throw new Error(
      `Agent access grant "${input.grantId}" is already scheduled for revocation.`
    );
  }

  const updatedGrant: AgentAccessGrant = immediate
    ? { ...grant, revokedAt: input.effectiveAt, scheduledRevokeAt: null }
    : { ...grant, scheduledRevokeAt: input.effectiveAt };

  const event: ActivityEvent = {
    id: immediate
      ? accessRevokedEventId(grant.id)
      : accessRevokeScheduledEventId(grant.id),
    occurredAt: input.occurredAt,
    source: input.source ?? "operator",
    type: "access.revoked",
    customerId: input.customerId,
    label: `Revoked access to agent product "${grant.agentProductId}".`,
    subjectId: grant.id,
    subjectId2: grant.agentProductId,
    resultingState: immediate ? "revoked" : "scheduled",
    causationId: input.causationId,
  };

  return {
    store: {
      ...store,
      agentAccessGrants: store.agentAccessGrants.map((g) =>
        g.id === grant.id ? updatedGrant : g
      ),
      activityEvents: [...store.activityEvents, event],
    },
    grant: updatedGrant,
    event,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle reconciliation
// ---------------------------------------------------------------------------

export interface LifecycleReconciliationResult {
  store: DataStore;
  changed: boolean;
}

/**
 * Reconcile a customer's commercial and access lifecycle at an explicit
 * instant. Pure and idempotent: running it twice at the same `asOf` produces
 * the same store and never duplicates revocations or activity records.
 *
 * 1. Scheduled arrangements whose `effectiveFrom` has arrived become
 *    `active`; the arrangement they supersede is closed (`status: "ended"`,
 *    `effectiveTo` set, `replacedByArrangementId` pointing at the successor).
 * 2. Arrangements whose term has passed (annual `endsAt` or `effectiveTo`)
 *    are marked `ended` and receive a `commercial.ended` activity event.
 * 3. When the customer has no active arrangement, every grant that is still
 *    active is revoked immediately with a `system`-sourced `access.revoked`
 *    event whose `causationId` points at the closure event of the most recent
 *    closed arrangement. Previously revoked grants are never restored.
 */
export function reconcileCommercialLifecycle(
  store: DataStore,
  customerId: string,
  asOf: string
): LifecycleReconciliationResult {
  let arrangements = store.commercialArrangements;
  let grants = store.agentAccessGrants;
  let events = store.activityEvents;
  let changed = false;

  const asOfMs = parseInstant(asOf);

  // 1. Activate scheduled arrangements whose effectiveFrom has arrived.
  const pending = arrangements
    .filter(
      (a) =>
        a.customerId === customerId &&
        a.status === "scheduled" &&
        parseInstant(a.effectiveFrom) <= asOfMs
    )
    .sort((a, b) => parseInstant(a.effectiveFrom) - parseInstant(b.effectiveFrom));

  for (const scheduled of pending) {
    const currentActive = arrangements.find(
      (a) =>
        a.customerId === customerId &&
        a.status === "active" &&
        a.id !== scheduled.id
    );
    if (currentActive) {
      arrangements = arrangements.map((a) =>
        a.id === currentActive.id
          ? {
              ...a,
              status: "ended",
              effectiveTo: scheduled.effectiveFrom,
              replacedByArrangementId: scheduled.id,
            }
          : a
      );
      changed = true;
    }
    arrangements = arrangements.map((a) =>
      a.id === scheduled.id ? { ...a, status: "active" } : a
    );
    changed = true;
  }

  // 2. Mark expired arrangements as ended and record their closure event.
  const expired = arrangements.filter(
    (a) =>
      a.customerId === customerId &&
      a.status === "active" &&
      (a.model === "annual"
        ? parseInstant(a.endsAt) < asOfMs
        : a.effectiveTo !== null && parseInstant(a.effectiveTo) < asOfMs)
  );

  for (const arrangement of expired) {
    arrangements = arrangements.map((a) =>
      a.id === arrangement.id ? { ...a, status: "ended" } : a
    );
    changed = true;
    const eventId = commercialEndedEventId(arrangement.id);
    if (!events.some((e) => e.id === eventId)) {
      events = [
        ...events,
        {
          id: eventId,
          occurredAt: asOf,
          source: "system",
          type: "commercial.ended",
          customerId,
          label: "Commercial arrangement ended by expiry.",
          subjectId: arrangement.id,
          resultingState: "ended",
        },
      ];
      changed = true;
    }
  }

  // 3. Revoke every still-active grant when no active arrangement exists.
  const hasActiveArrangement = arrangements.some(
    (a) =>
      a.customerId === customerId &&
      resolveArrangementAsOf(a, asOf) === "active"
  );

  if (!hasActiveArrangement) {
    const closed = arrangements
      .filter(
        (a) =>
          a.customerId === customerId &&
          (a.status === "ended" || a.status === "terminated")
      )
      .sort(
        (a, b) =>
          parseInstant(b.effectiveTo ?? b.effectiveFrom) -
          parseInstant(a.effectiveTo ?? a.effectiveFrom)
      );
    const trigger = closed[0];
    const triggerEventId = trigger
      ? trigger.status === "terminated"
        ? commercialTerminatedEventId(trigger.id)
        : commercialEndedEventId(trigger.id)
      : undefined;

    // Ensure the triggering closure event exists so the causation link is
    // never dangling (e.g. grants granted after a termination).
    if (trigger && triggerEventId && !events.some((e) => e.id === triggerEventId)) {
      events = [
        ...events,
        {
          id: triggerEventId,
          occurredAt: asOf,
          source: "system",
          type:
            trigger.status === "terminated"
              ? "commercial.terminated"
              : "commercial.ended",
          customerId,
          label:
            trigger.status === "terminated"
              ? "Commercial arrangement terminated."
              : "Commercial arrangement ended by expiry.",
          subjectId: trigger.id,
          resultingState: trigger.status,
        },
      ];
      changed = true;
    }

    const activeGrants = grants.filter(
      (g) =>
        g.customerId === customerId &&
        resolveAgentAccessStatus(g, asOf) === "active"
    );

    for (const grant of activeGrants) {
      const eventId = accessRevokedEventId(grant.id);
      if (events.some((e) => e.id === eventId)) continue;
      grants = grants.map((g) =>
        g.id === grant.id
          ? { ...g, revokedAt: asOf, scheduledRevokeAt: null }
          : g
      );
      events = [
        ...events,
        {
          id: eventId,
          occurredAt: asOf,
          source: "system",
          type: "access.revoked",
          customerId,
          label:
            "Access revoked automatically because no commercial arrangement is active.",
          subjectId: grant.id,
          subjectId2: grant.agentProductId,
          resultingState: "revoked",
          causationId: triggerEventId,
        },
      ];
      changed = true;
    }
  }

  return {
    store: {
      ...store,
      commercialArrangements: arrangements,
      agentAccessGrants: grants,
      activityEvents: events,
    },
    changed,
  };
}
