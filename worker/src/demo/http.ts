import { ApiError } from "../app";
import type { Env } from "../app";
import type { OperatorIdentity } from "../auth";
import {
  assertTransition,
  canTransition,
  isDeploymentPreference,
  isDemoRequestStatus,
  type DemoProposedConfig,
  type DemoRequestStatus,
} from "../../../src/domain/demo-request";
import { newId, sha256Hex, timingSafeEqual } from "./crypto";
import { needsInformationEmail, rejectionEmail } from "./email";
import { intakeDemoRequest } from "./intake";
import { drainEmailOutbox } from "./outbox";
import { provisionDemoRequest } from "./provision";
import {
  enqueueEmail,
  getDemoRequest,
  listDemoEvents,
  listDemoRequests,
  proposedFromRecord,
  updateDemoRequestVersioned,
  type DemoRequestRecord,
} from "./store";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("invalid");
    }
    return body as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "validation-error", "Request body must be a JSON object.");
  }
}

function publicEnvelope(record: DemoRequestRecord) {
  return {
    apiVersion: "1",
    requestId: record.id,
    publicReference: record.publicReference,
    status: record.status,
    submittedAt: record.submittedAt,
  };
}

function operatorEnvelope(record: DemoRequestRecord, events: unknown[] = []) {
  return {
    request: {
      id: record.id,
      publicReference: record.publicReference,
      status: record.status,
      submittedAt: record.submittedAt,
      updatedAt: record.updatedAt,
      version: record.version,
      original: {
        applicantName: record.applicantName,
        applicantEmail: record.applicantEmail,
        organizationName: record.organizationName,
        organizationDomain: record.organizationDomain,
        roleTitle: record.roleTitle,
        useCase: record.useCase,
        deploymentPreference: record.deploymentPreference,
        expectedAgentCount: record.expectedAgentCount,
        requestedAgentIds: record.requestedAgentIds,
        infrastructureNotes: record.infrastructureNotes,
        timeline: record.timeline,
        additionalDetails: record.additionalDetails,
      },
      proposed: proposedFromRecord(record),
      provisioning: {
        status: record.provisioningStatus,
        customerId: record.provisionedCustomerId,
        approvedBy: record.approvedBy,
        approvedAt: record.approvedAt,
        rejectedBy: record.rejectedBy,
        rejectedAt: record.rejectedAt,
      },
      events,
    },
  };
}

export async function handleLandingDemoIntake(request: Request, env: Env): Promise<Response> {
  if (!env.LANDING_CALLER_TOKEN) {
    throw new ApiError(503, "service_unavailable", "LANDING_CALLER_TOKEN is not configured.");
  }
  const presented = request.headers.get("Authorization")?.startsWith("Bearer ")
    ? request.headers.get("Authorization")!.slice("Bearer ".length)
    : "";
  if (!presented || !(await timingSafeEqual(presented, env.LANDING_CALLER_TOKEN))) {
    throw new ApiError(401, "unauthorized", "Invalid or missing service token.");
  }
  const body = await readJson(request);
  const idempotencyKey =
    (typeof body.idempotencyKey === "string" && body.idempotencyKey) ||
    request.headers.get("Idempotency-Key") ||
    "";
  const correlationId = request.headers.get("X-Correlation-ID") || newId("corr");
  const result = await intakeDemoRequest(env, body, idempotencyKey, correlationId);
  return json(publicEnvelope(result.record), result.replayed ? 200 : 201);
}

