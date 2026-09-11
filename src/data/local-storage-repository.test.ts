import { describe, expect, it } from "vitest";

import {
  createInMemoryRepository,
  type StorageLike,
} from "@/data/local-storage-repository";
import { AGENT_PRODUCTS, SEED_NOW, buildSeedStore } from "@/data/seed-data";
import { usageDebitTransactionId } from "@/domain/ledger-rules";
import type { DataStore, DataStoreV1 } from "@/domain/types";

/**
 * Storage key used by the repository. Kept in sync with the implementation;
 * the migration test seeds a legacy v1 payload under this exact key.
 */
const STORAGE_KEY = "hivarium.operator-console.store.v1";

/** Reads the persisted store so tests can assert exact write behavior. */
function readPersistedStore(storage: StorageLike): DataStore {
  const raw = storage.getItem(STORAGE_KEY);
  return JSON.parse(raw!) as DataStore;
}

describe("LocalStorageRepository commercial and access lifecycle", () => {
  it("derives legacy subscriptions from monthly arrangements", async () => {
    const { repository } = createInMemoryRepository();
    const subscriptions = await repository.getSubscriptions("cust_northwind");
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions.every((s) => s.plan === "growth")).toBe(true);
  });

  it("projects the commercial snapshot with active, scheduled, and history", async () => {
    const { repository } = createInMemoryRepository();
    const snapshot = await repository.getCommercialSnapshot(
      "cust_greyharbor",
      SEED_NOW
    );
    expect(snapshot.active).toBeNull();
    expect(snapshot.history.length).toBeGreaterThan(0);
    // History is ordered newest first.
    const dates = snapshot.history.map((a) => Date.parse(a.effectiveFrom));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it("saves a monthly commercial arrangement for a customer without an active one", async () => {
    const { repository } = createInMemoryRepository();
    const arrangement = await repository.saveCommercialArrangement(
      {
        id: "arr_test_monthly",
        customerId: "cust_greyharbor",
        model: "monthly",
        status: "active",
        effectiveFrom: SEED_NOW,
        effectiveTo: null,
        createdAt: SEED_NOW,
        reason: "Test monthly arrangement.",
        currency: "USD",
        billingCadence: "monthly",
        monthlyAmountCents: 19900,
        renewsAt: "2027-01-01T00:00:00.000Z",
      },
      SEED_NOW
    );
    expect(arrangement.model).toBe("monthly");
    const snapshot = await repository.getCommercialSnapshot(
      "cust_greyharbor",
      SEED_NOW
    );
    expect(snapshot.active?.id).toBe("arr_test_monthly");
    // A linked activity event is recorded.
    expect(
      (await repository.listActivityEvents("cust_greyharbor")).some(
        (e) => e.subjectId === "arr_test_monthly"
      )
    ).toBe(true);
  });

  it("immediately replaces the active arrangement and closes the previous one", async () => {
    const { repository } = createInMemoryRepository();
    const arrangement = await repository.saveCommercialArrangement(
      {
        id: "arr_sablefin_replacement",
        customerId: "cust_sablefin",
        model: "monthly",
        status: "active",
        effectiveFrom: SEED_NOW,
        effectiveTo: null,
        createdAt: SEED_NOW,
        reason: "Converted from trial.",
        currency: "USD",
        billingCadence: "monthly",
        monthlyAmountCents: 19900,
        renewsAt: "2027-01-01T00:00:00.000Z",
      },
      SEED_NOW
    );
    expect(arrangement.status).toBe("active");
    const snapshot = await repository.getCommercialSnapshot(
      "cust_sablefin",
      SEED_NOW
    );
    expect(snapshot.active?.id).toBe("arr_sablefin_replacement");
    // The superseded arrangement is closed at the boundary and points at the
    // successor instead of being deleted.
    const closed = (
      await repository.listCommercialArrangements("cust_sablefin")
    ).find((a) => a.id === "arr_sub_sablefin_sentinel_trial");
    expect(closed?.status).toBe("ended");
    expect(closed?.effectiveTo).toBe(SEED_NOW);
    expect(closed?.replacedByArrangementId).toBe("arr_sablefin_replacement");
  });

  it("schedules a replacement without disturbing the current arrangement", async () => {
    const { repository } = createInMemoryRepository();
    const arrangement = await repository.saveCommercialArrangement(
      {
        id: "arr_sablefin_scheduled",
        customerId: "cust_sablefin",
        model: "monthly",
        status: "scheduled",
        effectiveFrom: "2026-12-01T00:00:00.000Z",
        effectiveTo: null,
        createdAt: SEED_NOW,
        reason: "Scheduled plan change.",
        currency: "USD",
        billingCadence: "monthly",
        monthlyAmountCents: 49000,
        renewsAt: "2027-12-01T00:00:00.000Z",
      },
      SEED_NOW
    );
    expect(arrangement.status).toBe("scheduled");
    const snapshot = await repository.getCommercialSnapshot(
      "cust_sablefin",
      SEED_NOW
    );
    expect(snapshot.active?.id).toBe("arr_sub_sablefin_sentinel_trial");
    expect(snapshot.scheduled?.id).toBe("arr_sablefin_scheduled");
    const current = (
      await repository.listCommercialArrangements("cust_sablefin")
    ).find((a) => a.id === "arr_sub_sablefin_sentinel_trial");
    expect(current?.status).toBe("active");
    expect(current?.replacedByArrangementId).toBeNull();
  });

  it("rejects saving an arrangement for an unknown customer", async () => {
    const { repository } = createInMemoryRepository();
    await expect(
      repository.saveCommercialArrangement(
        {
          id: "arr_unknown",
          customerId: "cust_missing",
          model: "monthly",
          status: "active",
          effectiveFrom: SEED_NOW,
          effectiveTo: null,
          createdAt: SEED_NOW,
          reason: "Unknown customer.",
          currency: "USD",
          billingCadence: "monthly",
          monthlyAmountCents: 19900,
          renewsAt: "2027-01-01T00:00:00.000Z",
        },
        SEED_NOW
      )
    ).rejects.toThrow(/does not exist/);
  });

  it("rejects saving an invalid arrangement without writing", async () => {
    const { repository } = createInMemoryRepository();
    await expect(
      repository.saveCommercialArrangement(
        {
          id: "arr_invalid",
          customerId: "cust_greyharbor",
          model: "monthly",
          status: "active",
          effectiveFrom: SEED_NOW,
          effectiveTo: null,
          createdAt: SEED_NOW,
          reason: "Invalid.",
          currency: "USD",
          billingCadence: "monthly",
          monthlyAmountCents: -1,
          renewsAt: "2027-01-01T00:00:00.000Z",
        },
        SEED_NOW
      )
    ).rejects.toThrow(/monthlyAmountCents/);
    expect(
      await repository.listCommercialArrangements("cust_greyharbor")
    ).toHaveLength(3);
  });

  it("projects the agent access snapshot with current, scheduled, and history", async () => {
    const { repository } = createInMemoryRepository();
    const snapshot = await repository.getAgentAccessSnapshot(
      "cust_greyharbor",
      SEED_NOW
    );
    expect(snapshot.current).toHaveLength(0);
    expect(snapshot.history.length).toBeGreaterThan(0);
    expect(snapshot.history[0].revokedAt).not.toBeNull();
  });

  it("grants agent access and prevents duplicate active grants", async () => {
    const { repository } = createInMemoryRepository();
    const grant = await repository.grantAgentAccess(
      {
        customerId: "cust_greyharbor",
        agentProductId: "agent_sentinel",
        startsAt: SEED_NOW,
        endsAt: null,
        createdAt: SEED_NOW,
        reasonForChange: "Test grant.",
      },
      SEED_NOW
    );
    expect(grant.agentProductId).toBe("agent_sentinel");
    expect(
      (
        await repository.getAgentAccessSnapshot("cust_greyharbor", SEED_NOW)
      ).current.some((g) => g.agentProductId === "agent_sentinel")
    ).toBe(true);

    await expect(
      repository.grantAgentAccess(
        {
          customerId: "cust_greyharbor",
          agentProductId: "agent_sentinel",
          startsAt: SEED_NOW,
          endsAt: null,
          createdAt: SEED_NOW,
          reasonForChange: "Duplicate grant.",
        },
        SEED_NOW
      )
    ).rejects.toThrow(/already has active or scheduled access/);
  });

  it("lists activity events newest first", async () => {
    const { repository } = createInMemoryRepository();
    const events = await repository.listActivityEvents("cust_northwind");
    expect(events.length).toBeGreaterThan(0);
    const dates = events.map((e) => Date.parse(e.occurredAt));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it("archives a customer and retains dependent records", async () => {
    const { repository } = createInMemoryRepository();
    await repository.archiveCustomer("cust_northwind");
    expect((await repository.getCustomer("cust_northwind"))?.status).toBe(
      "archived"
    );
    expect(
      await repository.listCommercialArrangements("cust_northwind")
    ).toHaveLength(2);
    expect(await repository.listAgentAccessGrants("cust_northwind")).toHaveLength(
      2
    );
    expect(await repository.listActivityEvents("cust_northwind")).toHaveLength(
      4
    );
  });
});

describe("terminateCommercialArrangement", () => {
  it("terminates an arrangement and revokes active grants with a shared causationId", async () => {
    const { repository } = createInMemoryRepository();
    const terminated = await repository.terminateCommercialArrangement(
      {
        arrangementId: "arr_sub_northwind_courier_growth",
        customerId: "cust_northwind",
        reason: "Account consolidation.",
      },
      SEED_NOW
    );
    expect(terminated.status).toBe("terminated");
    expect(terminated.effectiveTo).toBe(SEED_NOW);

    // Every active grant for the customer is revoked in the same write.
    const grants = await repository.listAgentAccessGrants("cust_northwind");
    expect(grants).toHaveLength(2);
    expect(grants.every((g) => g.revokedAt === SEED_NOW)).toBe(true);

    // One triggering event plus one system-sourced access event per grant,
    // all sharing the trigger event id as causationId.
    const events = await repository.listActivityEvents("cust_northwind");
    const trigger = events.find(
      (e) => e.id === "evt_arr_sub_northwind_courier_growth_terminated"
    );
    expect(trigger?.type).toBe("commercial.terminated");
    expect(trigger?.source).toBe("operator");
    const revocations = events.filter((e) => e.type === "access.revoked");
    expect(revocations).toHaveLength(2);
    expect(revocations.every((e) => e.source === "system")).toBe(true);
    expect(
      revocations.every(
        (e) =>
          e.causationId === "evt_arr_sub_northwind_courier_growth_terminated"
      )
    ).toBe(true);
  });

  it("rejects terminating a missing arrangement", async () => {
    const { repository } = createInMemoryRepository();
    await expect(
      repository.terminateCommercialArrangement(
        {
          arrangementId: "arr_missing",
          customerId: "cust_northwind",
          reason: "Cleanup.",
        },
        SEED_NOW
      )
    ).rejects.toThrow(/does not exist/);
  });

  it("rejects terminating with an empty reason", async () => {
    const { repository } = createInMemoryRepository();
    await expect(
      repository.terminateCommercialArrangement(
        {
          arrangementId: "arr_sub_northwind_courier_growth",
          customerId: "cust_northwind",
          reason: "   ",
        },
        SEED_NOW
      )
    ).rejects.toThrow(/reason is required/);
  });

  it("rejects terminating an already terminated arrangement", async () => {
    const { repository } = createInMemoryRepository();
    await expect(
      repository.terminateCommercialArrangement(
        {
          arrangementId: "arr_greyharbor_monthly_terminated",
          customerId: "cust_greyharbor",
          reason: "Again.",
        },
        SEED_NOW
      )
    ).rejects.toThrow(/already terminated/);
  });
});

describe("reconcileCommercialLifecycle", () => {
  it("activates a due scheduled arrangement and closes the superseded one", async () => {
    const { repository } = createInMemoryRepository();
    await repository.reconcileCommercialLifecycle(
      "cust_meridians",
      "2026-12-01T00:00:00.000Z"
    );
    const snapshot = await repository.getCommercialSnapshot(
      "cust_meridians",
      "2026-12-01T00:00:00.000Z"
    );
    expect(snapshot.active?.id).toBe("arr_meridians_monthly_scheduled");
    const closed = (
      await repository.listCommercialArrangements("cust_meridians")
    ).find((a) => a.id === "arr_meridians_prepaid");
    expect(closed?.status).toBe("ended");
    expect(closed?.effectiveTo).toBe("2026-12-01T00:00:00.000Z");
    expect(closed?.replacedByArrangementId).toBe(
      "arr_meridians_monthly_scheduled"
    );
  });

  it("is idempotent for a repeated asOf", async () => {
    const { repository } = createInMemoryRepository();
    await repository.reconcileCommercialLifecycle(
      "cust_meridians",
      "2026-12-01T00:00:00.000Z"
    );
    const eventsAfterFirst = (
      await repository.listActivityEvents("cust_meridians")
    ).length;
    await repository.reconcileCommercialLifecycle(
      "cust_meridians",
      "2026-12-01T00:00:00.000Z"
    );
    expect(await repository.listActivityEvents("cust_meridians")).toHaveLength(
      eventsAfterFirst
    );
  });

  it("revokes active grants with a shared causationId when no arrangement is active", async () => {
    const { repository } = createInMemoryRepository();
    // Remove the only active arrangement, then grant fresh access so a
    // still-active grant exists without any commercial coverage.
    await repository.terminateCommercialArrangement(
      {
        arrangementId: "arr_sub_sablefin_sentinel_trial",
        customerId: "cust_sablefin",
        reason: "Trial ended.",
      },
      SEED_NOW
    );
    await repository.grantAgentAccess(
      {
        customerId: "cust_sablefin",
        agentProductId: "agent_sentinel",
        startsAt: SEED_NOW,
        endsAt: null,
        createdAt: SEED_NOW,
        reasonForChange: "Post-termination grant.",
      },
      SEED_NOW
    );
    await repository.reconcileCommercialLifecycle("cust_sablefin", SEED_NOW);

    const grants = await repository.listAgentAccessGrants("cust_sablefin");
    expect(
      grants.some((g) => g.revokedAt === SEED_NOW && g.endsAt === null)
    ).toBe(true);
    const revocations = (
      await repository.listActivityEvents("cust_sablefin")
    ).filter((e) => e.type === "access.revoked");
    expect(revocations).toHaveLength(1);
    expect(revocations[0].source).toBe("system");
    expect(revocations[0].causationId).toBe(
      "evt_arr_sub_sablefin_sentinel_trial_terminated"
    );
  });

  it("is a no-op for a customer with no due transitions and no active grants to revoke", async () => {
    const { repository } = createInMemoryRepository();
    const eventsBefore = (
      await repository.listActivityEvents("cust_northwind")
    ).length;
    await repository.reconcileCommercialLifecycle("cust_northwind", SEED_NOW);
    expect(await repository.listActivityEvents("cust_northwind")).toHaveLength(
      eventsBefore
    );
  });
});

describe("revokeAgentAccess", () => {
  it("revokes agent access immediately", async () => {
    const { repository } = createInMemoryRepository();
    const grant = await repository.revokeAgentAccess(
      {
        grantId: "grant_lic_northwind_courier",
        customerId: "cust_northwind",
        reason: "Compliance review.",
      },
      SEED_NOW
    );
    expect(grant.revokedAt).toBe(SEED_NOW);
    expect(grant.scheduledRevokeAt).toBeNull();
    const snapshot = await repository.getAgentAccessSnapshot(
      "cust_northwind",
      SEED_NOW
    );
    expect(
      snapshot.current.some((g) => g.id === "grant_lic_northwind_courier")
    ).toBe(false);
    expect(
      snapshot.history.some((g) => g.id === "grant_lic_northwind_courier")
    ).toBe(true);
  });

  it("schedules a future agent access revocation", async () => {
    const { repository } = createInMemoryRepository();
    const grant = await repository.revokeAgentAccess(
      {
        grantId: "grant_lic_northwind_courier",
        customerId: "cust_northwind",
        reason: "End of term.",
        effectiveAt: "2026-12-01T00:00:00.000Z",
      },
      SEED_NOW
    );
    expect(grant.revokedAt).toBeNull();
    expect(grant.scheduledRevokeAt).toBe("2026-12-01T00:00:00.000Z");
    // The grant keeps working until the scheduled date.
    const snapshot = await repository.getAgentAccessSnapshot(
      "cust_northwind",
      SEED_NOW
    );
    expect(
      snapshot.current.some((g) => g.id === "grant_lic_northwind_courier")
    ).toBe(true);
  });

  it("rejects revoking a missing grant", async () => {
    const { repository } = createInMemoryRepository();
    await expect(
      repository.revokeAgentAccess(
        {
          grantId: "grant_missing",
          customerId: "cust_northwind",
          reason: "Cleanup.",
        },
        SEED_NOW
      )
    ).rejects.toThrow(/does not exist/);
  });

  it("rejects revoking an already revoked grant", async () => {
    const { repository } = createInMemoryRepository();
    await expect(
      repository.revokeAgentAccess(
        {
          grantId: "grant_greyharbor_sentinel",
          customerId: "cust_greyharbor",
          reason: "Again.",
        },
        SEED_NOW
      )
    ).rejects.toThrow(/already revoked/);
  });
});

describe("migrateStore", () => {
  it("upgrades a legacy v1 payload to the canonical v2 shape", async () => {
    const { repository, storage } = createInMemoryRepository(false);
    const v1: DataStoreV1 = {
      customers: [
        {
          id: "cust_legacy",
          name: "Legacy Co",
          domain: "legacy.example",
          contact: "Ada Lovelace",
          email: "ada@legacy.example",
          status: "active",
          notes: "",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
      subscriptions: [
        {
          id: "sub_legacy_growth",
          customerId: "cust_legacy",
          plan: "growth",
          agentProductId: "agent_courier",
          seats: 10,
          startedAt: "2024-01-01T00:00:00.000Z",
          renewsAt: "2026-01-01T00:00:00.000Z",
          status: "active",
        },
      ],
      featureEntitlements: [],
      agentProducts: AGENT_PRODUCTS,
      agentLicenses: [
        {
          id: "lic_legacy_courier",
          customerId: "cust_legacy",
          agentProductId: "agent_courier",
          seats: 10,
          issuedAt: "2024-01-01T00:00:00.000Z",
          expiresAt: null,
          status: "active",
        },
      ],
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(v1));

    expect(await repository.getCustomer("cust_legacy")).toBeDefined();
    expect(
      await repository.listCommercialArrangements("cust_legacy")
    ).toHaveLength(1);
    expect(await repository.listAgentAccessGrants("cust_legacy")).toHaveLength(
      1
    );
    expect(
      (await repository.listActivityEvents("cust_legacy")).length
    ).toBeGreaterThan(0);
  });

  it("upgrades a canonical v3 payload to v4 without dropping ledger or usage rows", async () => {
    const { repository, storage } = createInMemoryRepository(false);
    const v3 = {
      ...buildSeedStore(),
      schemaVersion: 3 as const,
      customers: buildSeedStore().customers.map((customer) =>
        customer.id === "cust_sablefin"
          ? { ...customer, status: "archived" }
          : customer
      ),
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(v3));

    // Trigger the migration read; the repository re-persists the upgraded
    // payload only when the migration actually changed it.
    expect((await repository.getCustomer("cust_sablefin"))?.status).toBe(
      "archived"
    );

    const persisted = readPersistedStore(storage);
    expect(persisted.schemaVersion).toBe(4);
    // Every generalized collection survives the v3→v4 migration untouched.
    expect(persisted.customers).toHaveLength(v3.customers.length);
    expect(persisted.commercialArrangements).toHaveLength(
      v3.commercialArrangements.length
    );
    expect(persisted.agentAccessGrants).toHaveLength(
      v3.agentAccessGrants.length
    );
    expect(persisted.activityEvents).toHaveLength(v3.activityEvents.length);
    expect(persisted.ledgerTransactions).toHaveLength(
      v3.ledgerTransactions.length
    );
    expect(persisted.usageRecords).toHaveLength(v3.usageRecords.length);
    // The archived lifecycle status passes through unchanged.
    expect(
      persisted.customers.find((c) => c.id === "cust_sablefin")?.status
    ).toBe("archived");
    // The migrated store is readable through the repository.
    expect((await repository.getCustomer("cust_sablefin"))?.status).toBe(
      "archived"
    );
    expect(await repository.getTokenBalance("cust_meridians")).toBe(
      buildSeedStore().ledgerTransactions
        .filter((t) => t.customerId === "cust_meridians")
        .reduce((sum, t) => sum + t.amountTokens, 0)
    );
  });
});

describe("recordUsageDebit", () => {
  const usageInput = {
    customerId: "cust_meridians",
    agentProductId: "agent_sentinel",
    tokenQuantity: 1200,
    sourceReference: "usage_meridians_001",
  };

  it("commits the usage record and linked usage_debit atomically", async () => {
    const { repository, storage } = createInMemoryRepository();
    const result = await repository.recordUsageDebit(usageInput, SEED_NOW);
    expect(result.usage).toMatchObject({
      customerId: "cust_meridians",
      agentProductId: "agent_sentinel",
      tokenQuantity: 1200,
      sourceReference: "usage_meridians_001",
    });
    expect(result.transaction).toMatchObject({
      kind: "usage_debit",
      amountTokens: -1200,
      usageRecordId: result.usage.id,
      agentProductId: "agent_sentinel",
    });
    // Both records land in the same persisted write: the three seeded usage
    // records plus this one, and the six seeded ledger transactions plus the
    // new usage debit.
    const persisted = readPersistedStore(storage);
    expect(persisted.usageRecords).toHaveLength(4);
    expect(persisted.ledgerTransactions).toHaveLength(7);
    expect(await repository.getTokenBalance("cust_meridians")).toBe(248800);
  });

  it("returns the existing pair without writing on an exact replay", async () => {
    const { repository, storage } = createInMemoryRepository();
    const first = await repository.recordUsageDebit(usageInput, SEED_NOW);
    const before = storage.getItem(STORAGE_KEY);
    const replay = await repository.recordUsageDebit(usageInput, SEED_NOW);
    expect(replay.usage.id).toBe(first.usage.id);
    expect(replay.transaction.id).toBe(first.transaction.id);
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
    expect(await repository.getTokenBalance("cust_meridians")).toBe(248800);
  });

  it("rejects a conflicting reuse of the source reference without writing", async () => {
    const { repository, storage } = createInMemoryRepository();
    await repository.recordUsageDebit(usageInput, SEED_NOW);
    const before = storage.getItem(STORAGE_KEY);
    await expect(
      repository.recordUsageDebit(
        { ...usageInput, tokenQuantity: 999 },
        SEED_NOW
      )
    ).rejects.toThrow(
      /Source reference "usage_meridians_001" is already assigned to different usage/
    );
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
    expect(await repository.getTokenBalance("cust_meridians")).toBe(248800);
  });

  it("rejects a debit that would make the balance negative before any write", async () => {
    const { repository, storage } = createInMemoryRepository();
    const before = storage.getItem(STORAGE_KEY);
    await expect(
      repository.recordUsageDebit(
        { ...usageInput, tokenQuantity: 300000 },
        SEED_NOW
      )
    ).rejects.toThrow(/Insufficient token balance/);
    // The rejected debit is never written: only the three seeded usage records
    // and six seeded ledger transactions remain.
    const persisted = readPersistedStore(storage);
    expect(persisted.usageRecords).toHaveLength(3);
    expect(persisted.ledgerTransactions).toHaveLength(6);
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });

  it("rejects an unknown customer", async () => {
    const { repository } = createInMemoryRepository();
    await expect(
      repository.recordUsageDebit(
        { ...usageInput, customerId: "cust_missing" },
        SEED_NOW
      )
    ).rejects.toThrow(/does not exist/);
  });

  it("rejects a customer without an active prepaid arrangement", async () => {
    const { repository } = createInMemoryRepository();
    await expect(
      repository.recordUsageDebit(
        { ...usageInput, customerId: "cust_northwind" },
        SEED_NOW
      )
    ).rejects.toThrow(/does not have an active prepaid arrangement/);
  });

  it("rejects an unknown agent product", async () => {
    const { repository } = createInMemoryRepository();
    await expect(
      repository.recordUsageDebit(
        { ...usageInput, agentProductId: "agent_missing" },
        SEED_NOW
      )
    ).rejects.toThrow(/does not exist/);
  });
});

describe("addManualAdjustment", () => {
  const adjustmentInput = {
    customerId: "cust_meridians",
    amountTokens: -500,
    reference: "adj_meridians_001",
    reason: "Correction for over-credited balance.",
  };

  it("appends a positive adjustment", async () => {
    const { repository } = createInMemoryRepository();
    const transaction = await repository.addManualAdjustment(
      { ...adjustmentInput, amountTokens: 500 },
      SEED_NOW
    );
    expect(transaction.kind).toBe("manual_adjustment");
    expect(transaction.amountTokens).toBe(500);
    expect(await repository.getTokenBalance("cust_meridians")).toBe(250500);
  });

  it("appends a negative adjustment", async () => {
    const { repository } = createInMemoryRepository();
    const transaction = await repository.addManualAdjustment(
      adjustmentInput,
      SEED_NOW
    );
    expect(transaction.amountTokens).toBe(-500);
    expect(await repository.getTokenBalance("cust_meridians")).toBe(249500);
  });

  it("rejects a zero amount without writing", async () => {
    const { repository, storage } = createInMemoryRepository();
    const before = storage.getItem(STORAGE_KEY);
    await expect(
      repository.addManualAdjustment(
        { ...adjustmentInput, amountTokens: 0 },
        SEED_NOW
      )
    ).rejects.toThrow(/must be non-zero/);
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });

  it("rejects an adjustment that would make the balance negative", async () => {
    const { repository, storage } = createInMemoryRepository();
    const before = storage.getItem(STORAGE_KEY);
    await expect(
      repository.addManualAdjustment(
        { ...adjustmentInput, amountTokens: -300000 },
        SEED_NOW
      )
    ).rejects.toThrow(/Insufficient token balance/);
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });

  it("rejects a missing reason or reference", async () => {
    const { repository } = createInMemoryRepository();
    await expect(
      repository.addManualAdjustment(
        { ...adjustmentInput, reason: "   " },
        SEED_NOW
      )
    ).rejects.toThrow(/reason is required/);
    await expect(
      repository.addManualAdjustment(
        { ...adjustmentInput, reference: "" },
        SEED_NOW
      )
    ).rejects.toThrow(/reference is required/);
  });
});

describe("reverseTransaction", () => {
  const openingCreditId = "txn_opening_arr_meridians_prepaid";
  const reversalInput = {
    customerId: "cust_meridians",
    transactionId: openingCreditId,
    reference: "rev_meridians_001",
    reason: "Reversing the opening credit.",
  };

  it("appends one reversal negating the full target amount", async () => {
    const { repository } = createInMemoryRepository();
    const transaction = await repository.reverseTransaction(
      reversalInput,
      SEED_NOW
    );
    expect(transaction.kind).toBe("reversal");
    expect(transaction.amountTokens).toBe(-250000);
    if (transaction.kind === "reversal") {
      expect(transaction.reversesTransactionId).toBe(openingCreditId);
    }
    expect(await repository.getTokenBalance("cust_meridians")).toBe(0);
  });

  it("rejects a second reversal of the same target", async () => {
    const { repository } = createInMemoryRepository();
    await repository.reverseTransaction(reversalInput, SEED_NOW);
    await expect(
      repository.reverseTransaction(reversalInput, SEED_NOW)
    ).rejects.toThrow(/has already been reversed/);
  });

  it("rejects a reversal-of-reversal", async () => {
    const { repository } = createInMemoryRepository();
    const reversal = await repository.reverseTransaction(reversalInput, SEED_NOW);
    await expect(
      repository.reverseTransaction(
        {
          customerId: "cust_meridians",
          transactionId: reversal.id,
          reference: "rev_meridians_002",
          reason: "Trying to reverse the reversal.",
        },
        SEED_NOW
      )
    ).rejects.toThrow(/is a reversal and cannot be reversed/);
  });

  it("rejects a reversal that would make the balance negative", async () => {
    const { repository } = createInMemoryRepository();
    await repository.recordUsageDebit(
      {
        customerId: "cust_meridians",
        agentProductId: "agent_sentinel",
        tokenQuantity: 240000,
        sourceReference: "usage_meridians_big",
      },
      SEED_NOW
    );
    await expect(
      repository.reverseTransaction(reversalInput, SEED_NOW)
    ).rejects.toThrow(/Insufficient token balance/);
  });

  it("rejects a missing target", async () => {
    const { repository } = createInMemoryRepository();
    await expect(
      repository.reverseTransaction(
        { ...reversalInput, transactionId: "txn_missing" },
        SEED_NOW
      )
    ).rejects.toThrow(/does not exist/);
  });
});

describe("archiveCustomer ledger retention", () => {
  it("archives the customer and retains ledger and usage records", async () => {
    const { repository, storage } = createInMemoryRepository();
    await repository.recordUsageDebit(
      {
        customerId: "cust_meridians",
        agentProductId: "agent_sentinel",
        tokenQuantity: 1200,
        sourceReference: "usage_meridians_001",
      },
      SEED_NOW
    );
    await repository.archiveCustomer("cust_meridians");
    const persisted = readPersistedStore(storage);
    expect(
      persisted.ledgerTransactions.some(
        (t) => t.customerId === "cust_meridians"
      )
    ).toBe(true);
    expect(
      persisted.usageRecords.some((u) => u.customerId === "cust_meridians")
    ).toBe(true);
    expect((await repository.getCustomer("cust_meridians"))?.status).toBe(
      "archived"
    );
    expect(await repository.getTokenBalance("cust_meridians")).toBe(248800);
  });
});

describe("getAccountStatement", () => {
  it("returns newest-first rows with full-account running balances", async () => {
    const { repository } = createInMemoryRepository();
    const rows = await repository.getAccountStatement("cust_meridians");

    expect(rows).toHaveLength(6);
    const dates = rows.map((row) => Date.parse(row.transaction.occurredAt));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);

    // Balances are derived once in ascending order, then the display list is
    // reversed. These are full-account balances, never filtered subtotals.
    expect(rows.map((row) => row.resultingBalanceTokens)).toEqual([
      250000, // 2026-07-01 credit grant
      248000, // 2026-06-21 reversal of the duplicate usage debit
      246500, // 2026-06-20 usage debit
      248000, // 2026-06-02 usage debit
      248800, // 2026-05-14 usage debit
      250000, // 2026-04-11 opening credit
    ]);
  });

  it("exposes type, signed amount, reference, and reversal detail per row", async () => {
    const { repository } = createInMemoryRepository();
    const rows = await repository.getAccountStatement("cust_meridians");

    const reversalRow = rows.find((row) => row.transaction.kind === "reversal");
    expect(reversalRow?.transaction.amountTokens).toBe(1500);
    expect(
      reversalRow?.transaction.kind === "reversal"
        ? reversalRow.transaction.reversesTransactionId
        : null
    ).toBe(usageDebitTransactionId("usage_meridians_jun_003"));

    const usageRows = rows.filter(
      (row) => row.transaction.kind === "usage_debit"
    );
    expect(usageRows).toHaveLength(3);
    expect(
      usageRows.every(
        (row) =>
          row.transaction.kind === "usage_debit" &&
          row.transaction.amountTokens < 0 &&
          row.transaction.agentProductId.length > 0
      )
    ).toBe(true);
    expect(rows.every((row) => row.transaction.reference.length > 0)).toBe(
      true
    );
  });

  it("returns an empty statement for a customer without ledger history", async () => {
    const { repository } = createInMemoryRepository();
    expect(await repository.getAccountStatement("cust_northwind")).toEqual([]);
    expect(await repository.getAccountStatement("cust_missing")).toEqual([]);
  });

  it("is read-only and never persists a write", async () => {
    const { repository, storage } = createInMemoryRepository();
    const before = storage.getItem(STORAGE_KEY);
    await repository.getAccountStatement("cust_meridians");
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });
});

describe("getUsageSummary", () => {
  it("returns the full statement, net consumption, and per-agent breakdown", async () => {
    const { repository } = createInMemoryRepository();
    const summary = await repository.getUsageSummary("cust_meridians", {});

    expect(summary.customerId).toBe("cust_meridians");
    expect(summary.rows).toHaveLength(6);
    // -1200 (sentinel) - 800 (mercator) - 1500 (sentinel) + 1500 (reversal).
    expect(summary.netTokensConsumed).toBe(-2000);
    // Ordered highest consumption first (most negative net first).
    expect(summary.perAgent).toEqual([
      {
        agentProductId: "agent_sentinel",
        netTokensConsumed: -1200,
        agentName: "Sentinel",
      },
      {
        agentProductId: "agent_mercator",
        netTokensConsumed: -800,
        agentName: "Mercator",
      },
    ]);
  });

  it("applies an inclusive date range and nets a reversed debit to zero", async () => {
    const { repository } = createInMemoryRepository();
    const summary = await repository.getUsageSummary("cust_meridians", {
      from: "2026-06-01",
      to: "2026-06-30",
    });

    // jun_002 (-800), jun_003 (-1500), and the jun_003 reversal (+1500).
    expect(summary.netTokensConsumed).toBe(-800);
    expect(summary.perAgent).toEqual([
      {
        agentProductId: "agent_mercator",
        netTokensConsumed: -800,
        agentName: "Mercator",
      },
      {
        agentProductId: "agent_sentinel",
        netTokensConsumed: 0,
        agentName: "Sentinel",
      },
    ]);
    // Only in-range statement rows are returned, newest first.
    expect(summary.rows.map((row) => row.transaction.reference)).toEqual([
      "rev_usage_meridians_jun_003",
      "usage_meridians_jun_003",
      "usage_meridians_jun_002",
    ]);
  });

  it("keeps rows on both inclusive date boundaries", async () => {
    const { repository } = createInMemoryRepository();
    const summary = await repository.getUsageSummary("cust_meridians", {
      from: "2026-06-20",
      to: "2026-06-21",
    });
    expect(summary.rows.map((row) => row.transaction.reference)).toEqual([
      "rev_usage_meridians_jun_003",
      "usage_meridians_jun_003",
    ]);
    expect(summary.netTokensConsumed).toBe(0);
  });

  it("narrows the statement and summary by agent product", async () => {
    const { repository } = createInMemoryRepository();
    const summary = await repository.getUsageSummary(
      "cust_meridians",
      {},
      "agent_sentinel"
    );

    // Agent filtering keeps only usage_debit rows for that agent.
    expect(summary.rows.map((row) => row.transaction.reference)).toEqual([
      "usage_meridians_jun_003",
      "usage_meridians_may_001",
    ]);
    // The selected-period total still nets that agent's reversal.
    expect(summary.netTokensConsumed).toBe(-1200);
    expect(summary.perAgent).toEqual([
      {
        agentProductId: "agent_sentinel",
        netTokensConsumed: -1200,
        agentName: "Sentinel",
      },
    ]);
  });

  it("narrows the statement and summary by transaction type", async () => {
    const { repository } = createInMemoryRepository();
    const summary = await repository.getUsageSummary(
      "cust_meridians",
      {},
      undefined,
      "credit_grant"
    );

    expect(summary.rows.map((row) => row.transaction.reference)).toEqual([
      "credit_meridians_jul_001",
      "opening_arr_meridians_prepaid",
    ]);
    expect(summary.netTokensConsumed).toBe(0);
    expect(summary.perAgent).toEqual([]);
  });

  it("combines date, agent, and transaction-type filters", async () => {
    const { repository } = createInMemoryRepository();
    const summary = await repository.getUsageSummary(
      "cust_meridians",
      { from: "2026-05-01", to: "2026-06-30" },
      "agent_sentinel",
      "usage_debit"
    );

    expect(summary.rows.map((row) => row.transaction.reference)).toEqual([
      "usage_meridians_jun_003",
      "usage_meridians_may_001",
    ]);
    // The type filter excludes the reversal, so the two debits stand alone.
    expect(summary.netTokensConsumed).toBe(-2700);
    expect(summary.perAgent).toEqual([
      {
        agentProductId: "agent_sentinel",
        netTokensConsumed: -2700,
        agentName: "Sentinel",
      },
    ]);
  });

  it("keeps full-account resulting balances when rows are filtered", async () => {
    const { repository } = createInMemoryRepository();
    const summary = await repository.getUsageSummary(
      "cust_meridians",
      {},
      undefined,
      "usage_debit"
    );
    // Full-account balances at each transaction, never a filtered subtotal.
    expect(summary.rows.map((row) => row.resultingBalanceTokens)).toEqual([
      246500, 248000, 248800,
    ]);
  });

  it("rejects an inverted date range without writing", async () => {
    const { repository, storage } = createInMemoryRepository();
    const before = storage.getItem(STORAGE_KEY);
    await expect(
      repository.getUsageSummary("cust_meridians", {
        from: "2026-07-01",
        to: "2026-06-01",
      })
    ).rejects.toThrow(/From date must be on or before To date/);
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });

  it("returns an empty summary for a customer without ledger history", async () => {
    const { repository } = createInMemoryRepository();
    expect(await repository.getUsageSummary("cust_northwind", {})).toEqual({
      customerId: "cust_northwind",
      rows: [],
      netTokensConsumed: 0,
      perAgent: [],
    });
  });
});