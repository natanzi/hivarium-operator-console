import type {
  DemoIntakePayload,
  DemoProposedConfig,
  DemoRequestStatus,
  DeploymentPreference,
} from "../../../src/domain/demo-request";

export interface DemoRequestRecord {
  id: string;
  publicReference: string;
  status: DemoRequestStatus;
  submittedAt: string;
  updatedAt: string;
  applicantName: string;
  applicantEmail: string;
  organizationName: string;
  organizationDomain: string;
  roleTitle: string;
  useCase: string;
  deploymentPreference: DeploymentPreference;
  expectedAgentCount: string;
  requestedAgentIds: string[];
  infrastructureNotes: string;
  timeline: string;
  additionalDetails: string;
  operatorNotes: string;
  customerVisibleNotes: string;
  proposedCustomerName: string;
  proposedCustomerDomain: string;
  proposedDeploymentModel: DeploymentPreference;
  proposedFeatures: string[];
  proposedAgentIds: string[];
  proposedCapacityNotes: string;
  demoStartAt: string;
  demoExpiresAt: string;
  provisioningStatus: string;
  provisionedCustomerId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  version: number;
  intakeIdempotencyKey: string;
  intakeBodyHash: string;
}

export interface DemoRequestEventRecord {
  id: string;
  requestId: string;
  occurredAt: string;
  principal: string;
  action: string;
  correlationId: string;
  idempotencyHash: string;
  metadata: Record<string, unknown>;
}

