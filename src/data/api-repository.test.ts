import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  ApiRepository,
  UnsupportedOperationError,
} from "@/data/api-repository";
import type { OperatorIdentity } from "@/data/local-storage-repository";
import type {
  CommercialArrangement,
  Customer,
  LedgerTransaction,
  UsageRecord,
} from "@/domain/types";

const CUSTOMER_ID = "cust_acme";

/** A minimal seeded customer record for envelope payloads. */
const CUSTOMER: Customer = {
  id: CUSTOMER_ID,
  name: "Acme Corp",
  domain: "acme.example",
  contact: "Ada Lovelace",
  email: "ada@acme.example",
  status: "active",
  notes: "Test fixture",
  createdAt: "2026-01-01T00:00:00.000Z",
};

/** A minimal ledger transaction for envelope payloads. */
const TRANSACTION: LedgerTransaction = {
  id: "txn_001",
  customerId: CUSTOMER_ID,
  kind: "credit_grant",
  amountTokens: 5000,
  reference: "REF-001",
  occurredAt: "2026-01-02T00:00:00.000Z",
  reason: "Opening credit",
};

/** A minimal usage record paired with a usage_debit transaction. */
const USAGE: UsageRecord = {
  id: "usage_001",
  customerId: CUSTOMER_ID,
  agentProductId: "agent_writer",
  tokenQuantity: 1200,
  sourceReference: "run-42",
  occurredAt: "2026-01-03T00:00:00.000Z",
  ledgerTransactionId: "txn_002",
};

/** A minimal prepaid arrangement for envelope payloads. */
const ARRANGEMENT = {
  id: "arr_1",
  customerId: CUSTOMER_ID,
  model: "prepaid",
  status: "active",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  reason: "Initial",
  warningThresholdTokens: 100,
  expiresAt: "2026-12-31T00:00:00.000Z",
} as CommercialArrangement;

/** The operator identity returned by GET /api/me. */
const IDENTITY: OperatorIdentity = {
  email: "operator@hivarium.dev",
  sub: "0a1b2c3d",
  name: "Console Operator",
};

interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse(status, { error: { code, message } });
}

/**
 * Installs a fetch mock that replays `handler` and records every request
 * (resolved URL plus init) so tests can assert the exact method/URL/body
 * mapping for each `HiveRepository` method.
 */
function mockFetch(handler: (req: RecordedRequest) => Response) {
  const calls: RecordedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: RecordedRequest = { url, init };
      calls.push(call);
      return handler(call);
    })
  );
  return calls;
}

/** Extract the JSON body sent in a recorded request. */
function requestBody(call: RecordedRequest): Record<string, unknown> {
  return JSON.parse(call.init?.body as string) as Record<string, unknown>;
}

/** Extract the request method, defaulting to GET like fetch itself. */
function requestMethod(call: RecordedRequest): string {
  return (call.init?.method ?? "GET").toUpperCase();
}

