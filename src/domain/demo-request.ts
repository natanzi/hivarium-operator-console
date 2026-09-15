/**
 * Demo-request workflow types and transition rules.
 *
 * Canonical values live here. Presentation labels belong in the UI layer.
 * Landing and Portal must not invent additional statuses.
 */

export const DEMO_REQUEST_STATUSES = [
  "submitted",
  "under_review",
  "needs_information",
  "approved",
  "provisioning",
  "active",
  "rejected",
  "expired",
  "provisioning_failed",
] as const;

export type DemoRequestStatus = (typeof DEMO_REQUEST_STATUSES)[number];

export const DEPLOYMENT_PREFERENCES = [
  "hivarium_managed",
  "customer_cloud",
  "private_cloud",
  "on_premises",
  "bare_metal",
  "hybrid",
  "not_sure",
] as const;

export type DeploymentPreference = (typeof DEPLOYMENT_PREFERENCES)[number];

/** Legal status transitions. Unknown combinations are 409. */
export const DEMO_STATUS_TRANSITIONS: Record<DemoRequestStatus, readonly DemoRequestStatus[]> = {
  submitted: ["under_review", "rejected"],
  under_review: ["needs_information", "approved", "rejected"],
  needs_information: ["under_review", "rejected"],
  approved: ["provisioning"],
  provisioning: ["active", "provisioning_failed"],
  provisioning_failed: ["provisioning"],
  active: ["expired"],
  rejected: [],
  expired: [],
};

export function isDemoRequestStatus(value: string): value is DemoRequestStatus {
  return (DEMO_REQUEST_STATUSES as readonly string[]).includes(value);
}

export function isDeploymentPreference(value: string): value is DeploymentPreference {
  return (DEPLOYMENT_PREFERENCES as readonly string[]).includes(value);
}

export function canTransition(from: DemoRequestStatus, to: DemoRequestStatus): boolean {
  return DEMO_STATUS_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: DemoRequestStatus, to: DemoRequestStatus): void {
  if (!canTransition(from, to)) {
    throw new DemoTransitionError(from, to);
  }
}

export class DemoTransitionError extends Error {
  readonly from: DemoRequestStatus;
  readonly to: DemoRequestStatus;
  constructor(from: DemoRequestStatus, to: DemoRequestStatus) {
    super(`Cannot transition demo request from ${from} to ${to}.`);
    this.name = "DemoTransitionError";
    this.from = from;
    this.to = to;
  }
}

export const EXPECTED_AGENT_COUNTS = [
  "1-5",
  "6-25",
  "26-100",
  "101-500",
  "500+",
  "not_sure",
] as const;

export type ExpectedAgentCount = (typeof EXPECTED_AGENT_COUNTS)[number];

export const AGENT_CAPABILITIES = [
  "operations_incident",
  "security_monitoring",
  "data_workflow",
  "customer_support",
  "telecom_network",
  "agent_orchestration",
  "ai_governance",
  "custom_agent",
  "not_sure",
] as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export interface DemoProposedConfig {
  customerName: string;
  customerDomain: string;
  administratorEmail: string;
  demoStartAt: string;
  demoExpiresAt: string;
  deploymentModel: DeploymentPreference;
  maxAgentCount: string;
  enabledFeatures: string[];
  permittedAgentIds: string[];
  tokenAllowance: string;
  portalAccessEnabled: boolean;
  workspaceAccessEnabled: boolean;
  capacityNotes: string;
  customerVisibleNotes: string;
  operatorNotes: string;
}

export interface DemoIntakePayload {
  applicantName: string;
  applicantEmail: string;
  organizationName: string;
  organizationDomain: string;
  roleTitle: string;
  useCase: string;
  deploymentPreference: DeploymentPreference;
  expectedAgentCount: string;
  requestedAgentIds: string[];
  technicalRequirements: string;
  infrastructureNotes: string;
  timeline: string;
  additionalDetails: string;
}

export function defaultProposedConfig(intake: DemoIntakePayload, nowIso: string): DemoProposedConfig {
  const start = nowIso;
  const expires = new Date(Date.parse(nowIso) + 30 * 24 * 60 * 60 * 1000).toISOString();
  return {
    customerName: intake.organizationName,
    customerDomain: intake.organizationDomain,
    administratorEmail: intake.applicantEmail,
    demoStartAt: start,
    demoExpiresAt: expires,
    deploymentModel: intake.deploymentPreference,
    maxAgentCount: intake.expectedAgentCount,
    enabledFeatures: ["evaluation_workspace"],
    permittedAgentIds: [...intake.requestedAgentIds],
    tokenAllowance: "",
    portalAccessEnabled: true,
    workspaceAccessEnabled: false,
    capacityNotes: intake.expectedAgentCount ? `Expected agents: ${intake.expectedAgentCount}` : "",
    customerVisibleNotes: "",
    operatorNotes: "",
  };
}

export function stableCustomerId(requestId: string): string {
  return `demo_${requestId}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function domainFromEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).trim().toLowerCase();
}
