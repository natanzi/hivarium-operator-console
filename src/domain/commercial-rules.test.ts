import { describe, expect, it } from "vitest";

import {
  accessRevokeScheduledEventId,
  accessRevokedEventId,
  applyAccessRevocation,
  applyCommercialTransition,
  commercialCreatedEventId,
  commercialEndedEventId,
  commercialTerminatedEventId,
  projectCommercialState,
  reconcileCommercialLifecycle,
  resolveAgentAccessStatus,
  resolveArrangementAsOf,
  validateCommercialArrangement,
  type AccessRevocationInput,
  type CommercialArrangementInput,
} from "./commercial-rules";
import type {
  AgentAccessGrant,
  AnnualCommercialArrangement,
  DataStore,
  MonthlyCommercialArrangement,
} from "./types";

/**
 * Deterministic reference instants used across the pure-rule tables.
 * `NOW` mirrors the seed reference instant; the others bracket it.
 */
const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-06-01T00:00:00.000Z";
const NOW = "2026-09-09T00:00:00.000Z";
const T2 = "2026-12-01T00:00:00.000Z";
const T3 = "2027-01-01T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeStore(overrides: Partial<DataStore> = {}): DataStore {
  return {
    schemaVersion: 2,
    customers: [],
    featureEntitlements: [],
    agentProducts: [],
    commercialArrangements: [],
    agentAccessGrants: [],
    activityEvents: [],
    ...overrides,
  };
}

function monthlyArrangement(
  overrides: Partial<MonthlyCommercialArrangement> = {}
): MonthlyCommercialArrangement {
  return {
    id: "arr_m",
    customerId: "cust_1",
    status: "active",
    model: "monthly",
    currency: "USD",
    billingCadence: "monthly",
    monthlyAmountCents: 14900,
    effectiveFrom: T0,
    effectiveTo: null,
    replacedByArrangementId: null,
    renewsAt: T2,
    createdAt: T0,
    reason: "Monthly arrangement.",
    ...overrides,
  };
}

function annualArrangement(
  overrides: Partial<AnnualCommercialArrangement> = {}
): AnnualCommercialArrangement {
  return {
    id: "arr_a",
    customerId: "cust_1",
    status: "active",
    model: "annual",
    currency: "USD",
    contractValueCents: 1200000,
    effectiveFrom: T0,
    effectiveTo: null,
    replacedByArrangementId: null,
    startsAt: T0,
    endsAt: T2,
    renewalStatus: "unknown",
    includedAllowance: 1000,
    allowanceUnit: "tokens",
    overageRateCentsPerUnit: 2,
    createdAt: T0,
    reason: "Annual arrangement.",
    ...overrides,
  };
}

function grant(overrides: Partial<AgentAccessGrant> = {}): AgentAccessGrant {
  return {
    id: "grant_1",
    customerId: "cust_1",
    agentProductId: "agent_sentinel",
    startsAt: T0,
    endsAt: null,
    createdAt: T0,
    revokedAt: null,
    scheduledRevokeAt: null,
    activityEventId: "evt_grant_1",
    reasonForChange: "Initial grant.",
    ...overrides,
  };
}

const validMonthlyInput: CommercialArrangementInput = {
  model: "monthly",
  id: "arr_new",
  customerId: "cust_1",
  status: "active",
  effectiveFrom: NOW,
  effectiveTo: null,
  createdAt: NOW,
  reason: "New monthly arrangement.",
  currency: "USD",
  billingCadence: "monthly",
  monthlyAmountCents: 19900,
  renewsAt: T3,
};

const validPrepaidInput: CommercialArrangementInput = {
  model: "prepaid",
  id: "arr_prepaid",
  customerId: "cust_1",
  status: "active",
  effectiveFrom: NOW,
  effectiveTo: null,
  createdAt: NOW,
  reason: "Prepaid top-up.",
  currency: "USD",
  balanceCents: 50000,
  expiresAt: null,
};

