import { ApiError } from "../app";
import type { Env } from "../app";
import type { OperatorIdentity } from "../auth";
import { PortalAdapter } from "../adapters/portal";
import {
  buildAuditEntry,
  commitStoreDiff,
  diffStores,
  getCustomer,
  loadCustomerStore,
  seedCatalog,
} from "../db";
import type {
  ActivityEvent,
  AgentAccessGrant,
  Customer,
  FeatureEntitlement,
  PrepaidCommercialArrangement,
} from "../../../src/domain/types";
import { assertTransition, stableCustomerId } from "../../../src/domain/demo-request";
import { customerWelcomeEmail } from "./email";
import { newId, sha256Hex } from "./crypto";
import { drainEmailOutbox } from "./outbox";
import {
  enqueueEmail,
  getDemoRequest,
  proposedFromRecord,
  updateDemoRequestVersioned,
  upsertProvisioningJob,
  type DemoRequestRecord,
} from "./store";

function portalAdapter(env: Env): PortalAdapter {
  return new PortalAdapter(env.CUSTOMER_PORTAL_SERVICE, env.PORTAL_SERVICE_TOKEN, env.CUSTOMER_PORTAL_SERVICE_URL);
}

async function markJob(env: Env, requestId: string, step: string, status: string, error: string, correlationId: string) {
  await upsertProvisioningJob(env.DB, {
    id: `job_${requestId}_${step}`,
    requestId,
    step,
    status,
    attempts: 1,
    lastErrorCode: error,
    correlationId,
  });
}

