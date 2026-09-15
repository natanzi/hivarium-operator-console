import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EMAIL_PROVIDER_URL,
  HttpEmailGateway,
  customerWelcomeEmail,
  resolveCustomerPortalUrl,
} from "./email";
import { emailGatewayFor } from "./outbox";
import type { Env } from "../app";

const proposed = {
  demoStartAt: "2026-09-14T00:00:00.000Z",
  demoExpiresAt: "2026-10-14T00:00:00.000Z",
  deploymentModel: "on_premises",
  maxAgentCount: "1-5",
  enabledFeatures: ["evaluation_workspace"],
  permittedAgentIds: ["ai_governance"],
};

describe("resolveCustomerPortalUrl", () => {
  it("normalizes a configured portal origin and rejects empty values", () => {
    expect(resolveCustomerPortalUrl("https://portal.hivarium.dev/")).toBe("https://portal.hivarium.dev");
    expect(resolveCustomerPortalUrl("")).toBeNull();
    expect(resolveCustomerPortalUrl(undefined)).toBeNull();
    expect(resolveCustomerPortalUrl("not-a-url")).toBeNull();
  });
});

describe("customerWelcomeEmail", () => {
  it("embeds CUSTOMER_PORTAL_URL, omits workspace unless configured, and never includes secrets", () => {
    const withoutWorkspace = customerWelcomeEmail({
      to: "ada@acme.example",
      name: "Ada",
      organization: "Acme",
      reference: "HV-1",
      proposed,
      portalUrl: "https://portal.example.test/",
      workspaceUrl: undefined,
    });
    expect(withoutWorkspace?.subject).toBe("Your Hivarium demo workspace is ready");
    expect(withoutWorkspace?.text).toContain("https://portal.example.test");
    expect(withoutWorkspace?.text).toContain("one-time verification code");
    expect(withoutWorkspace?.text).not.toContain("Agent Workspace:");
    expect(withoutWorkspace?.text).not.toContain("portal.hivarium.dev");
    expect(withoutWorkspace?.text.toLowerCase()).not.toContain("password:");
    expect(withoutWorkspace?.text.toLowerCase()).not.toContain("bearer");
    expect(withoutWorkspace?.text.toLowerCase()).not.toContain("jwt");
    const withWorkspace = customerWelcomeEmail({
      to: "ada@acme.example",
      name: "Ada",
      organization: "Acme",
      reference: "HV-1",
      proposed,
      portalUrl: "https://portal.example.test/",
      workspaceUrl: "https://agents.example.test/",
    });
    expect(withWorkspace?.text).toContain("https://agents.example.test");
    expect(
      customerWelcomeEmail({
        to: "ada@acme.example",
        name: "Ada",
        organization: "Acme",
        reference: "HV-1",
        proposed,
        portalUrl: undefined,
        workspaceUrl: "https://agents.example.test",
      }),
    ).toBeNull();
  });
});

describe("HttpEmailGateway", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts Resend fields from, reply_to, to, subject, and text", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(DEFAULT_EMAIL_PROVIDER_URL);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toEqual({
        from: "Hivarium Access <access@hivarium.test>",
        reply_to: "access@hivarium.test",
        to: ["ada@acme.example"],
        subject: "Your Hivarium demo workspace is ready",
        text: "Sign in at https://portal.example.test",
      });
      const auth = new Headers(init?.headers).get("Authorization");
      expect(auth).toBe("Bearer resend-secret");
      return new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const gateway = new HttpEmailGateway({
      apiKey: "resend-secret",
      from: "Hivarium Access <access@hivarium.test>",
      replyTo: "access@hivarium.test",
      endpoint: DEFAULT_EMAIL_PROVIDER_URL,
    });
    const sent = await gateway.send({
      to: "ada@acme.example",
      subject: "Your Hivarium demo workspace is ready",
      text: "Sign in at https://portal.example.test",
      template: "customer_welcome",
      requestReference: "HV-1",
    });
    expect(sent.id).toBe("re_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("builds the HTTP gateway from env from, reply_to, and default Resend URL", () => {
    const gateway = emailGatewayFor({
      EMAIL_PROVIDER_API_KEY: "resend-secret",
      EMAIL_FROM_ADDRESS: "noreply@hivarium.test",
      EMAIL_REPLY_TO: "hello@hivarium.test",
    } as Env);
    expect(gateway).toBeInstanceOf(HttpEmailGateway);
    expect(emailGatewayFor({ EMAIL_PROVIDER_API_KEY: "resend-secret", EMAIL_FROM_ADDRESS: "noreply@hivarium.test" } as Env)).toBeNull();
  });
});
