import { ApiError } from "@/data/api-repository";
import type { DemoRequestStatus, DeploymentPreference } from "@/domain/demo-request";

export interface DemoRequestListItem {
  id: string;
  publicReference: string;
  status: DemoRequestStatus;
  organizationName: string;
  applicantName: string;
  applicantEmail: string;
  useCase: string;
  expectedAgentCount: string;
  submittedAt: string;
  deploymentPreference: DeploymentPreference;
  provisioningStatus: string;
}

export interface DemoProposedConfigDto {
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

export interface DemoRequestDetail {
  id: string;
  publicReference: string;
  status: DemoRequestStatus;
  submittedAt: string;
  updatedAt: string;
  version: number;
  original: {
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
  };
  proposed: DemoProposedConfigDto;
  provisioning: {
    status: string;
    customerId: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
    rejectedBy: string | null;
    rejectedAt: string | null;
    welcomeEmailStatus: string;
  };
  events: Array<{
    occurredAt: string;
    principal: string;
    action: string;
    correlationId: string;
    metadata?: Record<string, unknown>;
  }>;
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "object"
  );
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let code = "http-error";
    let message = response.statusText || `Request failed with status ${response.status}.`;
    try {
      const body: unknown = await response.json();
      if (isErrorEnvelope(body)) {
        code = body.error.code;
        message = body.error.message;
      }
    } catch {
      /* keep fallback */
    }
    throw new ApiError(response.status, code, message);
  }
  return (await response.json()) as T;
}

export async function listDemoRequests(filters: {
  status?: string;
  q?: string;
}): Promise<{ items: DemoRequestListItem[]; inboxCount: number }> {
  const params = new URLSearchParams();
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  const query = params.toString();
  const response = await fetch(`/api/demo-requests${query ? `?${query}` : ""}`, {
    cache: "no-store",
  });
  const body = await readJson<{ items: DemoRequestListItem[]; inboxCount?: number }>(response);
  return { items: body.items, inboxCount: body.inboxCount ?? 0 };
}

export async function getDemoRequest(id: string): Promise<DemoRequestDetail> {
  const response = await fetch(`/api/demo-requests/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  const body = await readJson<{ request: DemoRequestDetail }>(response);
  return body.request;
}

export async function retryWelcomeEmail(id: string, version: number): Promise<DemoRequestDetail> {
  const response = await fetch(`/api/demo-requests/${encodeURIComponent(id)}/welcome-email`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version }),
  });
  const body = await readJson<{ request: DemoRequestDetail }>(response);
  return body.request;
}

export async function saveDemoConfiguration(
  id: string,
  version: number,
  proposed: DemoProposedConfigDto,
): Promise<DemoRequestDetail> {
  const response = await fetch(`/api/demo-requests/${encodeURIComponent(id)}/configuration`, {
    method: "PATCH",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version, ...proposed }),
  });
  const body = await readJson<{ request: DemoRequestDetail }>(response);
  return body.request;
}

export async function transitionDemoRequest(
  id: string,
  action: "start_review" | "needs_information" | "reject" | "approve" | "retry",
  version: number,
  note: string,
): Promise<DemoRequestDetail> {
  const response = await fetch(`/api/demo-requests/${encodeURIComponent(id)}/transition`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      version,
      note,
      idempotencyKey: `${action}-${id}-${version}`,
    }),
  });
  const body = await readJson<{ request: DemoRequestDetail }>(response);
  return body.request;
}