export async function provisionDemoRequest(
  env: Env,
  identity: OperatorIdentity,
  request: DemoRequestRecord,
  correlationId: string,
  idempotencyKey: string,
): Promise<DemoRequestRecord> {
  if (request.status === "active" && request.provisionedCustomerId) {
    return request;
  }
  if (request.status !== "under_review" && request.status !== "provisioning_failed" && request.status !== "approved") {
    throw new ApiError(409, "conflict", `Cannot provision demo request from ${request.status}.`);
  }

  const now = new Date().toISOString();
  let current = request;
  if (current.status === "under_review") {
    assertTransition("under_review", "approved");
    const approved: DemoRequestRecord = {
      ...current,
      status: "approved",
      approvedBy: identity.email,
      approvedAt: now,
      updatedAt: now,
      version: current.version + 1,
    };
    const ok = await updateDemoRequestVersioned(env.DB, current, approved, {
      id: newId("devent"),
      requestId: current.id,
      occurredAt: now,
      principal: identity.email,
      action: "demo.approved",
      correlationId,
      idempotencyHash: await sha256Hex(idempotencyKey),
      metadata: { version: current.version },
    });
    if (!ok) throw new ApiError(409, "conflict", "Demo request was updated by another operator.");
    current = approved;
  }

  if (current.status === "approved" || current.status === "provisioning_failed") {
    const from = current.status;
    assertTransition(from, "provisioning");
    const provisioning: DemoRequestRecord = {
      ...current,
      status: "provisioning",
      provisioningStatus: "in_progress",
      updatedAt: now,
      version: current.version + 1,
    };
    const ok = await updateDemoRequestVersioned(env.DB, current, provisioning, {
      id: newId("devent"),
      requestId: current.id,
      occurredAt: now,
      principal: identity.email,
      action: "demo.provisioning_started",
      correlationId,
      idempotencyHash: await sha256Hex(`${idempotencyKey}:start`),
      metadata: {},
    });
    if (!ok) throw new ApiError(409, "conflict", "Demo request was updated by another operator.");
    current = provisioning;
  }

  const customerId = current.provisionedCustomerId ?? stableCustomerId(current.id);
  const proposed = proposedFromRecord(current);

  try {
    await markJob(env, current.id, "operator_customer", "pending", "", correlationId);
    await seedCatalog(env.DB);
    const existing = await getCustomer(env.DB, customerId);
    if (!existing) {
      const customer: Customer = {
        id: customerId,
        name: proposed.customerName,
        domain: proposed.customerDomain,
        contact: current.applicantName,
        email: current.applicantEmail,
        status: "evaluation",
        notes: `Evaluation workspace for ${current.publicReference}. Not a commercial contract.`,
        createdAt: now,
      };
      const arrangement: PrepaidCommercialArrangement = {
        id: `arr_${customerId}_eval`,
        customerId,
        status: "active",
        effectiveFrom: proposed.demoStartAt,
        effectiveTo: proposed.demoExpiresAt,
        createdAt: now,
        reason: `Time-limited evaluation for ${current.publicReference}.`,
        replacedByArrangementId: null,
        model: "prepaid",
        warningThresholdTokens: 0,
        expiresAt: proposed.demoExpiresAt,
        notes: proposed.capacityNotes,
      };
      const features: FeatureEntitlement[] = proposed.enabledFeatures.map((feature) => ({
        id: `feat_${customerId}_${feature}`,
        customerId,
        feature,
        description: "Evaluation entitlement",
        grantedAt: now,
        expiresAt: proposed.demoExpiresAt,
      }));
      const grants: AgentAccessGrant[] = [];
      const events: ActivityEvent[] = [];
      for (const agentProductId of proposed.permittedAgentIds) {
        const grantId = `ag_${customerId}_${agentProductId}`;
        const eventId = `act_${grantId}`;
        events.push({
          id: eventId,
          occurredAt: now,
          source: "operator",
          type: "access.granted",
          customerId,
          label: `Granted evaluation access to ${agentProductId}.`,
          subjectId: grantId,
          subjectId2: agentProductId,
          resultingState: "active",
          causationId: undefined,
        });
        grants.push({
          id: grantId,
          customerId,
          agentProductId,
          startsAt: proposed.demoStartAt,
          endsAt: proposed.demoExpiresAt,
          createdAt: now,
          revokedAt: null,
          scheduledRevokeAt: null,
          activityEventId: eventId,
          reasonForChange: `Demo request ${current.publicReference}`,
        });
      }
      const before = await loadCustomerStore(env.DB, customerId);
      const after = {
        ...before,
        customers: [customer],
        commercialArrangements: [...before.commercialArrangements, arrangement],
        featureEntitlements: [...before.featureEntitlements, ...features],
        agentAccessGrants: [...before.agentAccessGrants, ...grants],
        activityEvents: [...before.activityEvents, ...events],
      };
      await commitStoreDiff(
        env.DB,
        diffStores(before, after),
        buildAuditEntry({
          identity,
          action: "demo.customer_provisioned",
          customerId,
          subjectType: "customer",
          subjectId: customerId,
          summary: `Provisioned evaluation customer for ${current.publicReference}.`,
          after: { customerId, reference: current.publicReference },
          occurredAt: now,
        }),
      );
      if (features.length > 0) {
        await env.DB.batch(
          features.map((entitlement) =>
            env.DB.prepare(
              "INSERT OR IGNORE INTO feature_entitlements (id, customer_id, feature, description, granted_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
            ).bind(
              entitlement.id,
              entitlement.customerId,
              entitlement.feature,
              entitlement.description,
              entitlement.grantedAt,
              entitlement.expiresAt,
            ),
          ),
        );
      }
    }
    await markJob(env, current.id, "operator_customer", "succeeded", "", correlationId);

    await markJob(env, current.id, "portal_membership", "pending", "", correlationId);
    await portalAdapter(env).provisionMembership(customerId, current.applicantEmail, {
      displayName: current.applicantName,
      role: "customer_admin",
      status: "active",
      demoExpiresAt: proposed.demoExpiresAt,
      correlationId,
      idempotencyKey: `mbr-${current.id}`,
    });
    await markJob(env, current.id, "portal_membership", "succeeded", "", correlationId);

    const active: DemoRequestRecord = {
      ...current,
      status: "active",
      provisioningStatus: "succeeded",
      provisionedCustomerId: customerId,
      updatedAt: new Date().toISOString(),
      version: current.version + 1,
    };
    const ok = await updateDemoRequestVersioned(env.DB, current, active, {
      id: newId("devent"),
      requestId: current.id,
      occurredAt: active.updatedAt,
      principal: identity.email,
      action: "demo.active",
      correlationId,
      idempotencyHash: await sha256Hex(`${idempotencyKey}:active`),
      metadata: { customerId },
    });
    if (!ok) throw new ApiError(409, "conflict", "Demo request was updated by another operator.");

    await enqueueEmail(env.DB, {
      id: newId("eml"),
      requestId: current.id,
      template: "customer_welcome",
      toEmail: current.applicantEmail,
      idempotencyKey: `welcome-${current.id}`,
      createdAt: active.updatedAt,
    });
    await drainEmailOutbox(env, {
      customer_welcome: customerWelcomeEmail({
        to: current.applicantEmail,
        reference: current.publicReference,
        name: current.applicantName,
      }),
    });
    return (await getDemoRequest(env.DB, current.id)) ?? active;
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "provisioning_failed";
    await markJob(env, current.id, "portal_membership", "failed", code, correlationId);
    const failed: DemoRequestRecord = {
      ...current,
      status: "provisioning_failed",
      provisioningStatus: "failed",
      provisionedCustomerId: customerId,
      updatedAt: new Date().toISOString(),
      version: current.version + 1,
    };
    await updateDemoRequestVersioned(env.DB, current, failed, {
      id: newId("devent"),
      requestId: current.id,
      occurredAt: failed.updatedAt,
      principal: identity.email,
      action: "demo.provisioning_failed",
      correlationId,
      idempotencyHash: await sha256Hex(`${idempotencyKey}:fail`),
      metadata: { code },
    });
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "bad_gateway", "Demo provisioning failed.");
  }
}
