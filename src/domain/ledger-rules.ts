/**
 * Pure, side-effect-free rules for the immutable token ledger.
 *
 * These functions are deterministic and operate only on their arguments, so
 * they are trivially unit-testable and safe to call from the repository and
 * the UI alike. The repository uses them for validation on write and for
 * derived-balance resolution at read time. No React imports, no `Date.now()`
 * inside rules: every timestamp is passed in explicitly.
 */

import type {
  DataStore,
  LedgerTransaction,
  LedgerTransactionKind,
  ManualAdjustmentTransaction,
  ReversalTransaction,
  UsageDebitTransaction,
  UsageRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Instant helpers
// ---------------------------------------------------------------------------

function parseInstant(value: string): number {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

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

function isWholeNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value)
  );
}

// ---------------------------------------------------------------------------
// Balance derivation
// ---------------------------------------------------------------------------

/**
 * Derive a customer's current token balance by summing the signed
 * `amountTokens` of every immutable ledger transaction for that customer.
 * An empty ledger derives to zero. This is the single source of truth for
 * prepaid balances (D-02, LEDG-03): no editable or separately persisted
 * balance counter exists.
 */
export function deriveTokenBalance(
  transactions: readonly LedgerTransaction[],
  customerId: string
): number {
  return transactions
    .filter((transaction) => transaction.customerId === customerId)
    .reduce((sum, transaction) => sum + transaction.amountTokens, 0);
}

// ---------------------------------------------------------------------------
// Transaction validation
// ---------------------------------------------------------------------------

/**
 * Loose, unvalidated input shape accepted by {@link validateLedgerTransaction}.
 * Every field is `unknown` so callers can pass untrusted form or storage
 * values; the validator narrows and rejects anything malformed.
 */
export interface LedgerTransactionInput {
  id?: unknown;
  customerId?: unknown;
  occurredAt?: unknown;
  kind?: unknown;
  amountTokens?: unknown;
  reason?: unknown;
  reference?: unknown;
  usageRecordId?: unknown;
  agentProductId?: unknown;
  reversesTransactionId?: unknown;
}

export interface LedgerTransactionValidation {
  ok: boolean;
  problems: string[];
}

const LEDGER_KINDS: LedgerTransactionKind[] = [
  "credit_grant",
  "usage_debit",
  "manual_adjustment",
  "reversal",
];

/**
 * Optional context that tightens per-kind amount invariants:
 *
 * - `usage_debit` must be exactly `-usage.tokenQuantity` when the linked
 *   {@link UsageRecord} is supplied.
 * - `reversal` must be exactly `-target.amountTokens` when the target
 *   transaction is supplied.
 */
export interface LedgerTransactionContext {
  usage?: UsageRecord;
  target?: LedgerTransaction;
}

/**
 * Validate a single ledger transaction, including per-kind amount invariants
 * (D-04, D-05, D-06):
 *
 * - `credit_grant`: positive whole tokens.
 * - `usage_debit`: negative whole tokens; exactly `-usage.tokenQuantity`
 *   when the linked usage record is supplied.
 * - `manual_adjustment`: non-zero signed whole tokens.
 * - `reversal`: non-zero signed whole tokens; exactly `-target.amountTokens`
 *   when the target transaction is supplied.
 *
 * NaN, fractional, and per-kind zero values are rejected. `reason` and
 * `reference` are required and trimmed.
 */
