import { describe, expect, it } from "vitest";

import {
  applyManualAdjustment,
  assertNoNegativeBalance,
  creditGrantTransactionId,
  deriveTokenBalance,
  isLowBalance,
  manualAdjustmentTransactionId,
  normalizeUsageFingerprint,
  openingCreditReference,
  openingCreditTransactionId,
  projectAccountStatement,
  recordUsage,
  reversalTransactionId,
  reverseTransaction,
  usageDebitTransactionId,
  usageRecordId,
  validateLedgerTransaction,
  validateReversal,
  validateReversalTarget,
  validateUsageIdempotency,
  type ManualAdjustmentInput,
  type ReversalInput,
  type UsageDebitInput,
  type LedgerTransactionInput,
} from "./ledger-rules";
import type {
  CreditGrantTransaction,
  DataStore,
  LedgerTransaction,
  UsageDebitTransaction,
  UsageRecord,
} from "./types";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-06-01T00:00:00.000Z";
const NOW = "2026-09-09T00:00:00.000Z";
const T2 = "2026-12-01T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function credit(
  overrides: Partial<CreditGrantTransaction> = {}
): CreditGrantTransaction {
  return {
    id: "txn_credit_1",
    customerId: "cust_1",
    occurredAt: T0,
    kind: "credit_grant",
    amountTokens: 1000,
    reason: "Initial credit.",
    reference: "ref_credit_1",
    ...overrides,
  };
}

function usageDebit(
  overrides: Partial<UsageDebitTransaction> = {}
): UsageDebitTransaction {
  return {
    id: "txn_usage_1",
    customerId: "cust_1",
    occurredAt: T1,
    kind: "usage_debit",
    amountTokens: -250,
    reason: "Agent usage.",
    reference: "ref_usage_1",
    usageRecordId: "usage_ref_usage_1",
    agentProductId: "agent_sentinel",
    ...overrides,
  };
}

function usageRecord(
  overrides: Partial<UsageRecord> = {}
): UsageRecord {
  return {
    id: "usage_ref_usage_1",
    customerId: "cust_1",
    agentProductId: "agent_sentinel",
    occurredAt: T1,
    tokenQuantity: 250,
    sourceReference: "ref_usage_1",
    ledgerTransactionId: "txn_usage_1",
    ...overrides,
  };
}

const validCreditInput: LedgerTransactionInput = {
  id: "txn_credit_new",
  customerId: "cust_1",
  occurredAt: NOW,
  kind: "credit_grant",
  amountTokens: 500,
  reason: "Operator top-up.",
  reference: "ref_topup_1",
};

/** Minimal canonical store carrying only the ledger/usage collections. */
function buildStore(
  ledgerTransactions: LedgerTransaction[] = [],
  usageRecords: UsageRecord[] = []
): DataStore {
  return {
    schemaVersion: 3,
    customers: [],
    featureEntitlements: [],
    agentProducts: [],
    commercialArrangements: [],
    agentAccessGrants: [],
    activityEvents: [],
    ledgerTransactions,
    usageRecords,
  };
}

// ---------------------------------------------------------------------------
// deriveTokenBalance
// ---------------------------------------------------------------------------

describe("deriveTokenBalance", () => {
  it("derives zero for an empty ledger", () => {
    expect(deriveTokenBalance([], "cust_1")).toBe(0);
  });

  it("sums signed amounts for the customer's transactions", () => {
    const transactions: LedgerTransaction[] = [
      credit({ amountTokens: 1000 }),
      usageDebit({ amountTokens: -250 }),
      credit({ id: "txn_credit_2", amountTokens: 300 }),
    ];
    expect(deriveTokenBalance(transactions, "cust_1")).toBe(1050);
  });

  it("ignores transactions belonging to other customers", () => {
    const transactions: LedgerTransaction[] = [
      credit({ amountTokens: 1000 }),
      credit({ id: "txn_credit_2", customerId: "cust_2", amountTokens: 999 }),
    ];
    expect(deriveTokenBalance(transactions, "cust_1")).toBe(1000);
  });

  it("derives a negative balance when debits exceed credits", () => {
    const transactions: LedgerTransaction[] = [
      credit({ amountTokens: 100 }),
      usageDebit({ amountTokens: -250 }),
    ];
    expect(deriveTokenBalance(transactions, "cust_1")).toBe(-150);
  });
});

