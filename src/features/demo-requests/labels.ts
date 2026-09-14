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
  not_sure: "Not sure",
};