export function validateLedgerTransaction(
  input: LedgerTransactionInput,
  context: LedgerTransactionContext = {}
): LedgerTransactionValidation {
  const problems: string[] = [];

  if (typeof input.id !== "string" || input.id.trim().length === 0) {
    problems.push("id is required.");
  }
  if (
    typeof input.customerId !== "string" ||
    input.customerId.trim().length === 0
  ) {
    problems.push("customerId is required.");
  }
  if (!isIso(input.occurredAt)) {
    problems.push("occurredAt must be a valid ISO-8601 timestamp.");
  }
  if (
    typeof input.kind !== "string" ||
    !LEDGER_KINDS.includes(input.kind as LedgerTransactionKind)
  ) {
    problems.push(
      "kind must be 'credit_grant', 'usage_debit', 'manual_adjustment', or 'reversal'."
    );
  }
  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    problems.push("reason is required.");
  }
  if (
    typeof input.reference !== "string" ||
    input.reference.trim().length === 0
  ) {
    problems.push("reference is required.");
  }

  const kind = input.kind as LedgerTransactionKind;
  const amount = input.amountTokens;

  if (!isWholeNumber(amount)) {
    problems.push("amountTokens must be a whole number of tokens.");
  } else if (kind === "credit_grant") {
    if (amount <= 0) {
      problems.push("credit_grant amountTokens must be positive whole tokens.");
    }
  } else if (kind === "usage_debit") {
    if (amount >= 0) {
      problems.push("usage_debit amountTokens must be negative whole tokens.");
    } else if (
      context.usage !== undefined &&
      amount !== -context.usage.tokenQuantity
    ) {
      problems.push(
        "usage_debit amountTokens must equal the negative of the linked usage tokenQuantity."
      );
    }
  } else if (kind === "manual_adjustment") {
    if (amount === 0) {
      problems.push("manual_adjustment amountTokens must be non-zero.");
    }
  } else if (kind === "reversal") {
    if (amount === 0) {
      problems.push("reversal amountTokens must be non-zero.");
    } else if (
      context.target !== undefined &&
      amount !== -context.target.amountTokens
    ) {
      problems.push(
        "reversal amountTokens must equal the negative of the target transaction amountTokens."
      );
    }
  }

  if (kind === "usage_debit") {
    if (
      typeof input.usageRecordId !== "string" ||
      input.usageRecordId.trim().length === 0
    ) {
      problems.push("usageRecordId is required for usage_debit.");
    }
    if (
      typeof input.agentProductId !== "string" ||
      input.agentProductId.trim().length === 0
    ) {
      problems.push("agentProductId is required for usage_debit.");
    }
  }

  if (kind === "reversal") {
    if (
      typeof input.reversesTransactionId !== "string" ||
      input.reversesTransactionId.trim().length === 0
    ) {
      problems.push("reversesTransactionId is required for reversal.");
    }
  }

  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// No-negative-balance guard
// ---------------------------------------------------------------------------

/**
 * Reject a candidate transaction whose resulting balance would be negative
 * (D-03, D-06). Throws a descriptive error naming the resulting balance;
 * callers must run this before any ledger or usage record is written.
 */
export function assertNoNegativeBalance(
  transactions: readonly LedgerTransaction[],
  customerId: string,
  candidateAmountTokens: number
): void {
  const resultingBalance =
    deriveTokenBalance(transactions, customerId) + candidateAmountTokens;
  if (resultingBalance < 0) {
    throw new Error(
      `Insufficient token balance: the resulting balance would be ${resultingBalance} tokens.`
    );
  }
}

// ---------------------------------------------------------------------------
// Reversal target validation
// ---------------------------------------------------------------------------

/**
 * Validate that a transaction may be reversed (D-05): the target must exist,
 * must not itself be a reversal, and must not already be referenced by an
 * earlier reversal. Throws a descriptive error otherwise.
 */
export function validateReversalTarget(
  transactions: readonly LedgerTransaction[],
  targetId: string
): void {
  const target = transactions.find((transaction) => transaction.id === targetId);
  if (!target) {
    throw new Error(`Ledger transaction with id "${targetId}" does not exist.`);
  }
  if (target.kind === "reversal") {
    throw new Error(
      `Ledger transaction "${targetId}" is a reversal and cannot be reversed.`
    );
  }
  if (
    transactions.some(
      (transaction) =>
        transaction.kind === "reversal" &&
        transaction.reversesTransactionId === targetId
    )
  ) {
    throw new Error(
      `Ledger transaction "${targetId}" has already been reversed.`
    );
  }
}

/**
 * Validate that a transaction may be reversed by a specific customer with a
 * specific amount (D-05): the target must exist, belong to the same customer,
 * not be a reversal itself, not already be referenced by an earlier reversal,
 * and the reversal amount must be the exact negation of the target's amount.
 * Throws a descriptive error otherwise.
 */
export function validateReversal(
  transactions: readonly LedgerTransaction[],
  targetId: string,
  customerId: string,
  amountTokens: number
): void {
  validateReversalTarget(transactions, targetId);
  const target = transactions.find((transaction) => transaction.id === targetId);
  if (!target) {
    throw new Error(`Ledger transaction with id "${targetId}" does not exist.`);
  }
  if (target.customerId !== customerId) {
    throw new Error(
      `Ledger transaction "${targetId}" belongs to a different customer.`
    );
  }
  if (amountTokens !== -target.amountTokens) {
    throw new Error(
      "reversal amountTokens must equal the negative of the target transaction amountTokens."
    );
  }
}

