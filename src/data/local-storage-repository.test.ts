import { describe, expect, it } from "vitest";

import { createInMemoryRepository } from "@/data/local-storage-repository";
import { AGENT_PRODUCTS, SEED_NOW } from "@/data/seed-data";
import type { DataStoreV1 } from "@/domain/types";

/**
 * Storage key used by the repository. Kept in sync with the implementation;
 * the migration test seeds a legacy v1 payload under this exact key.
 */
const STORAGE_KEY = "hivarium.operator-console.store.v1";

describe("LocalStorageRepository commercial and access lifecycle", () => {
  it("derives legacy subscriptions from monthly arrangements", () => {
    const { repository } = createInMemoryRepository();
    const subscriptions = repository.getSubscriptions("cust_northwind");
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions.every((s) => s.plan === "growth")).toBe(true);
  });

  it("projects the commercial snapshot with active, scheduled, and history", () => {
    const { repository } = createInMemoryRepository();
    const snapshot = repository.getCommercialSnapshot(
      "cust_greyharbor",
      SEED_NOW
    );
    expect(snapshot.active).toBeNull();
    expect(snapshot.history.length).toBeGreaterThan(0);
    // History is ordered newest first.
    const dates = snapshot.history.map((a) => Date.parse(a.effectiveFrom));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it("saves a monthly commercial arrangement for a customer without an active one", () => {
    const { repository } = createInMemoryRepository();
    const arrangement = repository.saveCommercialArrangement(
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
    const snapshot = repository.getCommercialSnapshot(
      "cust_greyharbor",
      SEED_NOW
    );
    expect(snapshot.active?.id).toBe("arr_test_monthly");
    // A linked activity event is recorded.
    expect(
      repository
        .listActivityEvents("cust_greyharbor")
        .some((e) => e.subjectId === "arr_test_monthly")
    ).toBe(true);
  });

  it("immediately replaces the active arrangement and closes the previous one", () => {
    const { repository } = createInMemoryRepository();
    const arrangement = repository.saveCommercialArrangement(
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
    const snapshot = repository.getCommercialSnapshot(
      "cust_sablefin",
      SEED_NOW
    );
    expect(snapshot.active?.id).toBe("arr_sablefin_replacement");
    // The superseded arrangement is closed at the boundary and points at the
    // successor instead of being deleted.
    const closed = repository
      .listCommercialArrangements("cust_sablefin")
      .find((a) => a.id === "arr_sub_sablefin_sentinel_trial");
    expect(closed?.status).toBe("ended");
    expect(closed?.effectiveTo).toBe(SEED_NOW);
    expect(closed?.replacedByArrangementId).toBe("arr_sablefin_replacement");
  });

  it("schedules a replacement without disturbing the current arrangement", () => {
    const { repository } = createInMemoryRepository();
    const arrangement = repository.saveCommercialArrangement(
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
    const snapshot = repository.getCommercialSnapshot(
      "cust_sablefin",
      SEED_NOW
    );
    expect(snapshot.active?.id).toBe("arr_sub_sablefin_sentinel_trial");
    expect(snapshot.scheduled?.id).toBe("arr_sablefin_scheduled");
    const current = repository
      .listCommercialArrangements("cust_sablefin")
      .find((a) => a.id === "arr_sub_sablefin_sentinel_trial");
    expect(current?.status).toBe("active");
    expect(current?.replacedByArrangementId).toBeNull();
  });

  it("rejects saving an arrangement for an unknown customer", () => {
    const { repository } = createInMemoryRepository();
    expect(() =>
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
    ).toThrow(/does not exist/);
  });

  it("rejects saving an invalid arrangement without writing", () => {
    const { repository } = createInMemoryRepository();
    expect(() =>
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
    ).toThrow(/monthlyAmountCents/);
    expect(
      repository.listCommercialArrangements("cust_greyharbor")
    ).toHaveLength(3);
  });

  it("projects the agent access snapshot with current, scheduled, and history", () => {
    const { repository } = createInMemoryRepository();
    const snapshot = repository.getAgentAccessSnapshot(
      "cust_greyharbor",
      SEED_NOW
    );
    expect(snapshot.current).toHaveLength(0);
    expect(snapshot.history.length).toBeGreaterThan(0);
    expect(snapshot.history[0].revokedAt).not.toBeNull();
  });

  it("grants agent access and prevents duplicate active grants", () => {
    const { repository } = createInMemoryRepository();
    const grant = repository.grantAgentAccess(
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
      repository
        .getAgentAccessSnapshot("cust_greyharbor", SEED_NOW)
        .current.some((g) => g.agentProductId === "agent_sentinel")
    ).toBe(true);

    expect(() =>
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
    ).toThrow(/already has active or scheduled access/);
  });

  it("lists activity events newest first", () => {
    const { repository } = createInMemoryRepository();
    const events = repository.listActivityEvents("cust_northwind");
    expect(events.length).toBeGreaterThan(0);
    const dates = events.map((e) => Date.parse(e.occurredAt));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it("cascades customer deletion across commercial, access, and activity records", () => {
    const { repository } = createInMemoryRepository();
    repository.deleteCustomer("cust_northwind");
    expect(repository.getCustomer("cust_northwind")).toBeUndefined();
    expect(
      repository.listCommercialArrangements("cust_northwind")
    ).toHaveLength(0);
    expect(repository.listAgentAccessGrants("cust_northwind")).toHaveLength(0);
    expect(repository.listActivityEvents("cust_northwind")).toHaveLength(0);
  });
});

describe("terminateCommercialArrangement", () => {
  it("terminates an arrangement and revokes active grants with a shared causationId", () => {
    const { repository } = createInMemoryRepository();
    const terminated = repository.terminateCommercialArrangement(
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
    const grants = repository.listAgentAccessGrants("cust_northwind");
    expect(grants).toHaveLength(2);
    expect(grants.every((g) => g.revokedAt === SEED_NOW)).toBe(true);

    // One triggering event plus one system-sourced access event per grant,
    // all sharing the trigger event id as causationId.
    const events = repository.listActivityEvents("cust_northwind");
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

  it("rejects terminating a missing arrangement", () => {
    const { repository } = createInMemoryRepository();
    expect(() =>
      repository.terminateCommercialArrangement(
        {
          arrangementId: "arr_missing",
          customerId: "cust_northwind",
          reason: "Cleanup.",
        },
        SEED_NOW
      )
    ).toThrow(/does not exist/);
  });

  it("rejects terminating with an empty reason", () => {
    const { repository } = createInMemoryRepository();
    expect(() =>
      repository.terminateCommercialArrangement(
        {
          arrangementId: "arr_sub_northwind_courier_growth",
          customerId: "cust_northwind",
          reason: "   ",
        },
        SEED_NOW
      )
    ).toThrow(/reason is required/);
  });

  it("rejects terminating an already terminated arrangement", () => {
    const { repository } = createInMemoryRepository();
    expect(() =>
      repository.terminateCommercialArrangement(
        {
          arrangementId: "arr_greyharbor_monthly_terminated",
          customerId: "cust_greyharbor",
          reason: "Again.",
        },
        SEED_NOW
      )
    ).toThrow(/already terminated/);
  });
});

describe("reconcileCommercialLifecycle", () => {
  it("activates a due scheduled arrangement and closes the superseded one", () => {
    const { repository } = createInMemoryRepository();
    repository.reconcileCommercialLifecycle(
      "cust_meridians",
      "2026-12-01T00:00:00.000Z"
    );
    const snapshot = repository.getCommercialSnapshot(
      "cust_meridians",
      "2026-12-01T00:00:00.000Z"
    );
    expect(snapshot.active?.id).toBe("arr_meridians_monthly_scheduled");
    const closed = repository
      .listCommercialArrangements("cust_meridians")
      .find((a) => a.id === "arr_meridians_prepaid");
    expect(closed?.status).toBe("ended");
    expect(closed?.effectiveTo).toBe("2026-12-01T00:00:00.000Z");
    expect(closed?.replacedByArrangementId).toBe(
      "arr_meridians_monthly_scheduled"
    );
  });

  it("is idempotent for a repeated asOf", () => {
    const { repository } = createInMemoryRepository();
    repository.reconcileCommercialLifecycle(
      "cust_meridians",
      "2026-12-01T00:00:00.000Z"
    );
    const eventsAfterFirst = repository.listActivityEvents(
      "cust_meridians"
    ).length;
    repository.reconcileCommercialLifecycle(
      "cust_meridians",
      "2026-12-01T00:00:00.000Z"
    );
    expect(repository.listActivityEvents("cust_meridians")).toHaveLength(
      eventsAfterFirst
    );
  });

  it("revokes active grants with a shared causationId when no arrangement is active", () => {
    const { repository } = createInMemoryRepository();
    // Remove the only active arrangement, then grant fresh access so a
    // still-active grant exists without any commercial coverage.
    repository.terminateCommercialArrangement(
      {
        arrangementId: "arr_sub_sablefin_sentinel_trial",
        customerId: "cust_sablefin",
        reason: "Trial ended.",
      },
      SEED_NOW
    );
    repository.grantAgentAccess(
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
    repository.reconcileCommercialLifecycle("cust_sablefin", SEED_NOW);

    const grants = repository.listAgentAccessGrants("cust_sablefin");
    expect(
      grants.some((g) => g.revokedAt === SEED_NOW && g.endsAt === null)
    ).toBe(true);
    const revocations = repository
      .listActivityEvents("cust_sablefin")
      .filter((e) => e.type === "access.revoked");
    expect(revocations).toHaveLength(1);
    expect(revocations[0].source).toBe("system");
    expect(revocations[0].causationId).toBe(
      "evt_arr_sub_sablefin_sentinel_trial_terminated"
    );
  });

  it("is a no-op for a customer with no due transitions and no active grants to revoke", () => {
    const { repository } = createInMemoryRepository();
    const eventsBefore = repository.listActivityEvents("cust_northwind").length;
    repository.reconcileCommercialLifecycle("cust_northwind", SEED_NOW);
    expect(repository.listActivityEvents("cust_northwind")).toHaveLength(
      eventsBefore
    );
  });
});

describe("revokeAgentAccess", () => {
  it("revokes agent access immediately", () => {
    const { repository } = createInMemoryRepository();
    const grant = repository.revokeAgentAccess(
      {
        grantId: "grant_lic_northwind_courier",
        customerId: "cust_northwind",
        reason: "Compliance review.",
      },
      SEED_NOW
    );
    expect(grant.revokedAt).toBe(SEED_NOW);
    expect(grant.scheduledRevokeAt).toBeNull();
    const snapshot = repository.getAgentAccessSnapshot(
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

  it("schedules a future agent access revocation", () => {
    const { repository } = createInMemoryRepository();
    const grant = repository.revokeAgentAccess(
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
    const snapshot = repository.getAgentAccessSnapshot(
      "cust_northwind",
      SEED_NOW
    );
    expect(
      snapshot.current.some((g) => g.id === "grant_lic_northwind_courier")
    ).toBe(true);
  });

  it("rejects revoking a missing grant", () => {
    const { repository } = createInMemoryRepository();
    expect(() =>
      repository.revokeAgentAccess(
        {
          grantId: "grant_missing",
          customerId: "cust_northwind",
          reason: "Cleanup.",
        },
        SEED_NOW
      )
    ).toThrow(/does not exist/);
  });

  it("rejects revoking an already revoked grant", () => {
    const { repository } = createInMemoryRepository();
    expect(() =>
      repository.revokeAgentAccess(
        {
          grantId: "grant_greyharbor_sentinel",
          customerId: "cust_greyharbor",
          reason: "Again.",
        },
        SEED_NOW
      )
    ).toThrow(/already revoked/);
  });
});

describe("migrateStore", () => {
  it("upgrades a legacy v1 payload to the canonical v2 shape", () => {
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

    expect(repository.getCustomer("cust_legacy")).toBeDefined();
    expect(repository.listCommercialArrangements("cust_legacy")).toHaveLength(1);
    expect(repository.listAgentAccessGrants("cust_legacy")).toHaveLength(1);
    expect(repository.listActivityEvents("cust_legacy").length).toBeGreaterThan(
      0
    );
  });
});