export async function handleOperatorDemoApi(
  request: Request,
  env: Env,
  url: URL,
  segments: string[],
  identity: OperatorIdentity,
): Promise<Response> {
  const method = request.method;
  if (segments.length === 2 && method === "GET") {
    const status = url.searchParams.get("status") ?? undefined;
    const q = url.searchParams.get("q") ?? undefined;
    if (status && !isDemoRequestStatus(status)) {
      throw new ApiError(400, "validation-error", "status is invalid.");
    }
    const items = await listDemoRequests(env.DB, { status, q });
    return json({
      items: items.map((item) => ({
        id: item.id,
        publicReference: item.publicReference,
        status: item.status,
        organizationName: item.organizationName,
        applicantName: item.applicantName,
        applicantEmail: item.applicantEmail,
        submittedAt: item.submittedAt,
        deploymentPreference: item.deploymentPreference,
        provisioningStatus: item.provisioningStatus,
      })),
    });
  }

  if (segments.length < 3) {
    throw new ApiError(404, "not-found", "Unknown API route.");
  }
  const id = segments[2];
  const current = await getDemoRequest(env.DB, id);
  if (!current) throw new ApiError(404, "not-found", "Demo request not found.");

  if (segments.length === 3 && method === "GET") {
    const events = await listDemoEvents(env.DB, id);
    return json(operatorEnvelope(current, events));
  }

  if (segments.length === 4 && segments[3] === "configuration" && method === "PATCH") {
    return patchConfiguration(request, env, identity, current);
  }

  if (segments.length === 4 && segments[3] === "transition" && method === "POST") {
    return transitionDemo(request, env, identity, current);
  }

  throw new ApiError(404, "not-found", "Unknown API route.");
}

async function patchConfiguration(
  request: Request,
  env: Env,
  identity: OperatorIdentity,
  current: DemoRequestRecord,
): Promise<Response> {
  if (!["submitted", "under_review", "needs_information", "provisioning_failed"].includes(current.status)) {
    throw new ApiError(409, "conflict", "Proposed configuration cannot be edited in the current status.");
  }
  const body = await readJson(request);
  if (typeof body.version !== "number" || body.version !== current.version) {
    throw new ApiError(409, "conflict", "Stale demo request version.");
  }
  const proposed = parseProposed(body, current);
  const now = new Date().toISOString();
  const next: DemoRequestRecord = {
    ...current,
    proposedCustomerName: proposed.customerName,
    proposedCustomerDomain: proposed.customerDomain,
    demoStartAt: proposed.demoStartAt,
    demoExpiresAt: proposed.demoExpiresAt,
    proposedDeploymentModel: proposed.deploymentModel,
    proposedFeatures: proposed.enabledFeatures,
    proposedAgentIds: proposed.permittedAgentIds,
    proposedCapacityNotes: proposed.capacityNotes,
    customerVisibleNotes: proposed.customerVisibleNotes,
    operatorNotes: proposed.operatorNotes,
    updatedAt: now,
    version: current.version + 1,
  };
  const ok = await updateDemoRequestVersioned(env.DB, current, next, {
    id: newId("devent"),
    requestId: current.id,
    occurredAt: now,
    principal: identity.email,
    action: "demo.configuration_updated",
    correlationId: newId("corr"),
    idempotencyHash: "",
    metadata: { version: current.version },
  });
  if (!ok) throw new ApiError(409, "conflict", "Stale demo request version.");
  const events = await listDemoEvents(env.DB, current.id);
  const updated = (await getDemoRequest(env.DB, current.id))!;
  return json(operatorEnvelope(updated, events));
}

function parseProposed(body: Record<string, unknown>, current: DemoRequestRecord): DemoProposedConfig {
  const base = proposedFromRecord(current);
  const stringField = (key: keyof DemoProposedConfig, max: number): string => {
    const value = body[key];
    if (value === undefined) return String(base[key] ?? "");
    if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > max) {
      throw new ApiError(400, "validation-error", `${key} is invalid.`);
    }
    return value.trim();
  };
  const deploymentModel = body.deploymentModel === undefined
    ? base.deploymentModel
    : String(body.deploymentModel);
  if (!isDeploymentPreference(deploymentModel)) {
    throw new ApiError(400, "validation-error", "deploymentModel is invalid.");
  }
  const parseList = (key: string, fallback: string[]): string[] => {
    const value = body[key];
    if (value === undefined) return fallback;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new ApiError(400, "validation-error", `${key} is invalid.`);
    }
    return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 20);
  };
  return {
    customerName: stringField("customerName", 160),
    customerDomain: stringField("customerDomain", 253).toLowerCase(),
    demoStartAt: stringField("demoStartAt", 40),
    demoExpiresAt: stringField("demoExpiresAt", 40),
    deploymentModel,
    enabledFeatures: parseList("enabledFeatures", base.enabledFeatures),
    permittedAgentIds: parseList("permittedAgentIds", base.permittedAgentIds),
    capacityNotes: typeof body.capacityNotes === "string" ? body.capacityNotes.trim().slice(0, 4000) : base.capacityNotes,
    customerVisibleNotes:
      typeof body.customerVisibleNotes === "string" ? body.customerVisibleNotes.trim().slice(0, 4000) : base.customerVisibleNotes,
    operatorNotes: typeof body.operatorNotes === "string" ? body.operatorNotes.trim().slice(0, 4000) : base.operatorNotes,
  };
}