// ---------------------------------------------------------------------------
// Low-balance predicate
// ---------------------------------------------------------------------------

/**
 * A prepaid account is low-balance when its derived balance is less than or
 * equal to its configured warning threshold (D-12, USGE-05).
 */
export function isLowBalance(balance: number, threshold: number): boolean {
  return balance <= threshold;
}

// ---------------------------------------------------------------------------
// Deterministic ID helpers
// ---------------------------------------------------------------------------

/**
 * Stable ledger transaction id for the deterministic opening credit created
 * when a legacy prepaid arrangement with a positive `balanceCents` migrates
 * to the v3 ledger. Derived from the arrangement id so migration replays
 * never duplicate the record.
 */
export function openingCreditTransactionId(arrangementId: string): string {
  return `txn_opening_${arrangementId}`;
}

/**
 * Stable external reference for the deterministic opening credit. Also
 * derived from the arrangement id.
 */
export function openingCreditReference(arrangementId: string): string {
  return `opening_${arrangementId}`;
}

/**
 * Stable ledger transaction id for an operator-confirmed credit grant.
 * Deterministic per (customer, occurredAt) so replays never duplicate.
 */
export function creditGrantTransactionId(
  customerId: string,
  occurredAt: string
): string {
  return `txn_${customerId}_credit_${occurredAt}`;
}

/**
 * Stable ledger transaction id for a reversal of a target transaction.
 * Derived from the target id so a second reversal of the same target would
 * collide and be rejected.
 */
export function reversalTransactionId(targetTransactionId: string): string {
  return `txn_reversal_${targetTransactionId}`;
}

/**
 * Stable usage record id for a usage debit. Derived from the source reference
 * so replaying the same source reference never creates a second record.
 */
export function usageRecordId(sourceReference: string): string {
  return `usage_${sourceReference}`;
}

/**
 * Stable ledger transaction id for a usage debit. Derived from the source
 * reference so replaying the same source reference never debits twice.
 */
export function usageDebitTransactionId(sourceReference: string): string {
  return `txn_usage_${sourceReference}`;
}

/**
 * Stable ledger transaction id for a manual adjustment. Derived from the
 * customer id and occurredAt so repeated operator actions at the same instant
 * cannot silently collide.
 */
export function manualAdjustmentTransactionId(
  customerId: string,
  occurredAt: string
): string {
  return `txn_${customerId}_adjustment_${occurredAt}`;
}

// ---------------------------------------------------------------------------
// Usage fingerprint normalization
// ---------------------------------------------------------------------------

/**
 * The normalized idempotency fingerprint of a usage event (D-09): trimmed
 * `customerId`, `agentProductId`, and `sourceReference`; canonical ISO
 * `occurredAt`; positive integer `tokenQuantity`. `sourceReference` is trimmed
 * but never case-folded.
 */
export interface NormalizedUsageFingerprint {
  customerId: string;
  agentProductId: string;
  sourceReference: string;
  occurredAt: string;
  tokenQuantity: number;
}

/**
 * Normalize the idempotency fingerprint of a usage event (D-09): trim
 * `customerId`, `agentProductId`, and `sourceReference`; canonical ISO
 * `occurredAt`; positive integer `tokenQuantity`. Returns `null` when any
 * field is malformed.
 */
export function normalizeUsageFingerprint(input: {
  customerId: unknown;
  agentProductId: unknown;
  sourceReference: unknown;
  occurredAt: unknown;
  tokenQuantity: unknown;
}): NormalizedUsageFingerprint | null {
  const customerId =
    typeof input.customerId === "string" ? input.customerId.trim() : "";
  const agentProductId =
    typeof input.agentProductId === "string"
      ? input.agentProductId.trim()
      : "";
  const sourceReference =
    typeof input.sourceReference === "string"
      ? input.sourceReference.trim()
      : "";
  if (
    customerId.length === 0 ||
    agentProductId.length === 0 ||
    sourceReference.length === 0 ||
    !isIso(input.occurredAt) ||
    !isWholeNumber(input.tokenQuantity) ||
    (input.tokenQuantity as number) <= 0
  ) {
    return null;
  }
  return {
    customerId,
    agentProductId,
    sourceReference,
    occurredAt: input.occurredAt as string,
    tokenQuantity: input.tokenQuantity as number,
  };
}

