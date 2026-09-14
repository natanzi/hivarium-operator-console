import { ApiError } from "../app";

export interface CustomerRequest {
    id: string;
    customerId: string;
    type: "license_renewal" | "plan_change" | "additional_agent_access" | "token_credit_request" | "support_request";
    status: "pending" | "approved" | "rejected" | "needs_information";
    submittedAt: string;
    summary: string;
    history: Array<{ timestamp: string; status: string; actor: string; note?: string }>;
}

export class PortalAdapter {
    constructor(
        private readonly fetcher: Fetcher,
        private readonly token: string
    ) { }

    private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
        try {
            const response = await this.fetcher.fetch(`http://customer-portal.internal${path}`, {
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
                    `Customer Portal error (${response.status}): ${text.substring(0, 100)}`
                );
            }

            const json = await response.json();
            if (!json || typeof json !== "object") {
                throw new ApiError(502, "bad_gateway", "Invalid JSON from Customer Portal");
            }
            return json as T;
        } catch (err) {
            if (err instanceof ApiError) throw err;
            throw new ApiError(502, "bad_gateway", "Customer Portal network error");
        }
    }

    async listRequests(customerId: string): Promise<CustomerRequest[]> {
        const res = await this.fetch<{ requests?: CustomerRequest[] }>(`/v1/requests?customerId=${customerId}`);
        return Array.isArray(res.requests) ? res.requests : [];
    }

    async getRequest(requestId: string): Promise<CustomerRequest> {
        const res = await this.fetch<{ request?: CustomerRequest }>(`/v1/requests/${requestId}`);
        if (!res.request) throw new ApiError(502, "bad_gateway", "Malformed request response");
        return res.request;
    }

    async recordDecision(requestId: string, req: { status: "approved" | "rejected" | "needs_information"; note: string; operatorEmail: string }): Promise<CustomerRequest> {
        const res = await this.fetch<{ request?: CustomerRequest }>(`/v1/requests/${requestId}/decision`, {
            method: "POST",
            body: JSON.stringify(req),
        });
        if (!res.request) throw new ApiError(502, "bad_gateway", "Malformed request response");
        return res.request;
    }
}
