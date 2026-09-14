import { ApiError } from "./app";
import { PortalAdapter } from "./adapters/portal";
import { LicenseAdapter } from "./adapters/license";
import { buildAuditEntry, commitStoreDiff, loadCustomerStore, diffStores } from "./db";
import { Env } from "./app";
import { OperatorIdentity } from "./auth";

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
        },
    });
}

function nowIso(): string {
    return new Date().toISOString();
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
    const body = await request.json();
    if (!body || typeof body !== "object") throw new ApiError(400, "validation-error", "Invalid JSON");
    return body as Record<string, unknown>;
}

export async function handleRequestsApi(request: Request, env: Env, segments: string[], identity: OperatorIdentity): Promise<Response> {
    const method = request.method;
    const customerId = segments[2];
    const adapter = new PortalAdapter(env.CUSTOMER_PORTAL_SERVICE, env.PORTAL_SERVICE_TOKEN);

    if (segments.length === 4 && method === "GET") {
        const list = await adapter.listRequests(customerId);
        return json({ requests: list });
    }

    if (segments.length === 5 && method === "GET") {
        const reqId = segments[4];
        const reqInfo = await adapter.getRequest(reqId);
        return json({ request: reqInfo });
    }

    if (segments.length === 6 && segments[5] === "decision" && method === "POST") {
        const reqId = segments[4];
        const body = await readJson(request);
        const status = body.status as any;
        const note = body.note as string;
        if (!["approved", "rejected", "needs_information"].includes(status)) {
            throw new ApiError(400, "validation-error", "Invalid status");
        }

        const updated = await adapter.recordDecision(reqId, { status, note, operatorEmail: identity.email });

        const before = await loadCustomerStore(env.DB, customerId);
        const audit = buildAuditEntry({
            identity,
            action: "request.decision",
            customerId,
            subjectType: "customer_request",
            subjectId: reqId,
            summary: `Recorded ${status} decision for request.`,
            after: { status, note },
            occurredAt: nowIso(),
        });

        await commitStoreDiff(env.DB, diffStores(before, before), audit);
        return json({ request: updated });
    }

    throw new ApiError(404, "not-found", "Unknown API route.");
}

export async function handleLicensesApi(request: Request, env: Env, segments: string[], identity: OperatorIdentity): Promise<Response> {
    const method = request.method;
    const customerId = segments[2];
    const adapter = new LicenseAdapter(env.LICENSE_SERVICE, env.LICENSE_SERVICE_TOKEN);

    if (segments.length === 4 && method === "GET") {
        const list = await adapter.listLicenses(customerId);
        return json({ licenses: list });
    }

    if (segments.length === 4 && method === "POST") {
        const body = await readJson(request);
        const productId = body.productId as string;
        const idempotencyKey = body.idempotencyKey as string;
        if (!productId || !idempotencyKey) throw new ApiError(400, "validation-error", "Missing productId or idempotencyKey");

        const issued = await adapter.issueLicense({
            customerId, productId, idempotencyKey,
            validFrom: body.validFrom as string,
            validUntil: body.validUntil as string,
            deploymentType: body.deploymentType as string,
            entitlementLimits: body.entitlementLimits as Record<string, number>
        });

        const before = await loadCustomerStore(env.DB, customerId);
        const audit = buildAuditEntry({
            identity,
            action: "license.issued",
            customerId,
            subjectType: "license",
            subjectId: issued.id,
            summary: `Issued ${issued.productId} license.`,
            after: issued,
            occurredAt: nowIso(),
        });
        await commitStoreDiff(env.DB, diffStores(before, before), audit);

        return json({ license: issued }, 201);
    }

    if (segments.length === 5 && method === "GET") {
        const license = await adapter.getLicense(segments[4]);
        return json({ license });
    }

    if (segments.length === 6 && segments[5] === "document" && method === "GET") {
        const document = await adapter.getLicenseDocument(segments[4]);
        return json({ document });
    }

    if (segments.length === 6 && method === "POST") {
        const licId = segments[4];
        const op = segments[5];
        const body = await readJson(request);
        const idempotencyKey = body.idempotencyKey as string;
        if (!idempotencyKey) throw new ApiError(400, "validation-error", "Missing idempotencyKey");

        let updated;
        let action = "";
        if (op === "renew") {
            if (!body.validUntil) throw new ApiError(400, "validation-error", "Missing validUntil");
            updated = await adapter.renewLicense(licId, { idempotencyKey, validUntil: body.validUntil as string });
            action = "license.renewed";
        } else if (op === "suspend") {
            if (!body.reason) throw new ApiError(400, "validation-error", "Missing reason");
            updated = await adapter.suspendLicense(licId, { idempotencyKey, reason: body.reason as string });
            action = "license.suspended";
        } else if (op === "revoke") {
            if (!body.reason) throw new ApiError(400, "validation-error", "Missing reason");
            updated = await adapter.revokeLicense(licId, { idempotencyKey, reason: body.reason as string });
            action = "license.revoked";
        } else {
            throw new ApiError(404, "not-found", "Unknown API route.");
        }

        const before = await loadCustomerStore(env.DB, customerId);
        const audit = buildAuditEntry({
            identity,
            action: action as any,
            customerId,
            subjectType: "license",
            subjectId: licId,
            summary: `${action} license.`,
            after: updated,
            occurredAt: nowIso(),
        });
        await commitStoreDiff(env.DB, diffStores(before, before), audit);

        return json({ license: updated });
    }

    throw new ApiError(404, "not-found", "Unknown API route.");
}