/**
 * Decide whether a usage submission is an exact replay of an existing usage
 * record (D-09, USGE-02). Returns `true` when every normalized fingerprint
 * field matches the existing record; throws a descriptive conflict error
 * naming the source reference when any field differs. Returns `false` when no
 * existing record is supplied, so callers know a fresh write is required.
 */
export function validateUsageIdempotency(
  existing: UsageRecord | undefined,
  fingerprint: NormalizedUsageFingerprint
): boolean {
  if (!existing) return false;
  const isExactReplay =
    existing.customerId === fingerprint.customerId &&
    existing.agentProductId === fingerprint.agentProductId &&
    existing.sourceReference === fingerprint.sourceReference &&
    existing.occurredAt === fingerprint.occurredAt &&
    existing.tokenQuantity === fingerprint.tokenQuantity;
  if (isExactReplay) return true;
  throw new Error(
    `Source reference "${fingerprint.sourceReference}" is already assigned to different usage.`
  );
}

// ---------------------------------------------------------------------------
// Statement projection
// ---------------------------------------------------------------------------

/**
 * One chronological statement row: the transaction plus the full-account
 * resulting balance after it was applied. `resultingBalanceTokens` is always
 * the full-account balance at that transaction, never a filtered subtotal.
 */
export interface AccountStatementRow {
  transaction: LedgerTransaction;
  resultingBalanceTokens: number;
}

/**
 * Project a customer's ledger into statement rows with full-account running
 * balances (LEDG-05). Balances are derived in deterministic ascending order
 * (`occurredAt`, then original array index as tie-breaker) so every row's
 * `resultingBalanceTokens` is the full-account balance after that transaction;
 * the returned display list is newest first. Filters applied later never
 * recalculate a row's resulting balance (Pattern 4).
 */
export function projectAccountStatement(
  transactions: readonly LedgerTransaction[],
  customerId: string
): AccountStatementRow[] {
  const customerTransactions = transactions
    .filter((transaction) => transaction.customerId === customerId)
    .map((transaction, index) => ({ transaction, index }))
    .sort(
      (a, b) =>
        parseInstant(a.transaction.occurredAt) -
          parseInstant(b.transaction.occurredAt) || a.index - b.index
    );

  let runningBalance = 0;
  const rows = customerTransactions.map(({ transaction }) => {
    runningBalance += transaction.amountTokens;
    return { transaction, resultingBalanceTokens: runningBalance };
  });
  return rows.reverse();
}

// ---------------------------------------------------------------------------
// Statement filtering and usage aggregation
// ---------------------------------------------------------------------------

/**
 * Inclusive date-range and attribute filters for a statement display list.
 * `from`/`to` are ISO-8601 dates or timestamps; date-only values expand to the
 * full day (start-of-day for `from`, end-of-day for `to`). `agentProductId`
 * matches `usage_debit` rows only; `type` matches the transaction kind.
 */
export interface StatementFilter {
  from?: string;
  to?: string;
  agentProductId?: string;
  type?: LedgerTransactionKind;
}

/**
 * Inclusive date range for usage aggregation. Both boundaries are optional;
 * an absent boundary leaves that side unbounded.
 */
export interface UsagePeriod {
  from?: string;
  to?: string;
}

/**
 * Optional attribute narrowing for usage aggregation, mirroring the statement
 * filters so the selected-period summary tracks the visible statement.
 */
export interface UsageAggregationFilter {
  agentProductId?: string;
  type?: LedgerTransactionKind;
}

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize one inclusive date boundary to an instant. Date-only values
 * ("YYYY-MM-DD") expand to the start of day for `from` and the end of day for
 * `to`; full ISO timestamps are used as-is. Returns `null` for an absent
 * boundary and throws a stable error for an unparseable value.
 */
function normalizeDateBoundary(
  value: string | undefined,
  endOfDay: boolean
): number | null {
  if (value === undefined || value.trim() === "") return null;
  const trimmed = value.trim();
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    throw new Error("Date filter must be a valid ISO-8601 date or timestamp.");
  }
  if (DATE_ONLY_REGEX.test(trimmed)) {
    return endOfDay ? ms + 86_400_000 - 1 : ms;
  }
  return ms;
}

