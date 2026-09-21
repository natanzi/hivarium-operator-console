import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DataStore, PrepaidCommercialArrangement, LedgerTransaction } from "../../src/domain/types";
import { OperatorIdentity } from "./auth";

const mockAdapter = {
    listLicenses: vi.fn(),
    suspendLicense: vi.fn(),
    resumeLicense: vi.fn()
};

vi.mock("./api-extensions", async (importOriginal) => {
    const mod = await importOriginal<any>();
    return {
        ...mod,
        licenseAdapter: () => mockAdapter,
    };
});

// Mock database writing for commitStoreDiff to avoid actual DB calls
vi.mock("./db", async (importOriginal) => {
    const mod = await importOriginal<any>();
    return {
        ...mod,
        commitStoreDiff: vi.fn(),
    };
});

import { checkLedgerAutoSuspend } from "./app";

describe("checkLedgerAutoSuspend", () => {
    let mockEnv: any;
    let mockDB: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockDB = {
            prepare: vi.fn().mockReturnThis(),
            bind: vi.fn().mockReturnThis(),
            run: vi.fn(),
            first: vi.fn(),
            batch: vi.fn()
        };
        mockEnv = {
            DB: mockDB as any,
        };
    });

    it("suspends active licenses when balance crosses to zero", async () => {
        const store: DataStore = {
            schemaVersion: 4,
            customers: [],
            featureEntitlements: [],
            agentProducts: [],
            commercialArrangements: [{
                id: "ca-1", customerId: "cust_1", status: "active", model: "prepaid", creditTokens: 0, warningThresholdTokens: 0, occurredAt: ""
            } as PrepaidCommercialArrangement],
            agentAccessGrants: [],
            activityEvents: [],
            ledgerTransactions: [
                { amountTokens: 100, customerId: "cust_1", kind: "credit_grant", occurredAt: "2026-01-01", id: "t1", reason: "", reference: "" } as LedgerTransaction,
                { amountTokens: -100, customerId: "cust_1", kind: "usage_debit", occurredAt: "2026-01-02", id: "t2", reason: "", reference: "", agentProductId: "p1", usageRecordId: "u1" } as LedgerTransaction
            ],
            usageRecords: []
        };

        mockAdapter.listLicenses.mockResolvedValue([{ id: "lic-1", status: "active" }]);
        mockDB.run.mockResolvedValue(undefined);

        await checkLedgerAutoSuspend(mockEnv, "cust_1", { subject: "operator", email: "" }, store);

        expect(mockAdapter.suspendLicense).toHaveBeenCalledWith("lic-1", expect.objectContaining({ reason: "prepaid_balance_zero" }));
        expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT OR REPLACE"));
        expect(mockDB.bind).toHaveBeenCalledWith("lic-1", "prepaid_balance_zero", expect.any(String));
    });

    it("resumes suspended licenses only if auto-suspended marker exists", async () => {
        const store: DataStore = {
            schemaVersion: 4,
            customers: [],
            featureEntitlements: [],
            agentProducts: [],
            commercialArrangements: [{
                id: "ca-1", customerId: "cust_1", status: "active", model: "prepaid", creditTokens: 0, warningThresholdTokens: 0, occurredAt: ""
            } as PrepaidCommercialArrangement],
            agentAccessGrants: [],
            activityEvents: [],
            ledgerTransactions: [
                { amountTokens: 100, customerId: "cust_1", kind: "credit_grant", occurredAt: "2026-01-01", id: "t1", reason: "", reference: "" } as LedgerTransaction
            ],
            usageRecords: []
        };

        mockAdapter.listLicenses.mockResolvedValue([{ id: "lic-1", status: "suspended" }, { id: "lic-2", status: "suspended" }]);
        mockDB.first.mockImplementationOnce(() => Promise.resolve({ reason: "prepaid_balance_zero" })) // lic-1 has marker
            .mockImplementationOnce(() => Promise.resolve(null)); // lic-2 manually suspended

        await checkLedgerAutoSuspend(mockEnv, "cust_1", { subject: "operator", email: "" }, store);

        expect(mockAdapter.resumeLicense).toHaveBeenCalledWith("lic-1", expect.objectContaining({ reason: "prepaid_balance_restored" }));
        expect(mockAdapter.resumeLicense).not.toHaveBeenCalledWith("lic-2", expect.anything());
        expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM"));
        expect(mockDB.bind).toHaveBeenCalledWith("lic-1");
    });
});