interface DemoRequestRow {
  id: string;
  public_reference: string;
  status: string;
  submitted_at: string;
  updated_at: string;
  applicant_name: string;
  applicant_email: string;
  organization_name: string;
  organization_domain: string;
  role_title: string;
  use_case: string;
  deployment_preference: string;
  expected_agent_count: string;
  requested_agent_ids_json: string;
  infrastructure_notes: string;
  timeline: string;
  additional_details: string;
  operator_notes: string;
  customer_visible_notes: string;
  proposed_customer_name: string;
  proposed_customer_domain: string;
  proposed_deployment_model: string;
  proposed_features_json: string;
  proposed_agent_ids_json: string;
  proposed_capacity_notes: string;
  demo_start_at: string;
  demo_expires_at: string;
  provisioning_status: string;
  provisioned_customer_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  version: number;
  intake_idempotency_key: string;
  intake_body_hash: string;
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function mapDemoRequest(row: DemoRequestRow): DemoRequestRecord {
  return {
    id: row.id,
    publicReference: row.public_reference,
    status: row.status as DemoRequestStatus,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    applicantName: row.applicant_name,
    applicantEmail: row.applicant_email,
    organizationName: row.organization_name,
    organizationDomain: row.organization_domain,
    roleTitle: row.role_title,
    useCase: row.use_case,
    deploymentPreference: row.deployment_preference as DeploymentPreference,
    expectedAgentCount: row.expected_agent_count,
    requestedAgentIds: parseJsonArray(row.requested_agent_ids_json),
    infrastructureNotes: row.infrastructure_notes,
    timeline: row.timeline,
    additionalDetails: row.additional_details,
    operatorNotes: row.operator_notes,
    customerVisibleNotes: row.customer_visible_notes,
    proposedCustomerName: row.proposed_customer_name,
    proposedCustomerDomain: row.proposed_customer_domain,
    proposedDeploymentModel: row.proposed_deployment_model as DeploymentPreference,
    proposedFeatures: parseJsonArray(row.proposed_features_json),
    proposedAgentIds: parseJsonArray(row.proposed_agent_ids_json),
    proposedCapacityNotes: row.proposed_capacity_notes,
    demoStartAt: row.demo_start_at,
    demoExpiresAt: row.demo_expires_at,
    provisioningStatus: row.provisioning_status,
    provisionedCustomerId: row.provisioned_customer_id,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    rejectedBy: row.rejected_by,
    rejectedAt: row.rejected_at,
    version: row.version,
    intakeIdempotencyKey: row.intake_idempotency_key,
    intakeBodyHash: row.intake_body_hash,
  };
}

export function proposedFromRecord(row: DemoRequestRecord): DemoProposedConfig {
  return {
    customerName: row.proposedCustomerName,
    customerDomain: row.proposedCustomerDomain,
    demoStartAt: row.demoStartAt,
    demoExpiresAt: row.demoExpiresAt,
    deploymentModel: row.proposedDeploymentModel,
    enabledFeatures: row.proposedFeatures,
    permittedAgentIds: row.proposedAgentIds,
    capacityNotes: row.proposedCapacityNotes,
    customerVisibleNotes: row.customerVisibleNotes,
    operatorNotes: row.operatorNotes,
  };
}

const SELECT_REQUEST = `SELECT * FROM demo_requests`;

export async function getDemoRequest(db: D1Database, id: string): Promise<DemoRequestRecord | null> {
  const row = await db.prepare(`${SELECT_REQUEST} WHERE id = ?1`).bind(id).first<DemoRequestRow>();
  return row ? mapDemoRequest(row) : null;
}

export async function getDemoRequestByIdempotency(
  db: D1Database,
  key: string,
): Promise<DemoRequestRecord | null> {
  const row = await db
    .prepare(`${SELECT_REQUEST} WHERE intake_idempotency_key = ?1`)
    .bind(key)
    .first<DemoRequestRow>();
  return row ? mapDemoRequest(row) : null;
}

export async function listDemoRequests(
  db: D1Database,
  filters: { status?: string; q?: string },
): Promise<DemoRequestRecord[]> {
  const clauses: string[] = [];
  const binds: string[] = [];
  if (filters.status) {
    clauses.push("status = ?");
    binds.push(filters.status);
  }
  if (filters.q) {
    const like = `%${filters.q.toLowerCase()}%`;
    clauses.push(
      "(lower(organization_name) LIKE ? OR lower(applicant_name) LIKE ? OR lower(applicant_email) LIKE ?)",
    );
    binds.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await db
    .prepare(`${SELECT_REQUEST} ${where} ORDER BY submitted_at DESC, id DESC LIMIT 200`)
    .bind(...binds)
    .all<DemoRequestRow>();
  return result.results.map(mapDemoRequest);
}

export async function insertDemoRequest(
  db: D1Database,
  record: DemoRequestRecord,
  event: DemoRequestEventRecord,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO demo_requests (
          id, public_reference, status, submitted_at, updated_at,
          applicant_name, applicant_email, organization_name, organization_domain,
          role_title, use_case, deployment_preference, expected_agent_count,
          requested_agent_ids_json, infrastructure_notes, timeline, additional_details,
          operator_notes, customer_visible_notes, proposed_customer_name, proposed_customer_domain,
          proposed_deployment_model, proposed_features_json, proposed_agent_ids_json,
          proposed_capacity_notes, demo_start_at, demo_expires_at, provisioning_status,
          provisioned_customer_id, approved_by, approved_at, rejected_by, rejected_at,
          version, intake_idempotency_key, intake_body_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.id,
        record.publicReference,
        record.status,
        record.submittedAt,
        record.updatedAt,
        record.applicantName,
        record.applicantEmail,
        record.organizationName,
        record.organizationDomain,
        record.roleTitle,
        record.useCase,
        record.deploymentPreference,
        record.expectedAgentCount,
        JSON.stringify(record.requestedAgentIds),
        record.infrastructureNotes,
        record.timeline,
        record.additionalDetails,
        record.operatorNotes,
        record.customerVisibleNotes,
        record.proposedCustomerName,
        record.proposedCustomerDomain,
        record.proposedDeploymentModel,
        JSON.stringify(record.proposedFeatures),
        JSON.stringify(record.proposedAgentIds),
        record.proposedCapacityNotes,
        record.demoStartAt,
        record.demoExpiresAt,
        record.provisioningStatus,
        record.provisionedCustomerId,
        record.approvedBy,
        record.approvedAt,
        record.rejectedBy,
        record.rejectedAt,
        record.version,
        record.intakeIdempotencyKey,
        record.intakeBodyHash,
      ),
    insertEventStatement(db, event),
  ]);
}

export function insertEventStatement(db: D1Database, event: DemoRequestEventRecord): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO demo_request_events (
        id, request_id, occurred_at, principal, action, correlation_id, idempotency_hash, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      event.id,
      event.requestId,
      event.occurredAt,
      event.principal,
      event.action,
      event.correlationId,
      event.idempotencyHash,
      JSON.stringify(event.metadata),
    );
}

export async function listDemoEvents(db: D1Database, requestId: string): Promise<DemoRequestEventRecord[]> {
  const result = await db
    .prepare(
      `SELECT id, request_id, occurred_at, principal, action, correlation_id, idempotency_hash, metadata_json
       FROM demo_request_events WHERE request_id = ?1 ORDER BY occurred_at ASC, id ASC`,
    )
    .bind(requestId)
    .all<{
      id: string;
      request_id: string;
      occurred_at: string;
      principal: string;
      action: string;
      correlation_id: string;
      idempotency_hash: string;
      metadata_json: string;
    }>();
  return result.results.map((row) => ({
    id: row.id,
    requestId: row.request_id,
    occurredAt: row.occurred_at,
    principal: row.principal,
    action: row.action,
    correlationId: row.correlation_id,
    idempotencyHash: row.idempotency_hash,
    metadata: JSON.parse(row.metadata_json || "{}") as Record<string, unknown>,
  }));
}

