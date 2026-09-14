import { ApiError } from "../app";
import type { CustomerRequest } from "../../../src/domain/types";

interface OperatorRequestSummary {
    requestId: string;
    customerId: string;
    requestType: CustomerRequest["type"];
    status: CustomerRequest["status"];
    summary: string;
    createdAt: string;
    updatedAt?: string;
}

interface OperatorRequestEvent {
    occurredAt: string;
    resultingStatus: string | null;
    principalIdentifier: string;
    customerVisibleMessage: string;
    operatorNote: string | null;
    externalReference: string | null;
}

interface OperatorRequestDetail extends OperatorRequestSummary {
    payload?: Record<string, unknown>;
    events?: OperatorRequestEvent[];
}

export class PortalAdapter {
    constructor(
        private readonly fetcher: Fetcher | undefined,
        private readonly token: string,
        private readonly urlOverride?: string
    ) { }

    private origin(): string {
        if (this.urlOverride) return this.urlOverride.replace(/\/$/, "");
        return "http://customer-portal.internal";
    }

    private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
        if (!this.token) {
            throw new ApiError(503, "service_unavailable", "PORTAL_SERVICE_TOKEN is not configured.");
        }
        if (!this.fetcher && !this.urlOverride) {
            throw new ApiError(503, "service_unavailable", "Customer Portal binding is not configured.");
        }
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${this.token}`);
        if (!headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
        }
        const requestUrl = `${this.origin()}${path}`;
        let response: Response;
        try {
            response = this.urlOverride
                ? await fetch(requestUrl, { ...init, headers })
                : await this.fetcher!.fetch(requestUrl, { ...init, headers });
        } catch {
            throw new ApiError(502, "bad_gateway", "Customer Portal network error");
        }

        const text = await response.text();
        if (response.status === 409) {
            let code = "conflict";
            try {
                const parsed = JSON.parse(text) as { error?: { code?: string } };
                if (parsed.error?.code) code = parsed.error.code;
            } catch {
                /* keep default */
            }
            throw new ApiError(409, code, text.slice(0, 200) || "Portal request conflict");
        }
        if (!response.ok) {
            throw new ApiError(
                response.status === 404 ? 404 : 502,
                response.status === 404 ? "not-found" : "bad_gateway",
                `Customer Portal error (${response.status}): ${text.substring(0, 100)}`
            );
        }

        let json: unknown;
        try {
            json = JSON.parse(text);
        } catch {
            throw new ApiError(502, "bad_gateway", "Invalid JSON from Customer Portal");
        }
        if (!json || typeof json !== "object") {
            throw new ApiError(502, "bad_gateway", "Invalid JSON from Customer Portal");
        }
        return json as T;
    }

    private toCustomerRequest(detail: OperatorRequestDetail): CustomerRequest {
        const events = detail.events ?? [];
        const lastRef = [...events].reverse().find((event) => event.externalReference)?.externalReference;
        return {
            id: detail.requestId,
            customerId: detail.customerId,
            type: detail.requestType,
            status: detail.status,
            submittedAt: detail.createdAt,
            summary: detail.summary,
            payload: detail.payload,
            externalReference: lastRef ?? undefined,
            history: events.map((event) => ({
                timestamp: event.occurredAt,
                status: event.resultingStatus ?? "",
                actor: event.principalIdentifier,
                note: event.operatorNote ?? event.customerVisibleMessage,
            })),
        };
    }

    async listRequests(customerId: string): Promise<CustomerRequest[]> {
        const res = await this.fetch<{ items?: OperatorRequestSummary[] }>(
            `/service/v1/requests?customerId=${encodeURIComponent(customerId)}`
        );
        const items = Array.isArray(res.items) ? res.items : [];
        return items.map((item) => this.toCustomerRequest(item));
    }

    async getRequest(requestId: string): Promise<CustomerRequest> {
        const res = await this.fetch<{ request?: OperatorRequestDetail }>(
            `/service/v1/requests/${encodeURIComponent(requestId)}`
        );
        if (!res.request) throw new ApiError(502, "bad_gateway", "Malformed request response");
        return this.toCustomerRequest(res.request);
    }

    async recordDecision(
        requestId: string,
        req: {
            decision: CustomerRequest["status"] | "under_review";
            operatorNote?: string;
            customerVisibleMessage?: string;
            externalReference?: string;
            idempotencyKey: string;
        }
    ): Promise<CustomerRequest> {
        const res = await this.fetch<{ request?: OperatorRequestDetail }>(
            `/service/v1/requests/${encodeURIComponent(requestId)}/decision`,
            {
                method: "POST",
                body: JSON.stringify({
                    decision: req.decision,
                    operatorNote: req.operatorNote,
                    customerVisibleMessage: req.customerVisibleMessage,
                    externalReference: req.externalReference,
                    idempotencyKey: req.idempotencyKey,
                }),
            }
        );
        if (!res.request) throw new ApiError(502, "bad_gateway", "Malformed request response");
        return this.toCustomerRequest(res.request);
    }
}
