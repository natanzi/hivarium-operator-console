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

export class HttpEmailGateway implements EmailGateway {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly endpoint: string,
  ) {}

  async send(message: EmailMessage): Promise<{ id: string }> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
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

export function customerWelcomeEmail(input: { to: string; reference: string; name: string }): EmailMessage {
  return {
    to: input.to,
    template: "customer_welcome",
    requestReference: input.reference,
    subject: `Your Hivarium evaluation workspace is ready (${input.reference})`,
    text: escapeText(
      [
        `Hello ${input.name},`,
        `Your time-limited Hivarium evaluation workspace is ready.`,
        `Reference: ${input.reference}`,
        `Sign in at https://portal.hivarium.dev using the same approved email address (${input.to}).`,
        `Cloudflare Access will authenticate that email. Portal membership authorizes which workspace you can see.`,
        `This is a research/evaluation workspace, not a commercial subscription or purchase.`,
      ].join("\n"),
    ),
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