export async function updateDemoRequestVersioned(
  db: D1Database,
  current: DemoRequestRecord,
  next: DemoRequestRecord,
  event: DemoRequestEventRecord,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE demo_requests SET
        status = ?, updated_at = ?, operator_notes = ?, customer_visible_notes = ?,
        proposed_customer_name = ?, proposed_customer_domain = ?, proposed_deployment_model = ?,
        proposed_features_json = ?, proposed_agent_ids_json = ?, proposed_capacity_notes = ?,
        demo_start_at = ?, demo_expires_at = ?, provisioning_status = ?, provisioned_customer_id = ?,
        approved_by = ?, approved_at = ?, rejected_by = ?, rejected_at = ?, version = ?
       WHERE id = ? AND version = ?`,
    )
    .bind(
      next.status,
      next.updatedAt,
      next.operatorNotes,
      next.customerVisibleNotes,
      next.proposedCustomerName,
      next.proposedCustomerDomain,
      next.proposedDeploymentModel,
      JSON.stringify(next.proposedFeatures),
      JSON.stringify(next.proposedAgentIds),
      next.proposedCapacityNotes,
      next.demoStartAt,
      next.demoExpiresAt,
      next.provisioningStatus,
      next.provisionedCustomerId,
      next.approvedBy,
      next.approvedAt,
      next.rejectedBy,
      next.rejectedAt,
      next.version,
      current.id,
      current.version,
    )
    .run();
  if (result.meta.changes !== 1) return false;
  await db.batch([insertEventStatement(db, event)]);
  return true;
}

export async function enqueueEmail(
  db: D1Database,
  row: {
    id: string;
    requestId: string;
    template: string;
    toEmail: string;
    idempotencyKey: string;
    createdAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO demo_email_outbox (
        id, request_id, template, to_email, status, attempts, last_error_code,
        provider_message_id, idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', 0, '', '', ?, ?, ?)`,
    )
    .bind(row.id, row.requestId, row.template, row.toEmail, row.idempotencyKey, row.createdAt, row.createdAt)
    .run();
}

export async function listPendingEmails(db: D1Database, limit = 20) {
  const result = await db
    .prepare(
      `SELECT id, request_id, template, to_email, status, attempts, last_error_code, idempotency_key
       FROM demo_email_outbox WHERE status IN ('pending', 'failed') ORDER BY created_at ASC LIMIT ?1`,
    )
    .bind(limit)
    .all<{
      id: string;
      request_id: string;
      template: string;
      to_email: string;
      status: string;
      attempts: number;
      last_error_code: string;
      idempotency_key: string;
    }>();
  return result.results;
}

export async function markEmailSent(db: D1Database, id: string, messageId: string, now: string): Promise<void> {
  await db
    .prepare(
      `UPDATE demo_email_outbox SET status = 'sent', provider_message_id = ?, updated_at = ?, attempts = attempts + 1 WHERE id = ?`,
    )
    .bind(messageId, now, id)
    .run();
}

export async function markEmailFailed(db: D1Database, id: string, code: string, now: string): Promise<void> {
  await db
    .prepare(
      `UPDATE demo_email_outbox SET status = 'failed', last_error_code = ?, updated_at = ?, attempts = attempts + 1 WHERE id = ?`,
    )
    .bind(code, now, id)
    .run();
}

export async function upsertProvisioningJob(
  db: D1Database,
  job: { id: string; requestId: string; step: string; status: string; attempts: number; lastErrorCode: string; correlationId: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO demo_provisioning_jobs (id, request_id, step, status, attempts, last_error_code, next_retry_at, correlation_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(request_id, step) DO UPDATE SET
         status = excluded.status,
         attempts = excluded.attempts,
         last_error_code = excluded.last_error_code,
         correlation_id = excluded.correlation_id`,
    )
    .bind(job.id, job.requestId, job.step, job.status, job.attempts, job.lastErrorCode, job.correlationId)
    .run();
}

export function publicReferenceFromId(id: string): string {
  const compact = id.replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase();
  return `HV-DEMO-${compact || "00000000"}`;
}

export function intakeFromRecord(record: DemoRequestRecord): DemoIntakePayload {
  return {
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
  };
}
