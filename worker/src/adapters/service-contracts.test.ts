import { describe, expect, it, vi } from "vitest";
import { LicenseAdapter } from "./license";
import { PortalAdapter } from "./portal";
import { ApiError } from "../app";

function fetcherFor(handler: (url: string, init?: RequestInit) => Promise<Response>): Fetcher {
  return { fetch: (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init) } as Fetcher;
}

describe("LicenseAdapter contract", () => {
  it("lists licenses on /internal/v1/licenses and maps the { data } envelope", async () => {
    const calls: string[] = [];
    const adapter = new LicenseAdapter(
      fetcherFor(async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer operator-license-token");
        return new Response(JSON.stringify({
          data: [{ license_id: "lic_1", customer_id: "cust_a", product: "hivarium-core", status: "active", current_revision: 1 }],
          meta: { correlationId: "c1" },
        }));
      }),
      "operator-license-token"
    );
    const licenses = await adapter.listLicenses("cust_a");
    expect(calls[0]).toContain("/internal/v1/licenses?customerId=cust_a");
    expect(licenses).toEqual([expect.objectContaining({ id: "lic_1", productId: "hivarium-core", revision: 1 })]);
  });

  it("does not call the unversioned /v1/licenses public path", async () => {
    const adapter = new LicenseAdapter(
      fetcherFor(async (url) => {
        const path = new URL(url).pathname;
        expect(path.startsWith("/internal/v1/licenses")).toBe(true);
        expect(path.startsWith("/v1/licenses")).toBe(false);
        return new Response(JSON.stringify({ data: [] }));
      }),
      "operator-license-token"
    );
    await adapter.listLicenses("cust_a");
  });

  it("renews with successorId and claim on /internal/v1/licenses/:id/renew", async () => {
    const bodies: string[] = [];
    const adapter = new LicenseAdapter(
      fetcherFor(async (url, init) => {
        if (url.endsWith("/lic_old") && (!init?.method || init.method === "GET")) {
          return new Response(JSON.stringify({
            data: {
              record: { license_id: "lic_old", customer_id: "cust_a", product: "hivarium-core", status: "active", current_revision: 1 },
              revision: {
                payloadJson: JSON.stringify({
                  schemaVersion: 1,
                  licenseId: "lic_old",
                  customerId: "cust_a",
                  product: "hivarium-core",
                  revisionNumber: 1,
                  features: {},
                  limits: { maxSeats: 10, maxOrganizations: null, maxApiTokens: null, maxMonthlyOperations: null, maxStorageMb: null },
                  deploymentModes: ["self-hosted"],
                  billingModel: "subscription",
                  validity: { notBefore: "2026-01-01T00:00:00.000Z", expiresAt: "2026-12-31T00:00:00.000Z" },
                  activationPolicy: { maxActivations: null, activationTtlSeconds: null, allowRotation: false, allowedDeploymentModes: ["self-hosted"] },
                })
              },
            },
          }));
        }
        bodies.push(String(init?.body));
        expect(url).toContain("/internal/v1/licenses/lic_old/renew");
        expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("renew-key-1");
        return new Response(JSON.stringify({
          data: {
            record: { license_id: "lic_new", customer_id: "cust_a", product: "hivarium-core", status: "active", current_revision: 2 },
          },
        }));
      }),
      "operator-license-token"
    );
    const renewed = await adapter.renewLicense("lic_old", {
      idempotencyKey: "renew-key-1",
      validUntil: "2027-12-31T00:00:00.000Z",
      successorId: "lic_new",
      billingModel: "subscription",
    });
    expect(renewed.id).toBe("lic_new");
    const payload = JSON.parse(bodies[0]) as { successorId: string; claim: { licenseId: string; revisionNumber: number } };
    expect(payload.successorId).toBe("lic_new");
    expect(payload.claim.licenseId).toBe("lic_new");
    expect(payload.claim.revisionNumber).toBe(2);
  });

  it("resumes with reason on /internal/v1/licenses/:id/resume", async () => {
    let body = "";
    const adapter = new LicenseAdapter(
      fetcherFor(async (url, init) => {
        expect(url).toContain("/internal/v1/licenses/lic_sus/resume");
        expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("resume-key-1");
        body = String(init?.body);
        return new Response(JSON.stringify({
          data: {
            record: { license_id: "lic_sus", customer_id: "cust_a", product: "hivarium-core", status: "active", current_revision: 2 },
          },
        }));
      }),
      "operator-license-token"
    );
    const resumed = await adapter.resumeLicense("lic_sus", { idempotencyKey: "resume-key-1", reason: "All good" });
    expect(resumed.id).toBe("lic_sus");
    expect(JSON.parse(body)).toEqual({ reason: "All good" });
  });

  it("replaces with successorId and claim on /internal/v1/licenses/:id/replace", async () => {
    const bodies: string[] = [];
    const adapter = new LicenseAdapter(
      fetcherFor(async (url, init) => {
        if (url.endsWith("/lic_old") && (!init?.method || init.method === "GET")) {
          return new Response(JSON.stringify({
            data: {
              record: { license_id: "lic_old", customer_id: "cust_a", product: "hivarium-core", status: "active", current_revision: 1 },
              revision: {
                payloadJson: JSON.stringify({
                  schemaVersion: 1,
                  licenseId: "lic_old",
                  customerId: "cust_a",
                  product: "hivarium-core",
                  revisionNumber: 1,
                  features: {},
                  limits: { maxSeats: 10, maxOrganizations: null, maxApiTokens: null, maxMonthlyOperations: null, maxStorageMb: null },
                  deploymentModes: ["self-hosted"],
                  billingModel: "subscription",
                  validity: { notBefore: "2026-01-01T00:00:00.000Z", expiresAt: "2026-12-31T00:00:00.000Z" },
                  activationPolicy: { maxActivations: null, activationTtlSeconds: null, allowRotation: false, allowedDeploymentModes: ["self-hosted"] },
                })
              },
            },
          }));
        }
        bodies.push(String(init?.body));
        expect(url).toContain("/internal/v1/licenses/lic_old/replace");
        expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("replace-key-1");
        return new Response(JSON.stringify({
          data: {
            record: { license_id: "lic_new2", customer_id: "cust_a", product: "hivarium-core", status: "active", current_revision: 2 },
          },
        }));
      }),
      "operator-license-token"
    );
    const replaced = await adapter.replaceLicense("lic_old", {
      idempotencyKey: "replace-key-1",
      successorId: "lic_new2",
      entitlementLimits: { maxSeats: 20 },
      deploymentType: "managed",
      billingModel: "subscription",
    });
    expect(replaced.id).toBe("lic_new2");
    const payload = JSON.parse(bodies[0]) as { successorId: string; claim: any };
    expect(payload.successorId).toBe("lic_new2");
    expect(payload.claim.licenseId).toBe("lic_new2");
    expect(payload.claim.revisionNumber).toBe(2);
    expect(payload.claim.limits.maxSeats).toBe(20);
    expect(payload.claim.deploymentModes).toEqual(["managed"]);
  });


  it("returns 409 when an issued license is replayed with a conflicting validity window", async () => {
    const adapter = new LicenseAdapter(
      fetcherFor(async (url) => {
        if (String(url).includes("/internal/v1/licenses/lic_issuecore1") && !String(url).endsWith("/issue")) {
          return new Response(JSON.stringify({
            data: {
              record: { license_id: "lic_issuecore1", customer_id: "cust_a", product: "hivarium-core", status: "active", current_revision: 1 },
              revision: { payloadJson: JSON.stringify({ validity: { notBefore: "2026-01-01T00:00:00.000Z", expiresAt: "2027-09-14T00:00:00.000Z" } }) },
            },
          }));
        }
        return new Response("unexpected", { status: 500 });
      }),
      "operator-license-token"
    );
    await expect(adapter.issueLicense({
      customerId: "cust_a",
      productId: "hivarium-core",
      idempotencyKey: "issuecore1",
      validUntil: "2028-01-01T00:00:00.000Z",
      billingModel: "subscription",
    })).rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
  });

  it("returns 409 on conflicting idempotency replay", async () => {
    const adapter = new LicenseAdapter(
      fetcherFor(async () => new Response("conflict", { status: 409 })),
      "operator-license-token"
    );
    await expect(adapter.suspendLicense("lic_1", { idempotencyKey: "same", reason: "x" })).rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
  });

  it("fails closed without a token", async () => {
    const adapter = new LicenseAdapter(fetcherFor(async () => new Response("{}")), "");
    await expect(adapter.listLicenses("cust_a")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("PortalAdapter contract", () => {
  it("lists /service/v1/requests and maps external enum names", async () => {
    const urls: string[] = [];
    const adapter = new PortalAdapter(
      fetcherFor(async (url, init) => {
        urls.push(url);
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer portal-outbound");
        return new Response(JSON.stringify({
          apiVersion: "1",
          items: [{
            requestId: "req-1",
            customerId: "cust_a",
            requestType: "license_renewal",
            status: "submitted",
            summary: "Renew please",
            createdAt: "2026-09-01T00:00:00.000Z",
          }],
          nextCursor: null,
        }));
      }),
      "portal-outbound"
    );
    const requests = await adapter.listRequests("cust_a");
    expect(urls[0]).toContain("/service/v1/requests?customerId=cust_a");
    expect(new URL(urls[0]).pathname).toBe("/service/v1/requests");
    expect(requests[0]).toMatchObject({ id: "req-1", type: "license_renewal", status: "submitted" });
  });

  it("posts decision with canonical body fields", async () => {
    let body = "";
    const adapter = new PortalAdapter(
      fetcherFor(async (url, init) => {
        expect(url).toContain("/service/v1/requests/req-1/decision");
        body = String(init?.body);
        return new Response(JSON.stringify({
          apiVersion: "1",
          request: {
            requestId: "req-1",
            customerId: "cust_a",
            requestType: "license_renewal",
            status: "completed",
            summary: "Renew please",
            createdAt: "2026-09-01T00:00:00.000Z",
            events: [{ occurredAt: "2026-09-02T00:00:00.000Z", resultingStatus: "completed", principalIdentifier: "operator", customerVisibleMessage: "Done", operatorNote: "internal", externalReference: "lic_new" }],
          },
          replayed: false,
        }));
      }),
      "portal-outbound"
    );
    const updated = await adapter.recordDecision("req-1", {
      decision: "completed",
      operatorNote: "internal",
      customerVisibleMessage: "Done",
      externalReference: "lic_new",
      idempotencyKey: "decision:req-1:completed",
    });
    expect(JSON.parse(body)).toEqual({
      decision: "completed",
      operatorNote: "internal",
      customerVisibleMessage: "Done",
      externalReference: "lic_new",
      idempotencyKey: "decision:req-1:completed",
    });
    expect(updated.status).toBe("completed");
    expect(updated.externalReference).toBe("lic_new");
  });
});

describe("wrong-path regression", () => {
  it("LicenseAdapter never uses public /v1/licenses mutation paths", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ data: [] })));
    const adapter = new LicenseAdapter({ fetch: spy } as Fetcher, "t");
    await adapter.listLicenses("c");
    expect(String((spy.mock.calls[0] as any)[0])).toMatch(/\/internal\/v1\/licenses/);
  });
});

