export const DEFAULT_EMAIL_PROVIDER_URL = "https://api.resend.com/emails";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  template: string;
  requestReference: string;
}

export interface EmailGateway {
  send(message: EmailMessage): Promise<{ id: string }>;
}

export class MemoryEmailGateway implements EmailGateway {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<{ id: string }> {
    this.sent.push(message);
    return { id: `mem_${this.sent.length}` };
  }
}

export interface HttpEmailGatewayConfig {
  apiKey: string;
  from: string;
  replyTo: string;
  endpoint: string;
}

export class HttpEmailGateway implements EmailGateway {
  constructor(private readonly config: HttpEmailGatewayConfig) {}

  async send(message: EmailMessage): Promise<{ id: string }> {
    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.config.from,
        reply_to: this.config.replyTo,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
    if (!response.ok) {
      throw new Error(`email_provider_${response.status}`);
    }
    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return { id: typeof body.id === "string" ? body.id : "provider" };
  }
}

function escapeText(value: string): string {
  return [...value]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || code >= 32;
    })
    .join("");
}

/** Public portal origin for customer-facing email copy. Returns null when unset or invalid. */
export function resolveCustomerPortalUrl(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return `${parsed.origin}${path}`;
  } catch {
    return null;
  }
}

export function resolveOptionalHttpsUrl(value: string | undefined): string | null {
  return resolveCustomerPortalUrl(value);
}

export function operatorNotificationEmail(input: {
  to: string;
  reference: string;
  organization: string;
  applicantEmail: string;
}): EmailMessage {
  return {
    to: input.to,
    template: "operator_notification",
    requestReference: input.reference,
    subject: `Demo evaluation request ${input.reference}`,
    text: escapeText(
      [
        `A research/evaluation demo request was submitted.`,
        `Reference: ${input.reference}`,
        `Organization: ${input.organization}`,
        `Applicant: ${input.applicantEmail}`,
        `This is not a purchase. Review it in the Operator Console Demo Requests list.`,
      ].join("\n"),
    ),
  };
}

export function customerAckEmail(input: { to: string; reference: string; name: string }): EmailMessage {
  return {
    to: input.to,
    template: "customer_ack",
    requestReference: input.reference,
    subject: `We received your Hivarium evaluation request (${input.reference})`,
    text: escapeText(
      [
        `Hello ${input.name},`,
        `We received your request for a Hivarium research/evaluation workspace.`,
        `Reference: ${input.reference}`,
        `This is not automatic account creation and not a purchase. An operator will review the request.`,
        `If approved, you will receive a separate welcome message with portal access instructions.`,
      ].join("\n"),
    ),
  };
}

export function customerWelcomeEmail(input: {
  to: string;
  name: string;
  organization: string;
  reference: string;
  proposed: {
    demoStartAt: string;
    demoExpiresAt: string;
    deploymentModel: string;
    maxAgentCount: string;
    enabledFeatures: string[];
    permittedAgentIds: string[];
  };
  portalUrl: string | undefined;
  workspaceUrl: string | undefined;
}): EmailMessage | null {
  const portalUrl = resolveCustomerPortalUrl(input.portalUrl);
  if (!portalUrl) return null;
  const workspaceUrl = resolveOptionalHttpsUrl(input.workspaceUrl);
  const lines = [
    `Hello ${input.name},`,
    `Your Hivarium evaluation workspace is ready.`,
    `Organization: ${input.organization}`,
    `Request reference: ${input.reference}`,
    `Evaluation status: active`,
    `Evaluation start: ${input.proposed.demoStartAt}`,
    `Evaluation expiration: ${input.proposed.demoExpiresAt}`,
    `Approved deployment model: ${input.proposed.deploymentModel}`,
    `Approved agent capacity: ${input.proposed.maxAgentCount || "not specified"}`,
    `Enabled agents/features: ${[...input.proposed.enabledFeatures, ...input.proposed.permittedAgentIds].join(", ") || "evaluation workspace"}`,
    `Customer Portal: ${portalUrl}`,
    `Customer Portal purpose: View your organization, evaluation configuration, licenses, usage, access and service requests.`,
  ];
  if (workspaceUrl) {
    lines.push(`Agent Workspace: ${workspaceUrl}`);
    lines.push(`Agent Workspace purpose: Launch, observe and interact with the agents enabled for your evaluation.`);
  }
  lines.push(
    `Sign in using the same email address that received this message. Cloudflare Access will send a one-time verification code. No password is included in this email.`,
    `Reply to this message if you need help from Hivarium.`,
  );
  return {
    to: input.to,
    template: "customer_welcome",
    requestReference: input.reference,
    subject: "Your Hivarium evaluation workspace is ready",
    text: escapeText(lines.join("\n")),
  };
}

export function needsInformationEmail(input: { to: string; reference: string; name: string; note: string }): EmailMessage {
  return {
    to: input.to,
    template: "needs_information",
    requestReference: input.reference,
    subject: `More information needed for ${input.reference}`,
    text: escapeText(
      [
        `Hello ${input.name},`,
        `An operator needs more information about evaluation request ${input.reference}.`,
        input.note,
        `This is not a billing notice.`,
      ].join("\n"),
    ),
  };
}

export function rejectionEmail(input: { to: string; reference: string; name: string; note: string }): EmailMessage {
  return {
    to: input.to,
    template: "rejected",
    requestReference: input.reference,
    subject: `Update on evaluation request ${input.reference}`,
    text: escapeText(
      [
        `Hello ${input.name},`,
        `Evaluation request ${input.reference} was not approved.`,
        input.note,
        `This is not a commercial decision about a paid product.`,
      ].join("\n"),
    ),
  };
}