// ---------------------------------------------------------------------------
// validateLedgerTransaction
// ---------------------------------------------------------------------------

describe("validateLedgerTransaction", () => {
  it("accepts a valid credit_grant", () => {
    const result = validateLedgerTransaction(validCreditInput);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("accepts a valid usage_debit matching its linked usage record", () => {
    const result = validateLedgerTransaction(
      {
        id: "txn_usage_new",
        customerId: "cust_1",
        occurredAt: NOW,
        kind: "usage_debit",
        amountTokens: -250,
        reason: "Agent usage.",
        reference: "ref_usage_new",
        usageRecordId: "usage_ref_usage_new",
        agentProductId: "agent_sentinel",
      },
      { usage: usageRecord({ tokenQuantity: 250 }) }
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a usage_debit that does not match its linked usage record", () => {
    const result = validateLedgerTransaction(
      {
        id: "txn_usage_new",
        customerId: "cust_1",
        occurredAt: NOW,
        kind: "usage_debit",
        amountTokens: -100,
        reason: "Agent usage.",
        reference: "ref_usage_new",
        usageRecordId: "usage_ref_usage_new",
        agentProductId: "agent_sentinel",
      },
      { usage: usageRecord({ tokenQuantity: 250 }) }
    );
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      "usage_debit amountTokens must equal the negative of the linked usage tokenQuantity."
    );
  });

  it("accepts a valid manual_adjustment", () => {
    const result = validateLedgerTransaction({
      id: "txn_adjust_1",
      customerId: "cust_1",
      occurredAt: NOW,
      kind: "manual_adjustment",
      amountTokens: -50,
      reason: "Correction.",
      reference: "ref_adjust_1",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a valid reversal matching its target transaction", () => {
    const target = credit({ id: "txn_credit_1", amountTokens: 1000 });
    const result = validateLedgerTransaction(
      {
        id: "txn_reversal_1",
        customerId: "cust_1",
        occurredAt: NOW,
        kind: "reversal",
        amountTokens: -1000,
        reason: "Reversing the initial credit.",
        reference: "ref_reversal_1",
        reversesTransactionId: "txn_credit_1",
      },
      { target }
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a reversal that does not negate its target", () => {
    const target = credit({ id: "txn_credit_1", amountTokens: 1000 });
    const result = validateLedgerTransaction(
      {
        id: "txn_reversal_1",
        customerId: "cust_1",
        occurredAt: NOW,
        kind: "reversal",
        amountTokens: -500,
        reason: "Wrong amount.",
        reference: "ref_reversal_1",
        reversesTransactionId: "txn_credit_1",
      },
      { target }
    );
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      "reversal amountTokens must equal the negative of the target transaction amountTokens."
    );
  });

  it.each([
    {
      name: "rejects an unknown kind",
      mutate: (input: LedgerTransactionInput) => ({
        ...input,
        kind: "refund",
      }),
      expected: [
        "kind must be 'credit_grant', 'usage_debit', 'manual_adjustment', or 'reversal'.",
      ],
    },
    {
      name: "rejects a missing id",
      mutate: (input: LedgerTransactionInput) => ({ ...input, id: "" }),
      expected: ["id is required."],
    },
    {
      name: "rejects a missing customerId",
      mutate: (input: LedgerTransactionInput) => ({
        ...input,
        customerId: "  ",
      }),
      expected: ["customerId is required."],
    },
    {
      name: "rejects a malformed occurredAt",
      mutate: (input: LedgerTransactionInput) => ({
        ...input,
        occurredAt: "not-a-date",
      }),
      expected: ["occurredAt must be a valid ISO-8601 timestamp."],
    },
    {
      name: "rejects a missing reason",
      mutate: (input: LedgerTransactionInput) => ({ ...input, reason: "" }),
      expected: ["reason is required."],
    },
    {
      name: "rejects a missing reference",
      mutate: (input: LedgerTransactionInput) => ({
        ...input,
        reference: "   ",
      }),
      expected: ["reference is required."],
    },
    {
      name: "rejects a NaN amount",
      mutate: (input: LedgerTransactionInput) => ({
        ...input,
        amountTokens: Number.NaN,
      }),
      expected: ["amountTokens must be a whole number of tokens."],
    },
    {
      name: "rejects a fractional amount",
      mutate: (input: LedgerTransactionInput) => ({
        ...input,
        amountTokens: 10.5,
      }),
      expected: ["amountTokens must be a whole number of tokens."],
    },
    {
      name: "rejects a zero credit_grant",
      mutate: (input: LedgerTransactionInput) => ({
        ...input,
        amountTokens: 0,
      }),
      expected: ["credit_grant amountTokens must be positive whole tokens."],
    },
    {
      name: "rejects a negative credit_grant",
      mutate: (input: LedgerTransactionInput) => ({
        ...input,
        amountTokens: -100,
      }),
      expected: ["credit_grant amountTokens must be positive whole tokens."],
    },
  ])("credit_grant: $name", ({ mutate, expected }) => {
    const result = validateLedgerTransaction(mutate(validCreditInput));
    expect(result.ok).toBe(false);
    for (const problem of expected) {
      expect(result.problems).toContain(problem);
    }
  });

  it.each([
    {
      name: "rejects a positive usage_debit",
      mutate: (input: LedgerTransactionInput) => ({
        ...input,
        kind: "usage_debit",
        amountTokens: 250,
        usageRecordId: "usage_1",
        agentProductId: "agent_sentinel",
      }),
      expected: ["usage_debit amountTokens must be negative whole tokens."],
    },
    {
      name: "rejects a zero usage_debit",
      mutate: (input: LedgerTransactionInput) => ({
        ...input,
        kind: "usage_debit",
        amountTokens: 0,
        usageRecordId: "usage_1",
        agentProductId: "agent_sentinel",
      }),
      expected: ["usage_debit amountTokens must be negative whole tokens."],
    },
    {
      name: "rejects a usage_debit without usageRecordId",
      mutate: (input: LedgerTransactionInput) => ({
        ...input,
        kind: "usage_debit",
        amountTokens: -250,
        usageRecordId: "",
        agentProductId: "agent_sentinel",
      }),
      expected: ["usageRecordId is required for usage_debit."],
    },
    {
      name: "rejects a usage_debit without agentProductId",
      mutate: (input: LedgerTransactionInput) => ({
        ...input,
        kind: "usage_debit",
        amountTokens: -250,
        usageRecordId: "usage_1",
        agentProductId: "",
      }),
      expected: ["agentProductId is required for usage_debit."],
    },
  ])("usage_debit: $name", ({ mutate, expected }) => {
    const result = validateLedgerTransaction(mutate(validCreditInput));
    expect(result.ok).toBe(false);
    for (const problem of expected) {
      expect(result.problems).toContain(problem);
    }
  });

  it.each([
    {
      name: "rejects a zero manual_adjustment",
      mutate: (input: LedgerTransactionInput) => ({
        ...input,
        kind: "manual_adjustment",
        amountTokens: 0,
      }),
      expected: ["manual_adjustment amountTokens must be non-zero."],
    },
  ])("manual_adjustment: $name", ({ mutate, expected }) => {
    const result = validateLedgerTransaction(mutate(validCreditInput));
    expect(result.ok).toBe(false);
    for (const problem of expected) {
      expect(result.problems).toContain(problem);
    }
  });

  it.each([
    {
      name: "rejects a zero reversal",
      mutate: (input: LedgerTransactionInput) => ({
        ...input,
        kind: "reversal",
        amountTokens: 0,
        reversesTransactionId: "txn_credit_1",
      }),
      expected: ["reversal amountTokens must be non-zero."],
    },
    {
      name: "rejects a reversal without reversesTransactionId",
      mutate: (input: LedgerTransactionInput) => ({
        ...input,
        kind: "reversal",
        amountTokens: -1000,
        reversesTransactionId: "",
      }),
      expected: ["reversesTransactionId is required for reversal."],
    },
  ])("reversal: $name", ({ mutate, expected }) => {
    const result = validateLedgerTransaction(mutate(validCreditInput));
    expect(result.ok).toBe(false);
    for (const problem of expected) {
      expect(result.problems).toContain(problem);
    }
  });
});

// ---------------------------------------------------------------------------
// assertNoNegativeBalance
// ---------------------------------------------------------------------------

describe("assertNoNegativeBalance", () => {
  it("accepts a candidate that keeps the balance non-negative", () => {
    const transactions: LedgerTransaction[] = [credit({ amountTokens: 1000 })];
    expect(() =>
      assertNoNegativeBalance(transactions, "cust_1", -250)
    ).not.toThrow();
  });

  it("accepts a candidate that lands exactly on zero", () => {
    const transactions: LedgerTransaction[] = [credit({ amountTokens: 250 })];
    expect(() =>
      assertNoNegativeBalance(transactions, "cust_1", -250)
    ).not.toThrow();
  });

  it("rejects a candidate that would make the balance negative", () => {
    const transactions: LedgerTransaction[] = [credit({ amountTokens: 100 })];
    expect(() =>
      assertNoNegativeBalance(transactions, "cust_1", -250)
    ).toThrow(/Insufficient token balance/);
  });

  it("rejects a debit against an empty ledger", () => {
    expect(() => assertNoNegativeBalance([], "cust_1", -1)).toThrow(
      /Insufficient token balance/
    );
  });
});

// ---------------------------------------------------------------------------
// validateReversalTarget
// ---------------------------------------------------------------------------

describe("validateReversalTarget", () => {
  it("accepts an unreversed non-reversal target", () => {
    const transactions: LedgerTransaction[] = [credit()];
    expect(() =>
      validateReversalTarget(transactions, "txn_credit_1")
    ).not.toThrow();
  });

  it("rejects a missing target", () => {
    expect(() => validateReversalTarget([], "txn_missing")).toThrow(
      /does not exist/
    );
  });

  it("rejects a reversal-of-reversal", () => {
    const transactions: LedgerTransaction[] = [
      credit(),
      {
        id: "txn_reversal_1",
        customerId: "cust_1",
        occurredAt: T1,
        kind: "reversal",
        amountTokens: -1000,
        reason: "Reversal.",
        reference: "ref_reversal_1",
        reversesTransactionId: "txn_credit_1",
      },
    ];
    expect(() =>
      validateReversalTarget(transactions, "txn_reversal_1")
    ).toThrow(/is a reversal and cannot be reversed/);
  });

  it("rejects a target that has already been reversed", () => {
    const transactions: LedgerTransaction[] = [
      credit(),
      {
        id: "txn_reversal_1",
        customerId: "cust_1",
        occurredAt: T1,
        kind: "reversal",
        amountTokens: -1000,
        reason: "Reversal.",
        reference: "ref_reversal_1",
        reversesTransactionId: "txn_credit_1",
      },
    ];
    expect(() =>
      validateReversalTarget(transactions, "txn_credit_1")
    ).toThrow(/has already been reversed/);
  });
});

// ---------------------------------------------------------------------------
// validateUsageIdempotency
// ---------------------------------------------------------------------------

describe("validateUsageIdempotency", () => {
  const fingerprint = {
    customerId: "cust_1",
    agentProductId: "agent_sentinel",
    sourceReference: "ref_usage_1",
    occurredAt: T1,
    tokenQuantity: 250,
  };

  it("returns false when no existing usage record is supplied", () => {
    expect(validateUsageIdempotency(undefined, fingerprint)).toBe(false);
  });

  it("returns true for an exact identical replay", () => {
    const existing = usageRecord();
    expect(validateUsageIdempotency(existing, fingerprint)).toBe(true);
  });

  it("rejects a replay whose customer differs", () => {
    const existing = usageRecord({ customerId: "cust_2" });
    expect(() => validateUsageIdempotency(existing, fingerprint)).toThrow(
      /Source reference "ref_usage_1" is already assigned to different usage/
    );
  });

  it("rejects a replay whose agent product differs", () => {
    const existing = usageRecord({ agentProductId: "agent_courier" });
    expect(() => validateUsageIdempotency(existing, fingerprint)).toThrow(
      /Source reference "ref_usage_1" is already assigned to different usage/
    );
  });

  it("rejects a replay whose occurredAt differs", () => {
    const existing = usageRecord({ occurredAt: T2 });
    expect(() => validateUsageIdempotency(existing, fingerprint)).toThrow(
      /Source reference "ref_usage_1" is already assigned to different usage/
    );
  });

  it("rejects a replay whose token quantity differs", () => {
    const existing = usageRecord({ tokenQuantity: 300 });
    expect(() => validateUsageIdempotency(existing, fingerprint)).toThrow(
      /Source reference "ref_usage_1" is already assigned to different usage/
    );
  });

  it("rejects a replay whose source reference differs", () => {
    const existing = usageRecord({ sourceReference: "ref_usage_other" });
    expect(() => validateUsageIdempotency(existing, fingerprint)).toThrow(
      /Source reference "ref_usage_1" is already assigned to different usage/
    );
  });
});

// ---------------------------------------------------------------------------
// validateReversal
// ---------------------------------------------------------------------------

describe("validateReversal", () => {
  it("accepts an unreversed same-customer target with exact negation", () => {
    const transactions: LedgerTransaction[] = [credit({ amountTokens: 1000 })];
    expect(() =>
      validateReversal(transactions, "txn_credit_1", "cust_1", -1000)
    ).not.toThrow();
  });

  it("rejects a missing target", () => {
    expect(() =>
      validateReversal([], "txn_missing", "cust_1", -1000)
    ).toThrow(/does not exist/);
  });

  it("rejects a target belonging to a different customer", () => {
    const transactions: LedgerTransaction[] = [
      credit({ customerId: "cust_2" }),
    ];
    expect(() =>
      validateReversal(transactions, "txn_credit_1", "cust_1", -1000)
    ).toThrow(/belongs to a different customer/);
  });

  it("rejects a reversal-of-reversal", () => {
    const transactions: LedgerTransaction[] = [
      credit(),
      {
        id: "txn_reversal_1",
        customerId: "cust_1",
        occurredAt: T1,
        kind: "reversal",
        amountTokens: -1000,
        reason: "Reversal.",
        reference: "ref_reversal_1",
        reversesTransactionId: "txn_credit_1",
      },
    ];
    expect(() =>
      validateReversal(transactions, "txn_reversal_1", "cust_1", 1000)
    ).toThrow(/is a reversal and cannot be reversed/);
  });

  it("rejects a target that has already been reversed", () => {
    const transactions: LedgerTransaction[] = [
      credit(),
      {
        id: "txn_reversal_1",
        customerId: "cust_1",
        occurredAt: T1,
        kind: "reversal",
        amountTokens: -1000,
        reason: "Reversal.",
        reference: "ref_reversal_1",
        reversesTransactionId: "txn_credit_1",
      },
    ];
    expect(() =>
      validateReversal(transactions, "txn_credit_1", "cust_1", 1000)
    ).toThrow(/has already been reversed/);
  });

  it("rejects an amount that is not the exact negation of the target", () => {
    const transactions: LedgerTransaction[] = [credit({ amountTokens: 1000 })];
    expect(() =>
      validateReversal(transactions, "txn_credit_1", "cust_1", -500)
    ).toThrow(/must equal the negative of the target transaction amountTokens/);
  });
});

// ---------------------------------------------------------------------------
// recordUsage (pure next-store transition)
// ---------------------------------------------------------------------------

describe("recordUsage", () => {
  const usageInput: UsageDebitInput = {
    customerId: "cust_1",
    agentProductId: "agent_sentinel",
    tokenQuantity: 250,
    sourceReference: "ref_usage_new",
  };

  it("appends one usage record and one linked usage_debit in one store", () => {
    const store = buildStore([credit({ amountTokens: 1000 })]);
    const result = recordUsage(store, usageInput, T1);
    expect(result.usage).toEqual({
      id: "usage_ref_usage_new",
      customerId: "cust_1",
      agentProductId: "agent_sentinel",
      occurredAt: T1,
      tokenQuantity: 250,
      sourceReference: "ref_usage_new",
      ledgerTransactionId: "txn_usage_ref_usage_new",
    });
    expect(result.transaction).toEqual({
      id: "txn_usage_ref_usage_new",
      customerId: "cust_1",
      occurredAt: T1,
      kind: "usage_debit",
      amountTokens: -250,
      reason: "Agent usage.",
      reference: "ref_usage_new",
      usageRecordId: "usage_ref_usage_new",
      agentProductId: "agent_sentinel",
    });
    expect(result.store.ledgerTransactions).toHaveLength(2);
    expect(result.store.usageRecords).toHaveLength(1);
    expect(deriveTokenBalance(result.store.ledgerTransactions, "cust_1")).toBe(
      750
    );
  });

  it("trims fingerprint fields and keeps the source reference case", () => {
    const store = buildStore([credit({ amountTokens: 1000 })]);
    const result = recordUsage(
      store,
      {
        customerId: "  cust_1  ",
        agentProductId: " agent_sentinel ",
        tokenQuantity: 250,
        sourceReference: "  Ref_Usage_New  ",
      },
      T1
    );
    expect(result.usage.customerId).toBe("cust_1");
    expect(result.usage.agentProductId).toBe("agent_sentinel");
    expect(result.usage.sourceReference).toBe("Ref_Usage_New");
  });

  it("rejects a debit that would make the balance negative without a next store", () => {
    const store = buildStore([credit({ amountTokens: 100 })]);
    expect(() =>
      recordUsage(store, { ...usageInput, tokenQuantity: 250 }, T1)
    ).toThrow(/Insufficient token balance/);
    expect(store.ledgerTransactions).toHaveLength(1);
    expect(store.usageRecords).toHaveLength(0);
  });

  it("rejects malformed usage input", () => {
    const store = buildStore([credit({ amountTokens: 1000 })]);
    expect(() =>
      recordUsage(store, { ...usageInput, tokenQuantity: 0 }, T1)
    ).toThrow(/positive whole token quantity/);
    expect(() =>
      recordUsage(store, { ...usageInput, sourceReference: "  " }, T1)
    ).toThrow(/source reference/);
  });
});

// ---------------------------------------------------------------------------
// applyManualAdjustment (pure next-store transition)
// ---------------------------------------------------------------------------

describe("applyManualAdjustment", () => {
  const adjustmentInput: ManualAdjustmentInput = {
    customerId: "cust_1",
    amountTokens: -50,
    reference: "ref_adjust_1",
    reason: "Correction.",
  };

  it("appends exactly one manual_adjustment transaction", () => {
    const store = buildStore([credit({ amountTokens: 1000 })]);
    const result = applyManualAdjustment(store, adjustmentInput, NOW);
    expect(result.transaction).toEqual({
      id: "txn_cust_1_adjustment_2026-09-09T00:00:00.000Z",
      customerId: "cust_1",
      occurredAt: NOW,
      kind: "manual_adjustment",
      amountTokens: -50,
      reason: "Correction.",
      reference: "ref_adjust_1",
    });
    expect(result.store.ledgerTransactions).toHaveLength(2);
    expect(deriveTokenBalance(result.store.ledgerTransactions, "cust_1")).toBe(
      950
    );
  });

  it("accepts a positive adjustment", () => {
    const store = buildStore([credit({ amountTokens: 1000 })]);
    const result = applyManualAdjustment(
      store,
      { ...adjustmentInput, amountTokens: 100 },
      NOW
    );
    expect(result.transaction.amountTokens).toBe(100);
    expect(deriveTokenBalance(result.store.ledgerTransactions, "cust_1")).toBe(
      1100
    );
  });

  it("rejects a zero amount", () => {
    const store = buildStore([credit({ amountTokens: 1000 })]);
    expect(() =>
      applyManualAdjustment(store, { ...adjustmentInput, amountTokens: 0 }, NOW)
    ).toThrow(/manual_adjustment amountTokens must be non-zero/);
    expect(store.ledgerTransactions).toHaveLength(1);
  });

  it("rejects an adjustment that would make the balance negative", () => {
    const store = buildStore([credit({ amountTokens: 100 })]);
    expect(() =>
      applyManualAdjustment(store, { ...adjustmentInput, amountTokens: -250 }, NOW)
    ).toThrow(/Insufficient token balance/);
    expect(store.ledgerTransactions).toHaveLength(1);
  });

  it("rejects a missing reason or reference", () => {
    const store = buildStore([credit({ amountTokens: 1000 })]);
    expect(() =>
      applyManualAdjustment(store, { ...adjustmentInput, reason: "  " }, NOW)
    ).toThrow(/reason is required/);
    expect(() =>
      applyManualAdjustment(store, { ...adjustmentInput, reference: "" }, NOW)
    ).toThrow(/reference is required/);
  });
});

// ---------------------------------------------------------------------------
// reverseTransaction (pure next-store transition)
// ---------------------------------------------------------------------------

describe("reverseTransaction", () => {
  const reversalInput: ReversalInput = {
    customerId: "cust_1",
    transactionId: "txn_credit_1",
    reference: "ref_reversal_1",
    reason: "Reversing the initial credit.",
  };

  it("appends exactly one reversal negating the full target amount", () => {
    const store = buildStore([credit({ amountTokens: 1000 })]);
    const result = reverseTransaction(store, reversalInput, NOW);
    expect(result.transaction).toEqual({
      id: "txn_reversal_txn_credit_1",
      customerId: "cust_1",
      occurredAt: NOW,
      kind: "reversal",
      amountTokens: -1000,
      reason: "Reversing the initial credit.",
      reference: "ref_reversal_1",
      reversesTransactionId: "txn_credit_1",
    });
    expect(result.store.ledgerTransactions).toHaveLength(2);
    expect(deriveTokenBalance(result.store.ledgerTransactions, "cust_1")).toBe(
      0
    );
  });

  it("rejects a missing target", () => {
    const store = buildStore([credit()]);
    expect(() =>
      reverseTransaction(store, { ...reversalInput, transactionId: "txn_missing" }, NOW)
    ).toThrow(/does not exist/);
    expect(store.ledgerTransactions).toHaveLength(1);
  });

  it("rejects a second reversal of the same target", () => {
    const store = buildStore([credit({ amountTokens: 1000 })]);
    const first = reverseTransaction(store, reversalInput, NOW);
    expect(() =>
      reverseTransaction(first.store, reversalInput, T2)
    ).toThrow(/has already been reversed/);
  });

  it("rejects a reversal-of-reversal", () => {
    const store = buildStore([credit({ amountTokens: 1000 })]);
    const first = reverseTransaction(store, reversalInput, NOW);
    expect(() =>
      reverseTransaction(
        first.store,
        { ...reversalInput, transactionId: first.transaction.id },
        T2
      )
    ).toThrow(/is a reversal and cannot be reversed/);
  });

  it("rejects a reversal that would make the balance negative", () => {
    const store = buildStore([
      credit({ amountTokens: 1000 }),
      usageDebit({ amountTokens: -900 }),
    ]);
    expect(() =>
      reverseTransaction(store, reversalInput, NOW)
    ).toThrow(/Insufficient token balance/);
    expect(store.ledgerTransactions).toHaveLength(2);
  });

  it("rejects a target belonging to a different customer", () => {
    const store = buildStore([credit({ customerId: "cust_2" })]);
    expect(() => reverseTransaction(store, reversalInput, NOW)).toThrow(
      /belongs to a different customer/
    );
  });
});

// ---------------------------------------------------------------------------
// isLowBalance
// ---------------------------------------------------------------------------

describe("isLowBalance", () => {
  it("is low when balance is below the threshold", () => {
    expect(isLowBalance(80, 100)).toBe(true);
  });

  it("is low when balance equals the threshold", () => {
    expect(isLowBalance(100, 100)).toBe(true);
  });

  it("is not low when balance is above the threshold", () => {
    expect(isLowBalance(101, 100)).toBe(false);
  });

  it("is low for a zero balance with a zero threshold", () => {
    expect(isLowBalance(0, 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Deterministic ID helpers
// ---------------------------------------------------------------------------

describe("deterministic ID helpers", () => {
  it("derives the opening credit id and reference from the arrangement id", () => {
    expect(openingCreditTransactionId("arr_meridians_prepaid")).toBe(
      "txn_opening_arr_meridians_prepaid"
    );
    expect(openingCreditReference("arr_meridians_prepaid")).toBe(
      "opening_arr_meridians_prepaid"
    );
  });

  it("derives the credit grant id from customer and occurredAt", () => {
    expect(creditGrantTransactionId("cust_1", NOW)).toBe(
      "txn_cust_1_credit_2026-09-09T00:00:00.000Z"
    );
  });

  it("derives the reversal id from the target id", () => {
    expect(reversalTransactionId("txn_credit_1")).toBe(
      "txn_reversal_txn_credit_1"
    );
  });

  it("derives usage ids from the source reference", () => {
    expect(usageRecordId("ref_usage_1")).toBe("usage_ref_usage_1");
    expect(usageDebitTransactionId("ref_usage_1")).toBe(
      "txn_usage_ref_usage_1"
    );
  });

  it("derives the manual adjustment id from customer and occurredAt", () => {
    expect(manualAdjustmentTransactionId("cust_1", NOW)).toBe(
      "txn_cust_1_adjustment_2026-09-09T00:00:00.000Z"
    );
  });
});

// ---------------------------------------------------------------------------
// normalizeUsageFingerprint
// ---------------------------------------------------------------------------

describe("normalizeUsageFingerprint", () => {
  it("normalizes a valid fingerprint", () => {
    expect(
      normalizeUsageFingerprint({
        customerId: "  cust_1  ",
        agentProductId: " agent_sentinel ",
        sourceReference: " ref_usage_1 ",
        occurredAt: NOW,
        tokenQuantity: 250,
      })
    ).toEqual({
      customerId: "cust_1",
      agentProductId: "agent_sentinel",
      sourceReference: "ref_usage_1",
      occurredAt: NOW,
      tokenQuantity: 250,
    });
  });

  it.each([
    {
      name: "rejects an empty customerId",
      input: {
        customerId: "  ",
        agentProductId: "agent_sentinel",
        sourceReference: "ref_usage_1",
        occurredAt: NOW,
        tokenQuantity: 250,
      },
    },
    {
      name: "rejects an empty agentProductId",
      input: {
        customerId: "cust_1",
        agentProductId: "",
        sourceReference: "ref_usage_1",
        occurredAt: NOW,
        tokenQuantity: 250,
      },
    },
    {
      name: "rejects an empty sourceReference",
      input: {
        customerId: "cust_1",
        agentProductId: "agent_sentinel",
        sourceReference: " ",
        occurredAt: NOW,
        tokenQuantity: 250,
      },
    },
    {
      name: "rejects a malformed occurredAt",
      input: {
        customerId: "cust_1",
        agentProductId: "agent_sentinel",
        sourceReference: "ref_usage_1",
        occurredAt: "soon",
        tokenQuantity: 250,
      },
    },
    {
      name: "rejects a fractional tokenQuantity",
      input: {
        customerId: "cust_1",
        agentProductId: "agent_sentinel",
        sourceReference: "ref_usage_1",
        occurredAt: NOW,
        tokenQuantity: 10.5,
      },
    },
    {
      name: "rejects a non-positive tokenQuantity",
      input: {
        customerId: "cust_1",
        agentProductId: "agent_sentinel",
        sourceReference: "ref_usage_1",
        occurredAt: NOW,
        tokenQuantity: 0,
      },
    },
  ])("$name", ({ input }) => {
    expect(normalizeUsageFingerprint(input)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// projectAccountStatement
// ---------------------------------------------------------------------------

describe("projectAccountStatement", () => {
  it("returns an empty statement for an empty ledger", () => {
    expect(projectAccountStatement([], "cust_1")).toEqual([]);
  });

  it("derives full-account running balances in chronological order", () => {
    const transactions: LedgerTransaction[] = [
      credit({ id: "txn_credit_1", occurredAt: T0, amountTokens: 1000 }),
      usageDebit({ id: "txn_usage_1", occurredAt: T1, amountTokens: -250 }),
      credit({ id: "txn_credit_2", occurredAt: T2, amountTokens: 300 }),
    ];
    const rows = projectAccountStatement(transactions, "cust_1");
    expect(rows.map((row) => row.transaction.id)).toEqual([
      "txn_credit_1",
      "txn_usage_1",
      "txn_credit_2",
    ]);
    expect(rows.map((row) => row.resultingBalanceTokens)).toEqual([
      1000, 750, 1050,
    ]);
  });

  it("breaks ties by array index for determinism", () => {
    const transactions: LedgerTransaction[] = [
      credit({ id: "txn_a", occurredAt: NOW, amountTokens: 100 }),
      credit({ id: "txn_b", occurredAt: NOW, amountTokens: 200 }),
    ];
    const rows = projectAccountStatement(transactions, "cust_1");
    expect(rows.map((row) => row.transaction.id)).toEqual(["txn_a", "txn_b"]);
    expect(rows.map((row) => row.resultingBalanceTokens)).toEqual([100, 300]);
  });

  it("ignores other customers' transactions", () => {
    const transactions: LedgerTransaction[] = [
      credit({ id: "txn_credit_1", amountTokens: 1000 }),
      credit({
        id: "txn_credit_2",
        customerId: "cust_2",
        amountTokens: 999,
      }),
    ];
    const rows = projectAccountStatement(transactions, "cust_1");
    expect(rows).toHaveLength(1);
    expect(rows[0].resultingBalanceTokens).toBe(1000);
  });
});