describe("ApiRepository", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // -- request plumbing -----------------------------------------------------

  it("prepends a configured base URL and strips a trailing slash", async () => {
    const calls = mockFetch(() => jsonResponse(200, { customers: [] }));
    const repository = new ApiRepository("https://api.example.com/");
    await repository.listCustomers();
    expect(calls[0]!.url).toBe("https://api.example.com/api/customers");
  });

  it("defaults to the same origin when no base URL is configured", async () => {
    const calls = mockFetch(() => jsonResponse(200, { customers: [] }));
    const repository = new ApiRepository();
    await repository.listCustomers();
    expect(calls[0]!.url).toBe("/api/customers");
  });

  it("sends JSON content-type on every request", async () => {
    const calls = mockFetch(() => jsonResponse(200, { customers: [] }));
    const repository = new ApiRepository();
    await repository.listCustomers();
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
  });

  // -- identity (GET /api/me) ------------------------------------------------

  it("getCurrentOperator reads identity from the /api/me envelope", async () => {
    const calls = mockFetch(() => jsonResponse(200, { identity: IDENTITY }));
    const repository = new ApiRepository();
    const identity = await repository.getCurrentOperator();
    expect(requestMethod(calls[0]!)).toBe("GET");
    expect(calls[0]!.url).toBe("/api/me");
    expect(identity).toEqual(IDENTITY);
  });

  it("throws an ApiError with the envelope code when the operator is signed out (401)", async () => {
    mockFetch(() => errorResponse(401, "unauthorized", "Sign in through Cloudflare Access.")
    );
    const repository = new ApiRepository();
    await expect(repository.getCurrentOperator()).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "unauthorized",
      message: "Sign in through Cloudflare Access.",
    });
  });

  // -- error envelope mapping ------------------------------------------------

  it("maps a non-2xx error envelope to a descriptive ApiError", async () => {
    mockFetch(() => errorResponse(409, "usage_reference_conflict", "Source reference already used with a different fingerprint.")
    );
    const repository = new ApiRepository();
    await expect(
      repository.recordUsageDebit(
        {
          customerId: CUSTOMER_ID,
          agentProductId: "agent_writer",
          tokenQuantity: 10,
          sourceReference: "run-42",
        },
        "2026-01-03T00:00:00.000Z"
      )
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      code: "usage_reference_conflict",
      message: "Source reference already used with a different fingerprint.",
    });
  });

  it("falls back to the HTTP status text when the error body is not the envelope", async () => {
    mockFetch(() =>
      new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        statusText: "Bad Gateway",
      })
    );
    const repository = new ApiRepository();
    await expect(repository.listCustomers()).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
      code: "http-error",
      message: "Bad Gateway",
    });
  });

  it("uses a generic status message when the response has no status text", async () => {
    mockFetch(() => new Response("", { status: 500 }));
    const repository = new ApiRepository();
    const error = await repository.listCustomers().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("http-error");
    expect((error as ApiError).message).toBe("Request failed with status 500.");
  });

  // -- customers ---------------------------------------------------------------

  it("listCustomers reads the customers array from GET /api/customers", async () => {
    const calls = mockFetch(() =>
      jsonResponse(200, { customers: [CUSTOMER] })
    );
    const repository = new ApiRepository();
    const customers = await repository.listCustomers();
    expect(requestMethod(calls[0]!)).toBe("GET");
    expect(calls[0]!.url).toBe("/api/customers");
    expect(customers).toEqual([CUSTOMER]);
  });

  it("hasData is derived from the customer list length", async () => {
    const empty = new ApiRepository();
    mockFetch(() => jsonResponse(200, { customers: [] }));
    expect(await empty.hasData()).toBe(false);

    const populated = new ApiRepository();
    mockFetch(() => jsonResponse(200, { customers: [CUSTOMER] }));
    expect(await populated.hasData()).toBe(true);
  });

  it("getCustomer decodes the id segment and returns the envelope customer", async () => {
    const calls = mockFetch(() => jsonResponse(200, { customer: CUSTOMER }));
    const repository = new ApiRepository();
    const customer = await repository.getCustomer("cust/acme");
    expect(calls[0]!.url).toBe("/api/customers/cust%2Facme");
    expect(customer).toEqual(CUSTOMER);
  });

  it("getCustomer returns undefined for a 404 without throwing", async () => {
    mockFetch(() => errorResponse(404, "customer_not_found", "NotFound"));
    const repository = new ApiRepository();
    await expect(repository.getCustomer("cust_missing")).resolves.toBeUndefined();
  });

  it("getCustomer rethrows non-404 ApiErrors", async () => {
    mockFetch(() => errorResponse(500, "internal", "Boom"));
    const repository = new ApiRepository();
    await expect(repository.getCustomer(CUSTOMER_ID)).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
    });
  });

  it("createCustomer POSTs the input and returns the envelope customer", async () => {
    const calls = mockFetch(() => jsonResponse(200, { customer: CUSTOMER }));
    const repository = new ApiRepository();
    const input = { ...CUSTOMER, id: "cust_new" };
    const customer = await repository.createCustomer(input);
    expect(requestMethod(calls[0]!)).toBe("POST");
    expect(calls[0]!.url).toBe("/api/customers");
    expect(requestBody(calls[0]!)).toEqual(input);
    expect(customer).toEqual(CUSTOMER);
  });

  it("archiveCustomer POSTs an empty body to the archive subpath", async () => {
    const calls = mockFetch(() => new Response(null, { status: 204 }));
    const repository = new ApiRepository();
    await repository.archiveCustomer(CUSTOMER_ID);
    expect(requestMethod(calls[0]!)).toBe("POST");
    expect(calls[0]!.url).toBe(`/api/customers/${CUSTOMER_ID}/archive`);
    expect(requestBody(calls[0]!)).toEqual({});
  });

  it("archiveCustomer surfaces backend validation errors", async () => {

    mockFetch(() => errorResponse(404, "customer_not_found", "Unknown customer.")
    );
    const repository = new ApiRepository();
    await expect(repository.archiveCustomer("cust_missing")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      code: "customer_not_found",
    });
  });

  // -- catalog -----------------------------------------------------------------

  it("listAgentProducts reads the products array from GET /api/agents", async () => {
    const calls = mockFetch(() =>
      jsonResponse(200, { products: [{ id: "agent_writer" }] })
    );
    const repository = new ApiRepository();
    const products = await repository.listAgentProducts();
    expect(calls[0]!.url).toBe("/api/agents");
    expect(products).toEqual([{ id: "agent_writer" }]);
  });

  it("getAgentProduct returns undefined for a 404", async () => {
    mockFetch(() => errorResponse(404, "agent_not_found", "NotFound"));
    const repository = new ApiRepository();
    await expect(repository.getAgentProduct("agent_missing")).resolves.toBeUndefined();
  });

  // -- commercial arrangements ---------------------------------------------------

  it("getCommercialSnapshot reads the snapshot from GET /api/customers/:id/commercial", async () => {
    const snapshot = {
      customerId: CUSTOMER_ID,
      asOf: "2026-01-01T00:00:00.000Z",
      active: null,
      scheduled: null,
      history: [],
    };
    const calls = mockFetch(() => jsonResponse(200, snapshot));
    const repository = new ApiRepository();
    const result = await repository.getCommercialSnapshot(CUSTOMER_ID, Date.now());
    expect(requestMethod(calls[0]!)).toBe("GET");
    expect(calls[0]!.url).toBe(`/api/customers/${CUSTOMER_ID}/commercial`);
    expect(result).toEqual(snapshot);
  });

  it("listCommercialArrangements derives history from the live snapshot", async () => {
    const arrangement = { id: "arr_1", customerId: CUSTOMER_ID } as CommercialArrangement;
    const snapshot = {
      customerId: CUSTOMER_ID,
      asOf: "2026-01-01T00:00:00.000Z",
      active: arrangement,
      scheduled: null,
      history: [arrangement],
    };
    const calls = mockFetch(() => jsonResponse(200, snapshot));
    const repository = new ApiRepository();
    const history = await repository.listCommercialArrangements(CUSTOMER_ID);
    expect(calls[0]!.url).toBe(`/api/customers/${CUSTOMER_ID}/commercial`);
    expect(history).toEqual([arrangement]);
  });

  it("saveCommercialArrangement POSTs the validated input plus occurredAt", async () => {
    const calls = mockFetch(() => jsonResponse(200, { arrangement: ARRANGEMENT }));
    const repository = new ApiRepository();
    const input = { model: "prepaid", customerId: CUSTOMER_ID } as never;
    const result = await repository.saveCommercialArrangement(
      input,
      "2026-01-05T00:00:00.000Z"
    );
    expect(requestMethod(calls[0]!)).toBe("POST");
    expect(calls[0]!.url).toBe(`/api/customers/${CUSTOMER_ID}/commercial`);
    expect(requestBody(calls[0]!)).toEqual({
      model: "prepaid",
      customerId: CUSTOMER_ID,
      occurredAt: "2026-01-05T00:00:00.000Z",
    });
    expect(result).toEqual(ARRANGEMENT);
  });

  it("terminateCommercialArrangement POSTs reason plus occurredAt to the terminate subpath", async () => {
    const calls = mockFetch(() =>
      jsonResponse(200, { arrangement: ARRANGEMENT })
    );
    const repository = new ApiRepository();
    const result = await repository.terminateCommercialArrangement(
      { arrangementId: "arr_1", customerId: CUSTOMER_ID, reason: "Churned" },
      "2026-02-01T00:00:00.000Z"
    );
    expect(requestMethod(calls[0]!)).toBe("POST");
    expect(calls[0]!.url).toBe(
      `/api/customers/${CUSTOMER_ID}/commercial/arr_1/terminate`
    );
    expect(requestBody(calls[0]!)).toEqual({
      reason: "Churned",
      occurredAt: "2026-02-01T00:00:00.000Z",
    });
    expect(result).toEqual(ARRANGEMENT);
  });

  // -- agent access grants -------------------------------------------------------

  it("getAgentAccessSnapshot reads the snapshot from GET /api/customers/:id/access", async () => {
    const snapshot = {
      customerId: CUSTOMER_ID,
      asOf: "2026-01-01T00:00:00.000Z",
      current: [],
      scheduled: [],
      history: [],
    };
    const calls = mockFetch(() => jsonResponse(200, snapshot));
    const repository = new ApiRepository();
    const result = await repository.getAgentAccessSnapshot(CUSTOMER_ID, Date.now());
    expect(calls[0]!.url).toBe(`/api/customers/${CUSTOMER_ID}/access`);
    expect(result).toEqual(snapshot);
  });

  it("listAgentAccessGrants flattens current, scheduled, and history in order", async () => {
    const current = [{ id: "g_cur", status: "active" } as never];
    const scheduled = [{ id: "g_sch", status: "scheduled" } as never];
    const history = [{ id: "g_old", status: "revoked" } as never];

    const calls = mockFetch(() => jsonResponse(200, {
      customerId: CUSTOMER_ID,
      asOf: "2026-01-01T00:00:00.000Z",
      current,
      scheduled,
      history,
    })
    );
    const repository = new ApiRepository();
    const grants = await repository.listAgentAccessGrants(CUSTOMER_ID);
    expect(grants).toEqual([...current, ...scheduled, ...history]);
  });

  it("grantAgentAccess POSTs the validated input plus occurredAt", async () => {
    const grant = { id: "g_1", customerId: CUSTOMER_ID, status: "active" } as never;
    const calls = mockFetch(() => jsonResponse(200, { grant }));
    const repository = new ApiRepository();
    const input = {
      customerId: CUSTOMER_ID,
      agentProductId: "agent_writer",
      startsAt: "2026-01-01T00:00:00.000Z",
    } as never;
    const result = await repository.grantAgentAccess(
      input,
      "2026-01-01T06:00:00.000Z"
    );
    expect(requestMethod(calls[0]!)).toBe("POST");
    expect(calls[0]!.url).toBe(`/api/customers/${CUSTOMER_ID}/access`);
    expect(requestBody(calls[0]!)).toEqual({
      customerId: CUSTOMER_ID,
      agentProductId: "agent_writer",
      startsAt: "2026-01-01T00:00:00.000Z",
      occurredAt: "2026-01-01T06:00:00.000Z",
    });
    expect(result).toEqual(grant);
  });

  it("revokeAgentAccess POSTs reason, effectiveAt, and occurredAt to the revoke subpath", async () => {
    const grant = { id: "g_1", customerId: CUSTOMER_ID, status: "revoked" } as never;
    const calls = mockFetch(() => jsonResponse(200, { grant }));
    const repository = new ApiRepository();
    const result = await repository.revokeAgentAccess(
      {
        grantId: "g_1",
        customerId: CUSTOMER_ID,
        reason: "Downgrade",
        effectiveAt: "2026-03-01T00:00:00.000Z",
      },
      "2026-01-10T00:00:00.000Z"
    );
    expect(requestMethod(calls[0]!)).toBe("POST");
    expect(calls[0]!.url).toBe(
      `/api/customers/${CUSTOMER_ID}/access/g_1/revoke`
    );
    expect(requestBody(calls[0]!)).toEqual({
      reason: "Downgrade",
      effectiveAt: "2026-03-01T00:00:00.000Z",
      occurredAt: "2026-01-10T00:00:00.000Z",
    });
    expect(result).toEqual(grant);
  });

  // -- prepaid token ledger ------------------------------------------------------

  it("addCreditGrant POSTs the credit payload and returns the envelope transaction", async () => {
    const calls = mockFetch(() => jsonResponse(200, { transaction: TRANSACTION }));
    const repository = new ApiRepository();
    const result = await repository.addCreditGrant(
      {
        customerId: CUSTOMER_ID,
        amountTokens: 5000,
        reference: "REF-001",
        reason: "Opening credit",
      },
      "2026-01-02T00:00:00.000Z"
    );
    expect(requestMethod(calls[0]!)).toBe("POST");
    expect(calls[0]!.url).toBe(`/api/customers/${CUSTOMER_ID}/ledger/credit`);
    expect(requestBody(calls[0]!)).toEqual({
      amountTokens: 5000,
      reference: "REF-001",
      reason: "Opening credit",
      occurredAt: "2026-01-02T00:00:00.000Z",
    });
    expect(result).toEqual(TRANSACTION);
  });

  it("recordUsageDebit POSTs the usage payload and returns the usage/transaction pair", async () => {
    const debit: LedgerTransaction = { ...TRANSACTION, id: "txn_002", kind: "usage_debit", amountTokens: -1200, agentProductId: "agent_writer", usageRecordId: "usage_001" };
    const calls = mockFetch(() =>
      jsonResponse(200, { usage: USAGE, transaction: debit })
    );
    const repository = new ApiRepository();
    const result = await repository.recordUsageDebit(
      {
        customerId: CUSTOMER_ID,
        agentProductId: "agent_writer",
        tokenQuantity: 1200,
        sourceReference: "run-42",
      },
      "2026-01-03T00:00:00.000Z"
    );
    expect(requestMethod(calls[0]!)).toBe("POST");
    expect(calls[0]!.url).toBe(`/api/customers/${CUSTOMER_ID}/ledger/usage`);
    expect(requestBody(calls[0]!)).toEqual({
      agentProductId: "agent_writer",
      tokenQuantity: 1200,
      sourceReference: "run-42",
      reason: undefined,
      occurredAt: "2026-01-03T00:00:00.000Z",
    });
    expect(result).toEqual({ usage: USAGE, transaction: debit });
  });

  it("addManualAdjustment POSTs the adjustment payload", async () => {
    const calls = mockFetch(() => jsonResponse(200, { transaction: TRANSACTION }));
    const repository = new ApiRepository();
    await repository.addManualAdjustment(
      {
        customerId: CUSTOMER_ID,
        amountTokens: -250,
        reference: "REF-002",
        reason: "Billing correction",
      },
      "2026-01-04T00:00:00.000Z"
    );
    expect(requestMethod(calls[0]!)).toBe("POST");
    expect(calls[0]!.url).toBe(`/api/customers/${CUSTOMER_ID}/ledger/adjustment`);
    expect(requestBody(calls[0]!)).toEqual({
      amountTokens: -250,
      reference: "REF-002",
      reason: "Billing correction",
      occurredAt: "2026-01-04T00:00:00.000Z",
    });
  });

  it("reverseTransaction POSTs the reversal payload", async () => {
    const calls = mockFetch(() => jsonResponse(200, { transaction: TRANSACTION }));
    const repository = new ApiRepository();
    await repository.reverseTransaction(
      {
        customerId: CUSTOMER_ID,
        transactionId: "txn_001",
        reference: "REV-001",
        reason: "Duplicate entry",
      },
      "2026-01-06T00:00:00.000Z"
    );
    expect(requestMethod(calls[0]!)).toBe("POST");
    expect(calls[0]!.url).toBe(`/api/customers/${CUSTOMER_ID}/ledger/reversal`);
    expect(requestBody(calls[0]!)).toEqual({
      transactionId: "txn_001",
      reference: "REV-001",
      reason: "Duplicate entry",
      occurredAt: "2026-01-06T00:00:00.000Z",
    });
  });

  it("updateWarningThreshold sends a PUT with the threshold value", async () => {
    const arrangement = { id: "arr_prepaid", model: "prepaid" } as never;
    const calls = mockFetch(() =>
      jsonResponse(200, { arrangement })
    );
    const repository = new ApiRepository();
    const result = await repository.updateWarningThreshold(CUSTOMER_ID, 15);
    expect(requestMethod(calls[0]!)).toBe("PUT");
    expect(calls[0]!.url).toBe(`/api/customers/${CUSTOMER_ID}/ledger/threshold`);
    expect(requestBody(calls[0]!)).toEqual({ thresholdTokens: 15 });
    expect(result).toEqual(arrangement);
  });

  it("getAccountStatement reads the statement rows from GET /api/customers/:id/ledger", async () => {
    const rows = [{ id: "txn_001" }] as never[];
    const calls = mockFetch(() => jsonResponse(200, { rows }));
    const repository = new ApiRepository();
    const result = await repository.getAccountStatement(CUSTOMER_ID);
    expect(requestMethod(calls[0]!)).toBe("GET");
    expect(calls[0]!.url).toBe(`/api/customers/${CUSTOMER_ID}/ledger`);
    expect(result).toEqual(rows);
  });

  it("getUsageSummary appends all four query parameters when supplied", async () => {
    const calls = mockFetch(() => jsonResponse(200, { rows: [], netTokensConsumed: 0, perAgent: [] }));
    const repository = new ApiRepository();
    await repository.getUsageSummary(
      CUSTOMER_ID,
      { from: "2026-01-01", to: "2026-01-31" },
      "agent_writer",
      "usage_debit"
    );
    const url = new URL(calls[0]!.url, "http://localhost");
    expect(url.pathname).toBe(`/api/customers/${CUSTOMER_ID}/usage-summary`);
    expect(url.searchParams.get("from")).toBe("2026-01-01");
    expect(url.searchParams.get("to")).toBe("2026-01-31");
    expect(url.searchParams.get("agentProductId")).toBe("agent_writer");
    expect(url.searchParams.get("type")).toBe("usage_debit");
  });

  it("getUsageSummary sends a bare path when no filters are supplied", async () => {
    const calls = mockFetch(() => jsonResponse(200, { rows: [], netTokensConsumed: 0, perAgent: [] }));
    const repository = new ApiRepository();
    await repository.getUsageSummary(CUSTOMER_ID, {});
    expect(calls[0]!.url).toBe(`/api/customers/${CUSTOMER_ID}/usage-summary`);
  });

  it("listCustomersWithAgentAccess hits /api/agents/:id/customers exactly once", async () => {
    const AS_OF = "2026-09-01T00:00:00.000Z";
    const calls = mockFetch(() => jsonResponse(200, { rows: [] }));
    const repository = new ApiRepository();
    const result = await repository.listCustomersWithAgentAccess("agent_writer", AS_OF);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`/api/agents/agent_writer/customers?asOf=${encodeURIComponent(AS_OF)}`);
    expect(result).toEqual([]);
  });

  // -- unsupported operations ------------------------------------------------------

  it.each([
    ["reset", async (r: ApiRepository) => r.reset()],
    ["getSubscriptions", async (r: ApiRepository) => r.getSubscriptions(CUSTOMER_ID)],
    ["getAgentLicenses", async (r: ApiRepository) => r.getAgentLicenses(CUSTOMER_ID)],
    ["reconcileCommercialLifecycle", async (r: ApiRepository) => r.reconcileCommercialLifecycle(CUSTOMER_ID, "2026-09-01T00:00:00.000Z")],
  ])("%s throws UnsupportedOperationError without touching fetch", async (_name, invoke) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const repository = new ApiRepository();
    await expect(invoke(repository)).rejects.toMatchObject({
      name: "UnsupportedOperationError",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // -- async contract -----------------------------------------------------------------

  it("every read method returns a Promise", async () => {
    // Every fetch call resolves with an empty JSON object, so unsupported
    // methods reject locally and endpoint-backed reads resolve with `undefined`
    // fields (the adapter only accesses the documented envelope shape it
    // expects, which is exercised by the dedicated mapping tests above).
    const fetchSpy = vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, {}))
    );
    const repository = new ApiRepository();
    const results: Promise<unknown>[] = [
      repository.hasData(),
      repository.getCurrentOperator(),
      repository.listCustomers(),
      repository.getCustomer(CUSTOMER_ID),
      repository.reset(),
      repository.listAgentProducts(),
      repository.getAgentProduct("agent_writer"),
      repository.listCommercialArrangements(CUSTOMER_ID),
      repository.getCommercialSnapshot(CUSTOMER_ID, Date.now()),
      repository.listAgentAccessGrants(CUSTOMER_ID),
      repository.getAgentAccessSnapshot(CUSTOMER_ID, Date.now()),
      repository.listLedgerTransactions(CUSTOMER_ID),
      repository.getAccountStatement(CUSTOMER_ID),
      repository.getUsageSummary(CUSTOMER_ID, {}),
    ];
    for (const result of results) {
      expect(result).toBeInstanceOf(Promise);
    }
    // Settle every produced Promise so no assertion is left pending.
    await Promise.allSettled(results);
  });

  it("resolves reads that reject fetch with a network-like error as rejections, not undefined", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    const repository = new ApiRepository();
    await expect(repository.listCustomers()).rejects.toThrow("Failed to fetch");
    // getCustomer only swallows 404 ApiErrors; network errors propagate.
    await expect(repository.getCustomer(CUSTOMER_ID)).rejects.toThrow("Failed to fetch");
  });
});