const validAnnualInput: CommercialArrangementInput = {
  model: "annual",
  id: "arr_annual",
  customerId: "cust_1",
  status: "active",
  effectiveFrom: NOW,
  effectiveTo: null,
  createdAt: NOW,
  reason: "Annual contract.",
  currency: "USD",
  contractValueCents: 2400000,
  startsAt: NOW,
  endsAt: T3,
  renewalStatus: "renewing",
  includedAllowance: 5000,
  allowanceUnit: "tokens",
  overageRateCentsPerUnit: 3,
};

// ---------------------------------------------------------------------------
// validateCommercialArrangement
// ---------------------------------------------------------------------------

describe("validateCommercialArrangement", () => {
  it("accepts a valid monthly arrangement", () => {
    const result = validateCommercialArrangement(validMonthlyInput);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("accepts a valid prepaid arrangement", () => {
    const result = validateCommercialArrangement(validPrepaidInput);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("accepts a valid annual arrangement", () => {
    const result = validateCommercialArrangement(validAnnualInput);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("accepts an annual arrangement without renewalStatus or notes", () => {
    const result = validateCommercialArrangement({
      ...validAnnualInput,
      renewalStatus: undefined,
      notes: undefined,
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    {
      name: "rejects an unknown model",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        model: "quarterly",
      }),
      expected: ["model must be 'monthly', 'prepaid', or 'annual'."],
    },
    {
      name: "rejects a missing model",
      mutate: (input: CommercialArrangementInput) => {
        const rest = { ...input };
        delete rest.model;
        return rest;
      },
      expected: ["model must be 'monthly', 'prepaid', or 'annual'."],
    },
    {
      name: "rejects a missing id",
      mutate: (input: CommercialArrangementInput) => ({ ...input, id: "" }),
      expected: ["id is required."],
    },
    {
      name: "rejects a missing customerId",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        customerId: "  ",
      }),
      expected: ["customerId is required."],
    },
    {
      name: "rejects a malformed effectiveFrom",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        effectiveFrom: "not-a-date",
      }),
      expected: ["effectiveFrom must be a valid ISO-8601 timestamp."],
    },
    {
      name: "rejects a malformed effectiveTo",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        effectiveTo: "not-a-date",
      }),
      expected: ["effectiveTo must be a valid ISO-8601 timestamp or null."],
    },
    {
      name: "rejects an effectiveTo earlier than effectiveFrom",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        effectiveTo: "2025-01-01T00:00:00.000Z",
      }),
      expected: ["effectiveTo must not be earlier than effectiveFrom."],
    },
    {
      name: "rejects a malformed createdAt",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        createdAt: "yesterday",
      }),
      expected: ["createdAt must be a valid ISO-8601 timestamp."],
    },
    {
      name: "rejects an unknown status",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        status: "paused",
      }),
      expected: ["status must be active, scheduled, ended, or terminated."],
    },
    {
      name: "rejects an empty replacedByArrangementId",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        replacedByArrangementId: "   ",
      }),
      expected: ["replacedByArrangementId must be a non-empty string or null."],
    },
    {
      name: "rejects a missing reason",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        reason: "",
      }),
      expected: ["reason is required."],
    },
  ])("core: $name", ({ mutate, expected }) => {
    const result = validateCommercialArrangement(mutate(validMonthlyInput));
    expect(result.ok).toBe(false);
    for (const problem of expected) {
      expect(result.problems).toContain(problem);
    }
  });

  it.each([
    {
      name: "rejects a non-USD currency",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        currency: "EUR",
      }),
      expected: ["currency must be 'USD'."],
    },
    {
      name: "rejects a non-monthly billingCadence",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        billingCadence: "annual",
      }),
      expected: ["billingCadence must be 'monthly'."],
    },
    {
      name: "rejects a negative monthlyAmountCents",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        monthlyAmountCents: -1,
      }),
      expected: [
        "monthlyAmountCents must be a non-negative integer number of cents.",
      ],
    },
    {
      name: "rejects a fractional monthlyAmountCents",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        monthlyAmountCents: 10.5,
      }),
      expected: [
        "monthlyAmountCents must be a non-negative integer number of cents.",
      ],
    },
    {
      name: "rejects a malformed renewsAt",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        renewsAt: "soon",
      }),
      expected: ["renewsAt must be a valid ISO-8601 timestamp."],
    },
  ])("monthly: $name", ({ mutate, expected }) => {
    const result = validateCommercialArrangement(mutate(validMonthlyInput));
    expect(result.ok).toBe(false);
    for (const problem of expected) {
      expect(result.problems).toContain(problem);
    }
  });

  it.each([
    {
      name: "rejects a non-USD currency",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        currency: "GBP",
      }),
      expected: ["currency must be 'USD'."],
    },
    {
      name: "rejects a negative balanceCents",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        balanceCents: -100,
      }),
      expected: [
        "balanceCents must be a non-negative integer number of cents.",
      ],
    },
    {
      name: "rejects a malformed expiresAt",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        expiresAt: "never",
      }),
      expected: ["expiresAt must be a valid ISO-8601 timestamp or null."],
    },
    {
      name: "rejects a non-string notes value",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        notes: 42,
      }),
      expected: ["notes must be a string when provided."],
    },
  ])("prepaid: $name", ({ mutate, expected }) => {
    const result = validateCommercialArrangement(mutate(validPrepaidInput));
    expect(result.ok).toBe(false);
    for (const problem of expected) {
      expect(result.problems).toContain(problem);
    }
  });

  it.each([
    {
      name: "rejects a non-USD currency",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        currency: "EUR",
      }),
      expected: ["currency must be 'USD'."],
    },
    {
      name: "rejects a negative contractValueCents",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        contractValueCents: -1,
      }),
      expected: [
        "contractValueCents must be a non-negative integer number of cents.",
      ],
    },
    {
      name: "rejects a malformed startsAt",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        startsAt: "not-a-date",
      }),
      expected: ["startsAt must be a valid ISO-8601 timestamp."],
    },
    {
      name: "rejects a malformed endsAt",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        endsAt: "not-a-date",
      }),
      expected: ["endsAt must be a valid ISO-8601 timestamp."],
    },
    {
      name: "rejects an endsAt earlier than startsAt",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        endsAt: "2025-01-01T00:00:00.000Z",
      }),
      expected: ["endsAt must not be earlier than startsAt."],
    },
    {
      name: "rejects a negative includedAllowance",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        includedAllowance: -5,
      }),
      expected: ["includedAllowance must be a non-negative integer."],
    },
    {
      name: "rejects an unknown allowanceUnit",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        allowanceUnit: "gigabytes",
      }),
      expected: [
        "allowanceUnit must be 'tokens', 'seats', 'requests', 'usd', or 'other'.",
      ],
    },
    {
      name: "rejects a negative overageRateCentsPerUnit",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        overageRateCentsPerUnit: -2,
      }),
      expected: [
        "overageRateCentsPerUnit must be a non-negative integer number of cents.",
      ],
    },
    {
      name: "rejects an unknown renewalStatus",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        renewalStatus: "rolling",
      }),
      expected: [
        "renewalStatus must be 'renewing', 'review', 'non-renewing', or 'unknown'.",
      ],
    },
    {
      name: "rejects a non-string notes value",
      mutate: (input: CommercialArrangementInput) => ({
        ...input,
        notes: true,
      }),
      expected: ["notes must be a string when provided."],
    },
  ])("annual: $name", ({ mutate, expected }) => {
    const result = validateCommercialArrangement(mutate(validAnnualInput));
    expect(result.ok).toBe(false);
    for (const problem of expected) {
      expect(result.problems).toContain(problem);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveArrangementAsOf
// ---------------------------------------------------------------------------

describe("resolveArrangementAsOf", () => {
  it.each([
    {
      name: "active when effectiveFrom has passed and no expiry",
      arrangement: monthlyArrangement(),
      at: NOW,
      expected: "active",
    },
    {
      name: "scheduled before effectiveFrom",
      arrangement: monthlyArrangement({ effectiveFrom: T2 }),
      at: NOW,
      expected: "scheduled",
    },
    {
      name: "ended past effectiveTo",
      arrangement: monthlyArrangement({ effectiveTo: T1 }),
      at: NOW,
      expected: "ended",
    },
    {
      name: "active exactly at effectiveTo",
      arrangement: monthlyArrangement({ effectiveTo: NOW }),
      at: NOW,
      expected: "active",
    },
    {
      name: "ended for an annual contract past endsAt",
      arrangement: annualArrangement({ endsAt: T1 }),
      at: NOW,
      expected: "ended",
    },
    {
      name: "terminated always wins",
      arrangement: monthlyArrangement({ status: "terminated", effectiveTo: T1 }),
      at: NOW,
      expected: "terminated",
    },
    {
      name: "ended status always wins",
      arrangement: monthlyArrangement({ status: "ended", effectiveTo: T1 }),
      at: NOW,
      expected: "ended",
    },
  ])("$name", ({ arrangement, at, expected }) => {
    expect(resolveArrangementAsOf(arrangement, at)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// projectCommercialState
// ---------------------------------------------------------------------------

describe("projectCommercialState", () => {
  it("returns an empty projection for no records", () => {
    const projection = projectCommercialState([], NOW);
    expect(projection.active).toBeNull();
    expect(projection.scheduled).toBeNull();
    expect(projection.history).toEqual([]);
  });

  it("projects a single active arrangement", () => {
    const arrangement = monthlyArrangement();
    const projection = projectCommercialState([arrangement], NOW);
    expect(projection.active?.id).toBe(arrangement.id);
    expect(projection.scheduled).toBeNull();
  });

  it("projects a scheduled arrangement before its effectiveFrom", () => {
    const arrangement = monthlyArrangement({
      status: "scheduled",
      effectiveFrom: T2,
    });
    const projection = projectCommercialState([arrangement], NOW);
    expect(projection.active).toBeNull();
    expect(projection.scheduled?.id).toBe(arrangement.id);
  });

  it("picks the earliest scheduled successor", () => {
    const later = monthlyArrangement({
      id: "arr_later",
      status: "scheduled",
      effectiveFrom: T3,
    });
    const earlier = monthlyArrangement({
      id: "arr_earlier",
      status: "scheduled",
      effectiveFrom: T2,
    });
    const projection = projectCommercialState([later, earlier], NOW);
    expect(projection.scheduled?.id).toBe("arr_earlier");
  });

  it("ignores ended and terminated records for active/scheduled", () => {
    const ended = monthlyArrangement({ id: "arr_ended", status: "ended" });
    const terminated = monthlyArrangement({
      id: "arr_term",
      status: "terminated",
    });
    const projection = projectCommercialState([ended, terminated], NOW);
    expect(projection.active).toBeNull();
    expect(projection.scheduled).toBeNull();
    expect(projection.history).toHaveLength(2);
  });

  it("orders history newest first by effectiveFrom", () => {
    const old = monthlyArrangement({ id: "arr_old", effectiveFrom: T0 });
    const mid = monthlyArrangement({ id: "arr_mid", effectiveFrom: T1 });
    const recent = monthlyArrangement({ id: "arr_recent", effectiveFrom: NOW });
    const projection = projectCommercialState([old, recent, mid], NOW);
    expect(projection.history.map((a) => a.id)).toEqual([
      "arr_recent",
      "arr_mid",
      "arr_old",
    ]);
  });

  it("treats an annual arrangement past its endsAt as ended", () => {
    const arrangement = annualArrangement({ endsAt: T1 });
    const projection = projectCommercialState([arrangement], NOW);
    expect(projection.active).toBeNull();
    expect(projection.history.map((a) => a.id)).toEqual([arrangement.id]);
  });
});

// ---------------------------------------------------------------------------
// applyCommercialTransition
// ---------------------------------------------------------------------------

describe("applyCommercialTransition", () => {
  it("creates a first immediate arrangement as active with a created event", () => {
    const store = makeStore();
    const result = applyCommercialTransition(store, validMonthlyInput, NOW);
    expect(result.arrangement.status).toBe("active");
    expect(result.store.commercialArrangements).toHaveLength(1);
    expect(result.store.activityEvents).toHaveLength(1);
    expect(result.event.id).toBe(commercialCreatedEventId("arr_new"));
    expect(result.event.type).toBe("commercial.created");
    expect(result.event.resultingState).toBe("active");
  });

  it("creates a first scheduled arrangement as scheduled", () => {
    const store = makeStore();
    const input = { ...validMonthlyInput, effectiveFrom: T2 };
    const result = applyCommercialTransition(store, input, NOW);
    expect(result.arrangement.status).toBe("scheduled");
    expect(result.event.resultingState).toBe("scheduled");
  });

  it("immediately replaces the active arrangement and closes it at the boundary", () => {
    const active = monthlyArrangement({ id: "arr_current" });
    const store = makeStore({ commercialArrangements: [active] });
    const input = {
      ...validMonthlyInput,
      id: "arr_successor",
      effectiveFrom: NOW,
    };
    const result = applyCommercialTransition(store, input, NOW);
    const closed = result.store.commercialArrangements.find(
      (a) => a.id === "arr_current"
    )!;
    expect(closed.status).toBe("ended");
    expect(closed.effectiveTo).toBe(NOW);
    expect(closed.replacedByArrangementId).toBe("arr_successor");
    expect(result.arrangement.status).toBe("active");
  });

  it("uses the successor effectiveFrom as the boundary when it is later than the active start", () => {
    const active = monthlyArrangement({ id: "arr_current", effectiveFrom: T0 });
    const store = makeStore({ commercialArrangements: [active] });
    const input = {
      ...validMonthlyInput,
      id: "arr_successor",
      effectiveFrom: T1,
    };
    const result = applyCommercialTransition(store, input, T1);
    const closed = result.store.commercialArrangements.find(
      (a) => a.id === "arr_current"
    )!;
    expect(closed.effectiveTo).toBe(T1);
  });

  it("keeps the current arrangement active for a scheduled replacement", () => {
    const active = monthlyArrangement({ id: "arr_current" });
    const store = makeStore({ commercialArrangements: [active] });
    const input = {
      ...validMonthlyInput,
      id: "arr_successor",
      effectiveFrom: T2,
    };
    const result = applyCommercialTransition(store, input, NOW);
    const current = result.store.commercialArrangements.find(
      (a) => a.id === "arr_current"
    )!;
    expect(current.status).toBe("active");
    expect(current.replacedByArrangementId).toBeNull();
    expect(result.arrangement.status).toBe("scheduled");
  });

  it("throws on a duplicate arrangement id without writing", () => {
    const existing = monthlyArrangement({ id: "arr_new" });
    const store = makeStore({ commercialArrangements: [existing] });
    expect(() => applyCommercialTransition(store, validMonthlyInput, NOW)).toThrow(
      /already exists/
    );
    expect(store.commercialArrangements).toHaveLength(1);
  });

  it("throws on invalid input without writing", () => {
    const store = makeStore();
    const input = { ...validMonthlyInput, monthlyAmountCents: -5 };
    expect(() => applyCommercialTransition(store, input, NOW)).toThrow(
      /monthlyAmountCents/
    );
    expect(store.commercialArrangements).toHaveLength(0);
    expect(store.activityEvents).toHaveLength(0);
  });

  it("never mutates the input store records", () => {
    const active = monthlyArrangement({ id: "arr_current" });
    const store = makeStore({ commercialArrangements: [active] });
    applyCommercialTransition(
      store,
      { ...validMonthlyInput, id: "arr_successor", effectiveFrom: NOW },
      NOW
    );
    expect(store.commercialArrangements[0].status).toBe("active");
    expect(store.commercialArrangements[0].replacedByArrangementId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyAccessRevocation
// ---------------------------------------------------------------------------

describe("applyAccessRevocation", () => {
  const baseInput: AccessRevocationInput = {
    grantId: "grant_1",
    customerId: "cust_1",
    reason: "Compliance.",
    effectiveAt: NOW,
    occurredAt: NOW,
  };

  it("revokes immediately and clears any scheduled revocation", () => {
    const store = makeStore({
      agentAccessGrants: [grant({ scheduledRevokeAt: T2 })],
    });
    const result = applyAccessRevocation(store, baseInput);
    expect(result.grant.revokedAt).toBe(NOW);
    expect(result.grant.scheduledRevokeAt).toBeNull();
    expect(result.event.id).toBe(accessRevokedEventId("grant_1"));
    expect(result.event.type).toBe("access.revoked");
    expect(result.event.resultingState).toBe("revoked");
  });

  it("schedules a future revocation", () => {
    const store = makeStore({ agentAccessGrants: [grant()] });
    const result = applyAccessRevocation(store, {
      ...baseInput,
      effectiveAt: T2,
    });
    expect(result.grant.revokedAt).toBeNull();
    expect(result.grant.scheduledRevokeAt).toBe(T2);
    expect(result.event.id).toBe(accessRevokeScheduledEventId("grant_1"));
    expect(result.event.resultingState).toBe("scheduled");
  });

  it("propagates causationId onto the event", () => {
    const store = makeStore({ agentAccessGrants: [grant()] });
    const result = applyAccessRevocation(store, {
      ...baseInput,
      causationId: "evt_arr_1_terminated",
    });
    expect(result.event.causationId).toBe("evt_arr_1_terminated");
  });

  it("throws when the grant does not exist", () => {
    const store = makeStore();
    expect(() =>
      applyAccessRevocation(store, { ...baseInput, grantId: "grant_missing" })
    ).toThrow(/does not exist/);
  });

  it("throws when the reason is empty", () => {
    const store = makeStore({ agentAccessGrants: [grant()] });
    expect(() =>
      applyAccessRevocation(store, { ...baseInput, reason: "   " })
    ).toThrow(/reason is required/);
  });

  it("throws when the grant is already revoked", () => {
    const store = makeStore({
      agentAccessGrants: [grant({ revokedAt: T1 })],
    });
    expect(() => applyAccessRevocation(store, baseInput)).toThrow(
      /already revoked/
    );
  });

  it("throws when already scheduled and the new revocation is not immediate", () => {
    const store = makeStore({
      agentAccessGrants: [grant({ scheduledRevokeAt: T2 })],
    });
    expect(() =>
      applyAccessRevocation(store, { ...baseInput, effectiveAt: T3 })
    ).toThrow(/already scheduled for revocation/);
  });

  it("allows an immediate override of a scheduled revocation", () => {
    const store = makeStore({
      agentAccessGrants: [grant({ scheduledRevokeAt: T2 })],
    });
    const result = applyAccessRevocation(store, baseInput);
    expect(result.grant.revokedAt).toBe(NOW);
    expect(result.grant.scheduledRevokeAt).toBeNull();
  });

  it("retains the original grant record in history", () => {
    const store = makeStore({ agentAccessGrants: [grant()] });
    const result = applyAccessRevocation(store, baseInput);
    expect(result.store.agentAccessGrants).toHaveLength(1);
    expect(result.store.agentAccessGrants[0].id).toBe("grant_1");
  });
});

// ---------------------------------------------------------------------------
// resolveAgentAccessStatus
// ---------------------------------------------------------------------------

describe("resolveAgentAccessStatus", () => {
  it.each([
    {
      name: "active once started with no expiry",
      grant: grant(),
      at: NOW,
      expected: "active",
    },
    {
      name: "scheduled before startsAt",
      grant: grant({ startsAt: T2 }),
      at: NOW,
      expected: "scheduled",
    },
    {
      name: "expired past endsAt",
      grant: grant({ endsAt: T1 }),
      at: NOW,
      expected: "expired",
    },
    {
      name: "active exactly at endsAt",
      grant: grant({ endsAt: NOW }),
      at: NOW,
      expected: "active",
    },
    {
      name: "revoked once revokedAt has arrived",
      grant: grant({ revokedAt: T1 }),
      at: NOW,
      expected: "revoked",
    },
    {
      name: "revoked once scheduledRevokeAt has arrived",
      grant: grant({ scheduledRevokeAt: T1 }),
      at: NOW,
      expected: "revoked",
    },
    {
      name: "active before a future scheduledRevokeAt",
      grant: grant({ scheduledRevokeAt: T2 }),
      at: NOW,
      expected: "active",
    },
  ])("$name", ({ grant: g, at, expected }) => {
    expect(resolveAgentAccessStatus(g, at)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// reconcileCommercialLifecycle
// ---------------------------------------------------------------------------

describe("reconcileCommercialLifecycle", () => {
  it("activates a due scheduled arrangement and closes the superseded active one", () => {
    const active = monthlyArrangement({ id: "arr_current", effectiveFrom: T0 });
    const scheduled = monthlyArrangement({
      id: "arr_next",
      status: "scheduled",
      effectiveFrom: T2,
    });
    const store = makeStore({
      commercialArrangements: [active, scheduled],
    });
    const result = reconcileCommercialLifecycle(store, "cust_1", T2);
    const closed = result.store.commercialArrangements.find(
      (a) => a.id === "arr_current"
    )!;
    const activated = result.store.commercialArrangements.find(
      (a) => a.id === "arr_next"
    )!;
    expect(closed.status).toBe("ended");
    expect(closed.effectiveTo).toBe(T2);
    expect(closed.replacedByArrangementId).toBe("arr_next");
    expect(activated.status).toBe("active");
    expect(result.changed).toBe(true);
  });

  it("marks an expired annual arrangement ended and records a commercial.ended event", () => {
    const arrangement = annualArrangement({ id: "arr_annual", endsAt: T1 });
    const store = makeStore({ commercialArrangements: [arrangement] });
    const result = reconcileCommercialLifecycle(store, "cust_1", NOW);
    const ended = result.store.commercialArrangements.find(
      (a) => a.id === "arr_annual"
    )!;
    expect(ended.status).toBe("ended");
    expect(
      result.store.activityEvents.some(
        (e) => e.id === commercialEndedEventId("arr_annual")
      )
    ).toBe(true);
    expect(result.changed).toBe(true);
  });

  it("revokes active grants with a shared causationId when no arrangement is active", () => {
    const terminated = monthlyArrangement({
      id: "arr_term",
      status: "terminated",
      effectiveTo: T1,
    });
    const g1 = grant({ id: "grant_1" });
    const g2 = grant({ id: "grant_2", agentProductId: "agent_courier" });
    const store = makeStore({
      commercialArrangements: [terminated],
      agentAccessGrants: [g1, g2],
    });
    const result = reconcileCommercialLifecycle(store, "cust_1", NOW);
    const revocations = result.store.activityEvents.filter(
      (e) => e.type === "access.revoked"
    );
    expect(revocations).toHaveLength(2);
    expect(
      revocations.every(
        (e) => e.causationId === commercialTerminatedEventId("arr_term")
      )
    ).toBe(true);
    expect(
      result.store.agentAccessGrants.every((g) => g.revokedAt === NOW)
    ).toBe(true);
  });

  it("is idempotent for a repeated asOf", () => {
    const terminated = monthlyArrangement({
      id: "arr_term",
      status: "terminated",
      effectiveTo: T1,
    });
    const store = makeStore({
      commercialArrangements: [terminated],
      agentAccessGrants: [grant()],
    });
    const first = reconcileCommercialLifecycle(store, "cust_1", NOW);
    const second = reconcileCommercialLifecycle(first.store, "cust_1", NOW);
    expect(second.changed).toBe(false);
    expect(second.store.activityEvents).toEqual(first.store.activityEvents);
    expect(second.store.agentAccessGrants).toEqual(
      first.store.agentAccessGrants
    );
  });

  it("returns changed: false when nothing needs reconciliation", () => {
    const active = monthlyArrangement();
    const store = makeStore({ commercialArrangements: [active] });
    const result = reconcileCommercialLifecycle(store, "cust_1", NOW);
    expect(result.changed).toBe(false);
    expect(result.store).toEqual(store);
  });

  it("does not restore previously revoked grants", () => {
    const terminated = monthlyArrangement({
      id: "arr_term",
      status: "terminated",
      effectiveTo: T1,
    });
    const alreadyRevoked = grant({ revokedAt: T1 });
    const store = makeStore({
      commercialArrangements: [terminated],
      agentAccessGrants: [alreadyRevoked],
    });
    const result = reconcileCommercialLifecycle(store, "cust_1", NOW);
    const revocations = result.store.activityEvents.filter(
      (e) => e.type === "access.revoked"
    );
    expect(revocations).toHaveLength(0);
    expect(result.store.agentAccessGrants[0].revokedAt).toBe(T1);
  });
});