import { handleLicensesApi } from "../api-extensions";
import * as appDb from "../db";

describe("api-extensions route regression", () => {
  it("allows suspend for a customer with NO active commercial arrangement", async () => {
    const mockEnv: any = {
      DB: {} as any,
      LICENSE_SERVICE: fetcherFor(async () => new Response(JSON.stringify({ data: { row: { current_revision: 1 }, claim: {} } }))),
      LICENSE_SERVICE_TOKEN: "token",
    };

    const listSpy = vi.spyOn(appDb, "listCommercialArrangements").mockResolvedValue([]);
    vi.spyOn(appDb, "loadCustomerStore").mockResolvedValue({
      schemaVersion: 4, customers: [], featureEntitlements: [], agentProducts: [],
      commercialArrangements: [], agentAccessGrants: [], activityEvents: [],
      ledgerTransactions: [], usageRecords: []
    } as any);
    vi.spyOn(appDb, "commitStoreDiff").mockResolvedValue(undefined);

    const req = new Request("https://test/api/customers/cust_a/licenses/lic_a/suspend", {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: "idx", reason: "test" })
    });

    // Should NOT throw ApiError "no active commercial arrangement"
    const res = await handleLicensesApi(
      req,
      mockEnv,
      ["api", "customers", "cust_a", "licenses", "lic_a", "suspend"],
      { sub: "op", email: "op@test.com" } as any
    );

    expect(listSpy).not.toHaveBeenCalled(); // The lookup should not have been reached for 'suspend'
    expect(res.status).toBe(200);
  });
});
