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

  it("rejects a second active commercial arrangement", () => {
    const { repository } = createInMemoryRepository();
    expect(() =>
      repository.saveCommercialArrangement(
        {
          id: "arr_duplicate",
          customerId: "cust_northwind",
          model: "monthly",
          status: "active",
          effectiveFrom: SEED_NOW,
          effectiveTo: null,
          createdAt: SEED_NOW,
          reason: "Duplicate.",
          currency: "USD",
          billingCadence: "monthly",
          monthlyAmountCents: 19900,
          renewsAt: "2027-01-01T00:00:00.000Z",
        },
        SEED_NOW
      )
    ).toThrow(/already has an active commercial arrangement/);
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