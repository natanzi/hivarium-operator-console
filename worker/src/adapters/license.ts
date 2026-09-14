import { ApiError } from "../app";

export interface LicenseDocument {
    id: string;
    customerId: string;
    productId: string;
    revision: number;
    status: "active" | "suspended" | "revoked" | "expired";
    deploymentType: string;
    validFrom: string;
    validUntil: string | null;
    entitlementLimits: Record<string, number>;
}

export class LicenseAdapter {
    constructor(
        private readonly fetcher: Fetcher,
        private readonly token: string
    ) { }

    private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
        const start = Date.now();
        try {
            const response = await this.fetcher.fetch(`http://license-service.internal${path}`, {
                ...init,
                headers: {
                    ...init?.headers,
                    Authorization: `Bearer ${this.token}`,
                    "Content-Type": "application/json",
                },
            });

            if (!response.ok) {
                const text = await response.text();
                throw new ApiError(
                    response.status === 404 ? 404 : 502,
                    "bad_gateway",
                    `License Service error (${response.status}): ${text.substring(0, 100)}`
                );
            }

            if (response.status === 204) {
                return {} as T;
            }

            const json = await response.json();
            if (!json || typeof json !== "object") {
                throw new ApiError(502, "bad_gateway", "Invalid JSON from License Service");
            }
            return json as T;
        } catch (err) {
            if (err instanceof ApiError) throw err;
            throw new ApiError(502, "bad_gateway", "License Service network error");
        }
    }

    async listLicenses(customerId: string): Promise<LicenseDocument[]> {
        const res = await this.fetch<{ licenses?: LicenseDocument[] }>(`/v1/licenses?customerId=${customerId}`);
        return Array.isArray(res.licenses) ? res.licenses : [];
    }

    async getLicense(licenseId: string): Promise<LicenseDocument> {
        const res = await this.fetch<{ license?: LicenseDocument }>(`/v1/licenses/${licenseId}`);
        if (!res.license) throw new ApiError(502, "bad_gateway", "Malformed license document");
        return res.license;
    }

    async getLicenseDocument(licenseId: string): Promise<string> {
        // Return raw document string (e.g. JWT or cert)
        const res = await this.fetch<{ document?: string }>(`/v1/licenses/${licenseId}/document`);
        if (typeof res.document !== "string") throw new ApiError(502, "bad_gateway", "Malformed document response");
        return res.document;
    }

    async issueLicense(req: { customerId: string; productId: string; idempotencyKey: string; validFrom?: string; validUntil?: string, deploymentType?: string, entitlementLimits?: Record<string, number> }): Promise<LicenseDocument> {
        const res = await this.fetch<{ license?: LicenseDocument }>(`/v1/licenses`, {
            method: "POST",
            headers: { "Idempotency-Key": req.idempotencyKey },
            body: JSON.stringify(req),
        });
        if (!res.license) throw new ApiError(502, "bad_gateway", "Malformed license response");
        return res.license;
    }

    async renewLicense(licenseId: string, req: { idempotencyKey: string; validUntil: string }): Promise<LicenseDocument> {
        const res = await this.fetch<{ license?: LicenseDocument }>(`/v1/licenses/${licenseId}/renew`, {
            method: "POST",
            headers: { "Idempotency-Key": req.idempotencyKey },
            body: JSON.stringify(req),
        });
        if (!res.license) throw new ApiError(502, "bad_gateway", "Malformed license response");
        return res.license;
    }

    async suspendLicense(licenseId: string, req: { idempotencyKey: string; reason: string }): Promise<LicenseDocument> {
        const res = await this.fetch<{ license?: LicenseDocument }>(`/v1/licenses/${licenseId}/suspend`, {
            method: "POST",
            headers: { "Idempotency-Key": req.idempotencyKey },
            body: JSON.stringify(req),
        });
        if (!res.license) throw new ApiError(502, "bad_gateway", "Malformed license response");
        return res.license;
    }

    async revokeLicense(licenseId: string, req: { idempotencyKey: string; reason: string }): Promise<LicenseDocument> {
        const res = await this.fetch<{ license?: LicenseDocument }>(`/v1/licenses/${licenseId}/revoke`, {
            method: "POST",
            headers: { "Idempotency-Key": req.idempotencyKey },
            body: JSON.stringify(req),
        });
        if (!res.license) throw new ApiError(502, "bad_gateway", "Malformed license response");
        return res.license;
    }
}
