import type { DemoRequestStatus, DeploymentPreference } from "@/domain/demo-request";

export const DEMO_STATUS_LABELS: Record<DemoRequestStatus, string> = {
  submitted: "Submitted",
  under_review: "Under review",
  needs_information: "Needs information",
  approved: "Approved",
  provisioning: "Provisioning",
  active: "Active",
  rejected: "Rejected",
  expired: "Expired",
  provisioning_failed: "Provisioning failed",
};

export const DEPLOYMENT_LABELS: Record<DeploymentPreference, string> = {
  hivarium_managed: "Hivarium-managed evaluation",
  customer_cloud: "Customer cloud",
  private_cloud: "Private cloud",
  on_premises: "On-premises",
  bare_metal: "Bare metal",
  hybrid: "Hybrid",
  not_sure: "Not sure yet",
};

export const AGENT_COUNT_LABELS: Record<string, string> = {
  "1-5": "1–5",
  "6-25": "6–25",
  "26-100": "26–100",
  "101-500": "101–500",
  "500+": "More than 500",
  not_sure: "Not sure yet",
};

export const CAPABILITY_LABELS: Record<string, string> = {
  operations_incident: "Operations and incident response",
  security_monitoring: "Security monitoring and triage",
  data_workflow: "Data and workflow automation",
  customer_support: "Customer support",
  telecom_network: "Telecom/network operations",
  agent_orchestration: "Agent-to-agent orchestration",
  ai_governance: "AI governance and policy enforcement",
  custom_agent: "Custom agent",
  not_sure: "Not sure yet",
};