async function transitionDemo(
  request: Request,
  env: Env,
  identity: OperatorIdentity,
  current: DemoRequestRecord,
): Promise<Response> {
  const body = await readJson(request);
  const action = String(body.action ?? "");
  if ((action === "approve" || action === "retry") && current.status === "active" && current.provisionedCustomerId) {
    const events = await listDemoEvents(env.DB, current.id);
    return json(operatorEnvelope(current, events));
  }
  if (typeof body.version !== "number" || body.version !== current.version) {
    throw new ApiError(409, "conflict", "Stale demo request version.");
  }
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 4000) : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : `demo-${current.id}-${action}`;
  const now = new Date().toISOString();
  const correlationId = newId("corr");

  if (action === "approve" || action === "retry") {
    if (action === "retry" && current.status !== "provisioning_failed") {
      throw new ApiError(409, "conflict", "Retry is only allowed after provisioning_failed.");
    }
    if (action === "approve" && current.status !== "under_review" && current.status !== "approved") {
      throw new ApiError(409, "conflict", "Approve is only allowed from under_review.");
    }
    const provisioned = await provisionDemoRequest(env, identity, current, correlationId, idempotencyKey);
    const events = await listDemoEvents(env.DB, current.id);
    return json(operatorEnvelope(provisioned, events));
  }

  const targetByAction: Record<string, DemoRequestStatus> = {
    start_review: "under_review",
    needs_information: "needs_information",
    reject: "rejected",
  };
  const target = targetByAction[action];
  if (!target) throw new ApiError(400, "validation-error", "Unknown demo request action.");
  if (!canTransition(current.status, target)) {
    throw new ApiError(409, "conflict", `Cannot transition demo request from ${current.status} to ${target}.`);
  }
  assertTransition(current.status, target);

  const next: DemoRequestRecord = {
    ...current,
    status: target,
    updatedAt: now,
    version: current.version + 1,
    rejectedBy: target === "rejected" ? identity.email : current.rejectedBy,
    rejectedAt: target === "rejected" ? now : current.rejectedAt,
    operatorNotes: note || current.operatorNotes,
    customerVisibleNotes: note || current.customerVisibleNotes,
  };
  const ok = await updateDemoRequestVersioned(env.DB, current, next, {
    id: newId("devent"),
    requestId: current.id,
    occurredAt: now,
    principal: identity.email,
    action: `demo.${action}`,
    correlationId,
    idempotencyHash: await sha256Hex(idempotencyKey),
    metadata: { from: current.status, to: target },
  });
  if (!ok) throw new ApiError(409, "conflict", "Stale demo request version.");

  if (action === "needs_information") {
    await enqueueEmail(env.DB, {
      id: newId("eml"),
      requestId: current.id,
      template: "needs_information",
      toEmail: current.applicantEmail,
      idempotencyKey: `info-${current.id}-${current.version}`,
      createdAt: now,
    });
    await drainEmailOutbox(env, {
      needs_information: needsInformationEmail({
        to: current.applicantEmail,
        reference: current.publicReference,
        name: current.applicantName,
        note: note || "Please reply with the additional evaluation details requested by the operator.",
      }),
    });
  }
  if (action === "reject") {
    await enqueueEmail(env.DB, {
      id: newId("eml"),
      requestId: current.id,
      template: "rejected",
      toEmail: current.applicantEmail,
      idempotencyKey: `reject-${current.id}`,
      createdAt: now,
    });
    await drainEmailOutbox(env, {
      rejected: rejectionEmail({
        to: current.applicantEmail,
        reference: current.publicReference,
        name: current.applicantName,
        note: note || "The evaluation request was not approved.",
      }),
    });
  }

  const updated = (await getDemoRequest(env.DB, current.id))!;
  const events = await listDemoEvents(env.DB, current.id);
  return json(operatorEnvelope(updated, events));
}
