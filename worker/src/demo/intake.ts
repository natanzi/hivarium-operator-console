import { ApiError } from "../app";
import type { Env } from "../app";
import {
  defaultProposedConfig,
  domainFromEmail,
  isDeploymentPreference,
  normalizeEmail,
  type DemoIntakePayload,
} from "../../../src/domain/demo-request";
import { canonicalJson, newId, sha256Hex } from "./crypto";
import {
  customerAckEmail,
  operatorNotificationEmail,
} from "./email";
import {
  enqueueEmail,
  getDemoRequestByIdempotency,
  insertDemoRequest,
  publicReferenceFromId,
  type DemoRequestRecord,
} from "./store";
import { drainEmailOutbox } from "./outbox";

const MAX = {
  name: 120,
  email: 254,
  org: 160,
  domain: 253,
  role: 80,
  useCase: 2000,
  notes: 4000,
  count: 32,
  timeline: 120,
  agentId: 64,
  agents: 20,
};

function bounded(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function requireBounded(value: unknown, field: string, max: number): string {
  const text = bounded(value, max);
  if (!text) throw new ApiError(400, "validation-error", `${field} is required.`);
  if (typeof value === "string" && value.trim().length > max) {
    throw new ApiError(400, "validation-error", `${field} is too long.`);
  }
  return text;
}

export function parseIntakePayload(body: Record<string, unknown>): DemoIntakePayload {
  if (typeof body.website === "string" && body.website.trim().length > 0) {
    throw new ApiError(400, "validation-error", "Invalid request.");
  }
  if (body.consent !== true) {
    throw new ApiError(400, "validation-error", "consent is required.");
  }
  const applicantEmail = normalizeEmail(requireBounded(body.applicantEmail ?? body.workEmail, "applicantEmail", MAX.email));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicantEmail)) {
    throw new ApiError(400, "validation-error", "applicantEmail is invalid.");
  }
  const deploymentPreference = String(body.deploymentPreference ?? "");
  if (!isDeploymentPreference(deploymentPreference)) {
    throw new ApiError(400, "validation-error", "deploymentPreference is invalid.");
  }
  const requestedRaw = body.requestedAgentIds;
  const requestedAgentIds = Array.isArray(requestedRaw)
    ? requestedRaw
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, MAX.agents)
    : [];
  if (requestedAgentIds.some((id) => id.length > MAX.agentId)) {
    throw new ApiError(400, "validation-error", "requestedAgentIds is invalid.");
  }
  const organizationDomain =
    bounded(body.organizationDomain, MAX.domain) || domainFromEmail(applicantEmail);
  if (!organizationDomain) {
    throw new ApiError(400, "validation-error", "organizationDomain is required.");
  }
  return {
    applicantName: requireBounded(body.applicantName ?? body.fullName, "applicantName", MAX.name),
    applicantEmail,
    organizationName: requireBounded(body.organizationName ?? body.organization, "organizationName", MAX.org),
    organizationDomain: organizationDomain.toLowerCase(),
    roleTitle: bounded(body.roleTitle, MAX.role),
    useCase: requireBounded(body.useCase, "useCase", MAX.useCase),
    deploymentPreference,
    expectedAgentCount: bounded(body.expectedAgentCount, MAX.count),
    requestedAgentIds,
    infrastructureNotes: bounded(body.infrastructureNotes, MAX.notes),
    timeline: bounded(body.timeline, MAX.timeline),
    additionalDetails: bounded(body.additionalDetails, MAX.notes),
  };
}

export async function intakeDemoRequest(
  env: Env,
  body: Record<string, unknown>,
  idempotencyKey: string,
  correlationId: string,
): Promise<{ record: DemoRequestRecord; replayed: boolean }> {
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(idempotencyKey)) {
    throw new ApiError(400, "validation-error", "idempotencyKey is invalid.");
  }
  const intake = parseIntakePayload(body);
  const bodyHash = await sha256Hex(canonicalJson(intake));
  const existing = await getDemoRequestByIdempotency(env.DB, idempotencyKey);
  if (existing) {
    if (existing.intakeBodyHash !== bodyHash) {
      throw new ApiError(409, "idempotency_conflict", "Idempotency key reused with a different payload.");
    }
    return { record: existing, replayed: true };
  }

  const now = new Date().toISOString();
  const id = newId("dreq");
  const proposed = defaultProposedConfig(intake, now);
  const record: DemoRequestRecord = {
    id,
    publicReference: publicReferenceFromId(id),
    status: "submitted",
    submittedAt: now,
    updatedAt: now,
    applicantName: intake.applicantName,
    applicantEmail: intake.applicantEmail,
    organizationName: intake.organizationName,
    organizationDomain: intake.organizationDomain,
    roleTitle: intake.roleTitle,
    useCase: intake.useCase,
    deploymentPreference: intake.deploymentPreference,
    expectedAgentCount: intake.expectedAgentCount,
    requestedAgentIds: intake.requestedAgentIds,
    infrastructureNotes: intake.infrastructureNotes,
    timeline: intake.timeline,
    additionalDetails: intake.additionalDetails,
    operatorNotes: "",
    customerVisibleNotes: "",
    proposedCustomerName: proposed.customerName,
    proposedCustomerDomain: proposed.customerDomain,
    proposedDeploymentModel: proposed.deploymentModel,
    proposedFeatures: proposed.enabledFeatures,
    proposedAgentIds: proposed.permittedAgentIds,
    proposedCapacityNotes: proposed.capacityNotes,
    demoStartAt: proposed.demoStartAt,
    demoExpiresAt: proposed.demoExpiresAt,
    provisioningStatus: "not_started",
    provisionedCustomerId: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    version: 1,
    intakeIdempotencyKey: idempotencyKey,
    intakeBodyHash: bodyHash,
  };

  await insertDemoRequest(env.DB, record, {
    id: newId("devent"),
    requestId: id,
    occurredAt: now,
    principal: "service:landing",
    action: "demo.submitted",
    correlationId,
    idempotencyHash: await sha256Hex(idempotencyKey),
    metadata: { publicReference: record.publicReference },
  });

  await enqueueEmail(env.DB, {
    id: newId("eml"),
    requestId: id,
    template: "operator_notification",
    toEmail: env.OPERATOR_NOTIFY_EMAIL || "operators@hivarium.dev",
    idempotencyKey: `notify-${id}`,
    createdAt: now,
  });
  await enqueueEmail(env.DB, {
    id: newId("eml"),
    requestId: id,
    template: "customer_ack",
    toEmail: intake.applicantEmail,
    idempotencyKey: `ack-${id}`,
    createdAt: now,
  });

  await drainEmailOutbox(env, {
    operator_notification: operatorNotificationEmail({
      to: env.OPERATOR_NOTIFY_EMAIL || "operators@hivarium.dev",
      reference: record.publicReference,
      organization: record.organizationName,
      applicantEmail: record.applicantEmail,
    }),
    customer_ack: customerAckEmail({
      to: intake.applicantEmail,
      reference: record.publicReference,
      name: intake.applicantName,
    }),
  });

  return { record, replayed: false };
}
