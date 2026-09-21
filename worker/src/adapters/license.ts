import { ApiError } from "../app";

export interface LicenseDocument {
    id: string;
    customerId: string;
    productId: string;
    revision: number;
    status: "active" | "suspended" | "revoked" | "expired" | "draft" | "superseded";
    deploymentType: string;
    validFrom: string;
    validUntil: string | null;
    entitlementLimits: Record<string, number>;
}

interface LicenseRecordRow {
    license_id: string;
    customer_id: string;
    product: string;
    status: string;
    current_revision: number;
}

interface LicenseEnvelope {
    data?: unknown;
    error?: { code?: string; message?: string };
}

function stableLicenseId(prefix: string, key: string): string {
    const safe = key.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
    return `${prefix}${safe}`;
}

export class LicenseAdapter {
    constructor(
        private readonly fetcher: Fetcher | undefined,
        private readonly token: string,
        private readonly urlOverride?: string
    ) { }

    private origin(): string {
        if (this.urlOverride) return this.urlOverride.replace(/\/$/, "");
        return "http://license-service.internal";
    }

    private async fetchRaw(path: string, init?: RequestInit): Promise<Response> {
        if (!this.token) {
            throw new ApiError(503, "service_unavailable", "LICENSE_SERVICE_TOKEN is not configured.");
        }
        if (!this.fetcher && !this.urlOverride) {
            throw new ApiError(503, "service_unavailable", "License Service binding is not configured.");
        }
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${this.token}`);
        if (!headers.has("Content-Type") && init?.body) {
            headers.set("Content-Type", "application/json");
        }
        const requestUrl = `${this.origin()}${path}`;
        try {
            return this.urlOverride
                ? await fetch(requestUrl, { ...init, headers })
                : await this.fetcher!.fetch(requestUrl, { ...init, headers });
        } catch {
            throw new ApiError(502, "bad_gateway", "License Service network error");
        }
    }

    private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
        const response = await this.fetchRaw(path, init);
        const text = await response.text();
        if (response.status === 409) {
            throw new ApiError(409, "idempotency_conflict", text.slice(0, 200) || "Idempotency conflict");
        }
        if (!response.ok) {
            throw new ApiError(
                response.status === 404 ? 404 : 502,
                response.status === 404 ? "not-found" : "bad_gateway",
                `License Service error (${response.status}): ${text.substring(0, 100)}`
            );
        }
        if (response.status === 204 || text.length === 0) {
            return {} as T;
        }
        let json: unknown;
        try {
            json = JSON.parse(text);
        } catch {
            throw new ApiError(502, "bad_gateway", "Invalid JSON from License Service");
        }
        if (!json || typeof json !== "object") {
            throw new ApiError(502, "bad_gateway", "Invalid JSON from License Service");
        }
        return json as T;
    }

    private mapRow(row: LicenseRecordRow, claim?: Record<string, unknown> | null): LicenseDocument {
        const validity = (claim?.validity as { notBefore?: string; expiresAt?: string | null } | undefined) ?? {};
        const limits = (claim?.limits as Record<string, number | null> | undefined) ?? {};
        const entitlementLimits: Record<string, number> = {};
        for (const [key, value] of Object.entries(limits)) {
            if (typeof value === "number") entitlementLimits[key] = value;
        }
        const modes = claim?.deploymentModes as string[] | undefined;
        const status = row.status as LicenseDocument["status"];
        return {
            id: row.license_id,
            customerId: row.customer_id,
            productId: row.product,
            revision: row.current_revision,
            status,
            deploymentType: modes?.[0] ?? "self-hosted",
            validFrom: validity.notBefore ?? "",
            validUntil: validity.expiresAt ?? null,
            entitlementLimits,
        };
    }

    private unwrapRecord(data: unknown): { row: LicenseRecordRow; claim: Record<string, unknown> | null } {
        const envelope = data as { record?: LicenseRecordRow; revision?: { payloadJson?: string } } | LicenseRecordRow;
        const row = "record" in envelope && envelope.record ? envelope.record : envelope as LicenseRecordRow;
        let claim: Record<string, unknown> | null = null;
        const payloadJson = "revision" in envelope ? envelope.revision?.payloadJson : undefined;
        if (payloadJson) {
            try {
                claim = JSON.parse(payloadJson) as Record<string, unknown>;
            } catch {
                claim = null;
            }
        }
        return { row, claim };
    }

    async listLicenses(customerId: string): Promise<LicenseDocument[]> {
        const res = await this.fetchJson<LicenseEnvelope>(
            `/internal/v1/licenses?customerId=${encodeURIComponent(customerId)}`
        );
        const rows = Array.isArray(res.data) ? res.data : [];
        return rows.map((entry) => this.mapRow(entry as LicenseRecordRow));
    }

    async getLicense(licenseId: string): Promise<LicenseDocument> {
        const res = await this.fetchJson<LicenseEnvelope>(`/internal/v1/licenses/${encodeURIComponent(licenseId)}`);
        if (!res.data) throw new ApiError(502, "bad_gateway", "Malformed license document");
        const { row, claim } = this.unwrapRecord(res.data);
        return this.mapRow(row, claim);
    }

    async getLicenseDocument(licenseId: string): Promise<string> {
        const response = await this.fetchRaw(`/internal/v1/licenses/${encodeURIComponent(licenseId)}/document`);
        const text = await response.text();
        if (!response.ok) {
            throw new ApiError(
                response.status === 404 ? 404 : 502,
                response.status === 404 ? "not-found" : "bad_gateway",
                `License Service error (${response.status}): ${text.substring(0, 100)}`
            );
        }
        const json = JSON.parse(text) as { jwsCompact?: string };
        if (typeof json.jwsCompact !== "string") {
            throw new ApiError(502, "bad_gateway", "Malformed document response");
        }
        return json.jwsCompact;
    }

    private defaultClaim(input: {
        licenseId: string;
        customerId: string;
        productId: string;
        revisionNumber: number;
        validFrom?: string;
        validUntil?: string | null;
        entitlementLimits?: Record<string, number>;
        deploymentType?: string;
    }) {
        const now = new Date().toISOString();
        const mode = (input.deploymentType ?? "self-hosted") as "self-hosted";
        return {
            schemaVersion: 1 as const,
            licenseId: input.licenseId,
            customerId: input.customerId,
            product: input.productId,
            revisionNumber: input.revisionNumber,
            features: {},
            limits: {
                maxSeats: input.entitlementLimits?.maxSeats ?? input.entitlementLimits?.agents ?? 10,
                maxOrganizations: null,
                maxApiTokens: null,
                maxMonthlyOperations: null,
                maxStorageMb: null,
            },
            deploymentModes: [mode],
            billingModel: "subscription" as const,
            validity: {
                notBefore: input.validFrom ?? now,
                expiresAt: input.validUntil ?? null,
                offlineValidUntil: input.validUntil ?? new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString(),
            },
            activationPolicy: {
                maxActivations: null,
                activationTtlSeconds: null,
                allowRotation: false,
                allowedDeploymentModes: [mode],
            },
        };
    }

    async issueLicense(req: {
        customerId: string;
        productId: string;
        idempotencyKey: string;
        validFrom?: string;
        validUntil?: string;
        deploymentType?: string;
        entitlementLimits?: Record<string, number>;
        licenseId?: string;
    }): Promise<LicenseDocument> {
        const licenseId = req.licenseId ?? stableLicenseId("lic_", req.idempotencyKey);
        try {
            const existing = await this.getLicense(licenseId);
            if (existing.status !== "draft") {
                if (req.productId && existing.productId !== req.productId) {
                    throw new ApiError(409, "idempotency_conflict", "Idempotency key reused with a different product");
                }
                if (req.validUntil && existing.validUntil && existing.validUntil !== req.validUntil) {
                    throw new ApiError(409, "idempotency_conflict", "Idempotency key reused with a different validity window");
                }
                return existing;
            }
        } catch (error) {
            if (error instanceof ApiError && error.status === 409) throw error;
            /* create then issue */
        }
        try {
            await this.fetchJson(`/internal/v1/licenses`, {
                method: "POST",
                headers: { "Idempotency-Key": `${req.idempotencyKey}-create` },
                body: JSON.stringify({
                    licenseId,
                    customerId: req.customerId,
                    productId: req.productId,
                }),
            });
        } catch (error) {
            if (!(error instanceof ApiError && (error.status === 409 || error.status === 502 || error.status === 404))) {
                throw error;
            }
        }
        const claim = this.defaultClaim({
            licenseId,
            customerId: req.customerId,
            productId: req.productId,
            revisionNumber: 1,
            validFrom: req.validFrom,
            validUntil: req.validUntil,
            entitlementLimits: req.entitlementLimits,
            deploymentType: req.deploymentType,
        });
        const issued = await this.fetchJson<LicenseEnvelope>(`/internal/v1/licenses/${encodeURIComponent(licenseId)}/issue`, {
            method: "POST",
            headers: { "Idempotency-Key": req.idempotencyKey },
            body: JSON.stringify(claim),
        });
        const { row, claim: stored } = this.unwrapRecord(issued.data);
        return this.mapRow(row, stored ?? (claim as unknown as Record<string, unknown>));
    }

    async renewLicense(licenseId: string, req: { idempotencyKey: string; validUntil: string; successorId?: string }): Promise<LicenseDocument> {
        const current = await this.fetchJson<LicenseEnvelope>(`/internal/v1/licenses/${encodeURIComponent(licenseId)}`);
        if (!current.data) throw new ApiError(502, "bad_gateway", "Malformed license document");
        const { row, claim } = this.unwrapRecord(current.data);
        if (!claim) throw new ApiError(502, "bad_gateway", "Current license claim is missing");
        const successorId = req.successorId ?? stableLicenseId("lics_", req.idempotencyKey);
        const nextClaim = {
            ...claim,
            licenseId: successorId,
            revisionNumber: Number(claim.revisionNumber ?? row.current_revision) + 1,
            validity: {
                ...(typeof claim.validity === "object" && claim.validity ? claim.validity : {}),
                expiresAt: req.validUntil,
                offlineValidUntil: req.validUntil,
            },
        };
        const renewed = await this.fetchJson<LicenseEnvelope>(`/internal/v1/licenses/${encodeURIComponent(licenseId)}/renew`, {
            method: "POST",
            headers: { "Idempotency-Key": req.idempotencyKey },
            body: JSON.stringify({ successorId, claim: nextClaim }),
        });
        const mapped = this.unwrapRecord(renewed.data);
        return this.mapRow(mapped.row, mapped.claim ?? (nextClaim as Record<string, unknown>));
    }

    async suspendLicense(licenseId: string, req: { idempotencyKey: string; reason: string }): Promise<LicenseDocument> {
        const res = await this.fetchJson<LicenseEnvelope>(`/internal/v1/licenses/${encodeURIComponent(licenseId)}/suspend`, {
            method: "POST",
            headers: { "Idempotency-Key": req.idempotencyKey },
            body: JSON.stringify({ reason: req.reason }),
        });
        const { row, claim } = this.unwrapRecord(res.data);
        return this.mapRow(row, claim);
    }

    async revokeLicense(licenseId: string, req: { idempotencyKey: string; reason: string }): Promise<LicenseDocument> {
        const res = await this.fetchJson<LicenseEnvelope>(`/internal/v1/licenses/${encodeURIComponent(licenseId)}/revoke`, {
            method: "POST",
            headers: { "Idempotency-Key": req.idempotencyKey },
            body: JSON.stringify({ reason: req.reason }),
        });
        const { row, claim } = this.unwrapRecord(res.data);
        return this.mapRow(row, claim);
    }

    async resumeLicense(licenseId: string, req: { idempotencyKey: string; reason: string }): Promise<LicenseDocument> {
        const res = await this.fetchJson<LicenseEnvelope>(`/internal/v1/licenses/${encodeURIComponent(licenseId)}/resume`, {
            method: "POST",
            headers: { "Idempotency-Key": req.idempotencyKey },
            body: JSON.stringify({ reason: req.reason }),
        });
        const { row, claim } = this.unwrapRecord(res.data);
        return this.mapRow(row, claim);
    }

    async replaceLicense(licenseId: string, req: { idempotencyKey: string; successorId?: string; entitlementLimits?: Record<string, number>; validUntil?: string; deploymentType?: string }): Promise<LicenseDocument> {
        const current = await this.fetchJson<LicenseEnvelope>(`/internal/v1/licenses/${encodeURIComponent(licenseId)}`);
        if (!current.data) throw new ApiError(502, "bad_gateway", "Malformed license document");
        const { row, claim } = this.unwrapRecord(current.data);
        if (!claim) throw new ApiError(502, "bad_gateway", "Current license claim is missing");

        const successorId = req.successorId ?? stableLicenseId("licr_", req.idempotencyKey);

        const limits = { ...(claim.limits as Record<string, unknown> ?? {}) };
        if (req.entitlementLimits) {
            for (const [k, v] of Object.entries(req.entitlementLimits)) {
                limits[k] = v;
            }
        }

        const nextClaim = {
            ...claim,
            licenseId: successorId,
            revisionNumber: Number(claim.revisionNumber ?? row.current_revision) + 1,
            limits,
            ...(req.deploymentType ? { deploymentModes: [req.deploymentType] } : {}),
            validity: {
                ...(typeof claim.validity === "object" && claim.validity ? claim.validity : {}),
                ...(req.validUntil !== undefined ? { expiresAt: req.validUntil, offlineValidUntil: req.validUntil } : {})
            },
        };
        const replaced = await this.fetchJson<LicenseEnvelope>(`/internal/v1/licenses/${encodeURIComponent(licenseId)}/replace`, {
            method: "POST",
            headers: { "Idempotency-Key": req.idempotencyKey },
            body: JSON.stringify({ successorId, claim: nextClaim }),
        });
        const mapped = this.unwrapRecord(replaced.data);
        return this.mapRow(mapped.row, mapped.claim ?? (nextClaim as Record<string, unknown>));
    }
}