interface NormalizedPeriod {
  fromMs: number | null;
  toMs: number | null;
}

/**
 * Normalize a date range once and reject an inverted range with a stable
 * human-readable error (USGE-03, A1). Callers keep the last valid result by
 * catching this error before applying a new filter.
 */
function normalizePeriod(period: UsagePeriod): NormalizedPeriod {
  const fromMs = normalizeDateBoundary(period.from, false);
  const toMs = normalizeDateBoundary(period.to, true);
  if (fromMs !== null && toMs !== null && fromMs > toMs) {
    throw new Error("From date must be on or before To date.");
  }
  return { fromMs, toMs };
}

/**
 * Filter a statement display list (USGE-03). Date boundaries are inclusive
 * and normalized once; `agentProductId` keeps only `usage_debit` rows for
 * that agent; `type` keeps only rows of that kind. Filters apply to displayed
 * rows only and never recalculate a row's `resultingBalanceTokens`, which
 * always remains the full-account balance at that transaction (LEDG-05,
 * Pattern 4). Throws "From date must be on or before To date." for an
 * inverted range.
 */
export function filterStatement(
  rows: readonly AccountStatementRow[],
  filter: StatementFilter
): AccountStatementRow[] {
  const { fromMs, toMs } = normalizePeriod({
    from: filter.from,
    to: filter.to,
  });
  const agentProductId = filter.agentProductId?.trim() || undefined;
  const type = filter.type;

  return rows.filter((row) => {
    const occurredMs = parseInstant(row.transaction.occurredAt);
    if (fromMs !== null && occurredMs < fromMs) return false;
    if (toMs !== null && occurredMs > toMs) return false;
    if (agentProductId !== undefined) {
      if (row.transaction.kind !== "usage_debit") return false;
      if (row.transaction.agentProductId !== agentProductId) return false;
    }
    if (type !== undefined && row.transaction.kind !== type) return false;
    return true;
  });
}

/**
 * One agent's net usage effect within a period: the signed sum of that
 * agent's in-period usage debits net of their reversals. Negative means
 * tokens were consumed; zero means fully reversed; positive means reversals
 * restored tokens.
 */
export interface AgentUsageTotal {
  agentProductId: string;
  netTokensConsumed: number;
}

/**
 * Compute the per-agent net usage effects for a customer within a period.
 * A `usage_debit` contributes its signed amount to its agent; a `reversal`
 * contributes its signed amount to the agent of the usage debit it reverses,
 * so a fully reversed debit nets to zero (D-05, USGE-04, Pattern 2).
 */
function usageEffectsByAgent(
  transactions: readonly LedgerTransaction[],
  customerId: string,
  period: NormalizedPeriod,
  filter: UsageAggregationFilter
): Map<string, number> {
  const byId = new Map(
    transactions.map((transaction) => [transaction.id, transaction])
  );
  const totals = new Map<string, number>();
  const agentProductId = filter.agentProductId?.trim() || undefined;
  const type = filter.type;

  for (const transaction of transactions) {
    if (transaction.customerId !== customerId) continue;
    const occurredMs = parseInstant(transaction.occurredAt);
    if (period.fromMs !== null && occurredMs < period.fromMs) continue;
    if (period.toMs !== null && occurredMs > period.toMs) continue;

    if (transaction.kind === "usage_debit") {
      if (
        agentProductId !== undefined &&
        transaction.agentProductId !== agentProductId
      ) {
        continue;
      }
      if (type !== undefined && type !== "usage_debit") continue;
      totals.set(
        transaction.agentProductId,
        (totals.get(transaction.agentProductId) ?? 0) + transaction.amountTokens
      );
    } else if (transaction.kind === "reversal") {
      if (type !== undefined && type !== "reversal") continue;
      const target = byId.get(transaction.reversesTransactionId);
      if (
        !target ||
        target.customerId !== customerId ||
        target.kind !== "usage_debit"
      ) {
        continue;
      }
      if (
        agentProductId !== undefined &&
        target.agentProductId !== agentProductId
      ) {
        continue;
      }
      totals.set(
        target.agentProductId,
        (totals.get(target.agentProductId) ?? 0) + transaction.amountTokens
      );
    }
  }
  return totals;
}

