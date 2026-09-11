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
  LedgerTransaction,
  LedgerTransactionKind,
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

// ---------------------------------------------------------------------------
// Usage fingerprint normalization
// ---------------------------------------------------------------------------

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
}): {
  customerId: string;
  agentProductId: string;
  sourceReference: string;
  occurredAt: string;
  tokenQuantity: number;
} | null {
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
 * Project a customer's ledger into chronological statement rows with
 * full-account running balances (LEDG-05). Rows are ordered ascending by
 * `occurredAt` with an array-index tie-breaker so the projection is
 * deterministic; callers that display newest-first reverse the result.
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
  return customerTransactions.map(({ transaction }) => {
    runningBalance += transaction.amountTokens;
    return { transaction, resultingBalanceTokens: runningBalance };
  });
}