/**
 * Net tokens consumed for a customer within a period (USGE-04): the signed
 * sum of in-period usage effects (usage debits net of their reversals).
 * Negative means net consumption, zero means fully reversed, positive means
 * net restoration. Optional `agentProductId`/`type` narrowing mirrors the
 * statement filters so the summary tracks the visible statement.
 */
export function sumPeriodUsage(
  transactions: readonly LedgerTransaction[],
  customerId: string,
  period: UsagePeriod,
  filter: UsageAggregationFilter = {}
): number {
  const normalized = normalizePeriod(period);
  const totals = usageEffectsByAgent(
    transactions,
    customerId,
    normalized,
    filter
  );
  let sum = 0;
  for (const value of totals.values()) sum += value;
  return sum;
}

/**
 * Compact per-agent usage breakdown for a customer within a period (USGE-04):
 * one row per agent with net usage effects, ordered highest consumption first
 * (most negative net first) with ties broken by agent name (falling back to
 * the agent product id when no name is known). A fully reversed debit keeps
 * its agent row at zero net.
 */
export function groupUsageByAgent(
  transactions: readonly LedgerTransaction[],
  customerId: string,
  period: UsagePeriod,
  agentNames?: ReadonlyMap<string, string>,
  filter: UsageAggregationFilter = {}
): AgentUsageTotal[] {
  const normalized = normalizePeriod(period);
  const totals = usageEffectsByAgent(
    transactions,
    customerId,
    normalized,
    filter
  );
  const rows: AgentUsageTotal[] = [...totals.entries()].map(
    ([agentProductId, netTokensConsumed]) => ({
      agentProductId,
      netTokensConsumed,
    })
  );
  rows.sort((a, b) => {
    if (a.netTokensConsumed !== b.netTokensConsumed) {
      return a.netTokensConsumed - b.netTokensConsumed;
    }
    const nameA = agentNames?.get(a.agentProductId) ?? a.agentProductId;
    const nameB = agentNames?.get(b.agentProductId) ?? b.agentProductId;
    return nameA.localeCompare(nameB);
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Pure next-store transitions
// ---------------------------------------------------------------------------

/**
 * Operator-entered usage debit details (D-08). `occurredAt` is supplied
 * separately by the repository command; `reason` is optional because the
 * Record-usage workflow has no reason field.
 */
export interface UsageDebitInput {
  customerId: string;
  agentProductId: string;
  tokenQuantity: number;
  sourceReference: string;
  reason?: string;
}

export interface UsageDebitTransitionResult {
  store: DataStore;
  usage: UsageRecord;
  transaction: UsageDebitTransaction;
}

/**
 * Pure next-store transition for an atomic usage debit (D-08, USGE-01):
 * appends exactly one {@link UsageRecord} and one linked `usage_debit`
 * {@link LedgerTransaction} whose amount is exactly `-tokenQuantity`.
 * The candidate is validated through {@link validateLedgerTransaction} and
 * {@link assertNoNegativeBalance} before a next store is produced, so a
 * rejected debit never yields a partial usage/ledger write. Idempotency
 * lookup is the repository's job; this transition always appends.
 */
export function recordUsage(
  store: DataStore,
  input: UsageDebitInput,
  occurredAt: string
): UsageDebitTransitionResult {
  const fingerprint = normalizeUsageFingerprint({
    customerId: input.customerId,
    agentProductId: input.agentProductId,
    sourceReference: input.sourceReference,
    occurredAt,
    tokenQuantity: input.tokenQuantity,
  });
  if (!fingerprint) {
    throw new Error(
      "Usage requires a customer, agent product, positive whole token quantity, canonical ISO occurredAt, and a source reference."
    );
  }
  const usage: UsageRecord = {
    id: usageRecordId(fingerprint.sourceReference),
    customerId: fingerprint.customerId,
    agentProductId: fingerprint.agentProductId,
    occurredAt: fingerprint.occurredAt,
    tokenQuantity: fingerprint.tokenQuantity,
    sourceReference: fingerprint.sourceReference,
    ledgerTransactionId: usageDebitTransactionId(fingerprint.sourceReference),
  };
  const transaction: UsageDebitTransaction = {
    id: usageDebitTransactionId(fingerprint.sourceReference),
    customerId: fingerprint.customerId,
    occurredAt: fingerprint.occurredAt,
    kind: "usage_debit",
    amountTokens: -fingerprint.tokenQuantity,
    reason: input.reason?.trim() || "Agent usage.",
    reference: fingerprint.sourceReference,
    usageRecordId: usage.id,
    agentProductId: fingerprint.agentProductId,
  };
  const validation = validateLedgerTransaction(transaction, { usage });
  if (!validation.ok) {
    throw new Error(validation.problems.join(" "));
  }
  assertNoNegativeBalance(
    store.ledgerTransactions,
    fingerprint.customerId,
    transaction.amountTokens
  );
  return {
    store: {
      ...store,
      ledgerTransactions: [...store.ledgerTransactions, transaction],
      usageRecords: [...store.usageRecords, usage],
    },
    usage,
    transaction,
  };
}

/**
 * Operator-entered manual adjustment details (D-06, LEDG-04). `amountTokens`
 * is a non-zero signed whole-token amount; `reason` and `reference` are
 * required and trimmed.
 */
export interface ManualAdjustmentInput {
  customerId: string;
  amountTokens: number;
  reference: string;
  reason: string;
}

export interface ManualAdjustmentTransitionResult {
  store: DataStore;
  transaction: ManualAdjustmentTransaction;
}

/**
 * Pure next-store transition for a manual adjustment (D-06, LEDG-04): appends
 * exactly one non-zero signed whole-token `manual_adjustment` with a required
 * reason and reference. The candidate is validated through
 * {@link validateLedgerTransaction} and {@link assertNoNegativeBalance} before
 * a next store is produced.
 */
export function applyManualAdjustment(
  store: DataStore,
  input: ManualAdjustmentInput,
  occurredAt: string
): ManualAdjustmentTransitionResult {
  const customerId = input.customerId.trim();
  const transaction: ManualAdjustmentTransaction = {
    id: manualAdjustmentTransactionId(customerId, occurredAt),
    customerId,
    occurredAt,
    kind: "manual_adjustment",
    amountTokens: input.amountTokens,
    reason: input.reason.trim(),
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
  return {
    store: {
      ...store,
      ledgerTransactions: [...store.ledgerTransactions, transaction],
    },
    transaction,
  };
}

/**
 * Operator-entered reversal details (D-05, LEDG-04). `transactionId` is the
 * immutable target being reversed; `reason` and `reference` are required and
 * trimmed.
 */
export interface ReversalInput {
  customerId: string;
  transactionId: string;
  reference: string;
  reason: string;
}

export interface ReversalTransitionResult {
  store: DataStore;
  transaction: ReversalTransaction;
}

/**
 * Pure next-store transition for a single full reversal (D-05, LEDG-04):
 * appends exactly one `reversal` whose amount is the exact negation of the
 * target transaction's amount, with a required reason and reference. Rejects
 * a missing target, a target from a different customer, a reversal-of-reversal,
 * a second reversal of the same target, and any reversal that would make the
 * derived balance negative — all before a next store is produced.
 */
export function reverseTransaction(
  store: DataStore,
  input: ReversalInput,
  occurredAt: string
): ReversalTransitionResult {
  const customerId = input.customerId.trim();
  const targetId = input.transactionId.trim();
  const target = store.ledgerTransactions.find(
    (transaction) => transaction.id === targetId
  );
  if (!target) {
    throw new Error(`Ledger transaction with id "${targetId}" does not exist.`);
  }
  const transaction: ReversalTransaction = {
    id: reversalTransactionId(targetId),
    customerId,
    occurredAt,
    kind: "reversal",
    amountTokens: -target.amountTokens,
    reason: input.reason.trim(),
    reference: input.reference.trim(),
    reversesTransactionId: targetId,
  };
  validateReversal(
    store.ledgerTransactions,
    targetId,
    customerId,
    transaction.amountTokens
  );
  const validation = validateLedgerTransaction(transaction, { target });
  if (!validation.ok) {
    throw new Error(validation.problems.join(" "));
  }
  assertNoNegativeBalance(
    store.ledgerTransactions,
    customerId,
    transaction.amountTokens
  );
  return {
    store: {
      ...store,
      ledgerTransactions: [...store.ledgerTransactions, transaction],
    },
    transaction,
  };
}