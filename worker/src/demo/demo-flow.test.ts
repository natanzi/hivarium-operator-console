import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import schemaSql from "../../../migrations/0001_initial.sql?raw";
import demoSql from "../../../migrations/0002_demo_requests.sql?raw";
import evalSql from "../../../migrations/0003_demo_evaluation_config.sql?raw";
import type { Env } from "../app";
import { intakeDemoRequest } from "./intake";
import { handleLandingDemoIntake, handleOperatorDemoApi } from "./http";
import { memoryEmails, resetMemoryEmails } from "./outbox";
import { getDemoRequest, listDemoEvents } from "./store";
import { getCustomer, seedCatalog } from "../db";
import { stableCustomerId } from "../../../src/domain/demo-request";

declare module "*.sql?raw" {
  const sql: string;
  export default sql;
}

function prepareSchema(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("--");
    })
    .join(" ");
}

function fakePortal(): Fetcher {
  return {
    fetch: async () =>
      new Response(JSON.stringify({ membershipId: "mbr_demo", replayed: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  } as Fetcher;
}

function testEnv(): Env {
  resetMemoryEmails();
  return {
    DB: env.DB,
    ASSETS: undefined as unknown as Fetcher,
    LICENSE_SERVICE: fakePortal(),
    CUSTOMER_PORTAL_SERVICE: fakePortal(),
    LICENSE_SERVICE_TOKEN: "license-out",
    PORTAL_SERVICE_TOKEN: "portal-out",
    PORTAL_CALLER_TOKEN: "portal-in",
    LANDING_CALLER_TOKEN: "landing-in",
    EMAIL_PROVIDER_API_KEY: "test://memory",
    EMAIL_FROM_ADDRESS: "noreply@hivarium.test",
    EMAIL_REPLY_TO: "hello@hivarium.test",
    OPERATOR_NOTIFY_EMAIL: "ops@hivarium.test",
    CUSTOMER_PORTAL_URL: "https://portal.example.test",
    AGENT_WORKSPACE_URL: "https://agents.example.test",
    ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
    ACCESS_AUD: "aud",
    AUTHORIZED_OPERATOR_EMAIL: "operator@hivarium.test",
  };
}

const operator = { email: "operator@hivarium.test", sub: "op_1", name: "Operator" };

const intakeBody = {
  applicantName: "Ada Lovelace",
  applicantEmail: "ada@acme.example",
  organizationName: "Acme Research",
  organizationDomain: "acme.example",
  roleTitle: "CTO",
  useCase: "Evaluate private agent governance for an internal research lab.",
  deploymentPreference: "on_premises",
  expectedAgentCount: "1-5",
  requestedAgentIds: ["ai_governance"],
  technicalRequirements: "Air-gapped lab network",
  infrastructureNotes: "Air-gapped lab",
  timeline: "This quarter",
  additionalDetails: "Evaluation only",
  consent: true,
};

beforeEach(async () => {
  await env.DB.exec(`
    DROP TRIGGER IF EXISTS demo_request_events_no_update;
    DROP TRIGGER IF EXISTS demo_request_events_no_delete;
    DROP TABLE IF EXISTS demo_email_outbox;
    DROP TABLE IF EXISTS demo_provisioning_jobs;
    DROP TABLE IF EXISTS demo_request_events;
    DROP TABLE IF EXISTS demo_requests;
  `);
  await env.DB.exec(prepareSchema(schemaSql));
  await env.DB.exec(prepareSchema(demoSql));
  const evalStatements = evalSql
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("--");
    })
    .join("\n");
  for (const statement of evalStatements.split(";")) {
    const trimmed = statement.trim();
    if (!trimmed) continue;
    try {
      await env.DB.exec(trimmed);
    } catch (error) {
      if (!String(error).includes("duplicate column name")) throw error;
    }
  }
  await seedCatalog(env.DB);
});

describe("demo request intake", () => {
  it("creates a request, audit event, and email outbox rows", async () => {
    const envx = testEnv();
    const result = await intakeDemoRequest(envx, intakeBody, "idemkey01", "corr-1");
    expect(result.replayed).toBe(false);
    expect(result.record.status).toBe("submitted");
    expect(result.record.applicantEmail).toBe("ada@acme.example");
    const events = await listDemoEvents(envx.DB, result.record.id);
    expect(events.map((event) => event.action)).toEqual(["demo.submitted"]);
    expect(memoryEmails().some((email) => email.template === "operator_notification")).toBe(true);
    expect(memoryEmails().some((email) => email.template === "customer_ack")).toBe(true);
  });

  it("replays identical intake and conflicts on payload change", async () => {
    const envx = testEnv();
    const first = await intakeDemoRequest(envx, intakeBody, "idemkey01", "corr-1");
    const replay = await intakeDemoRequest(envx, intakeBody, "idemkey01", "corr-2");
    expect(replay.record.id).toBe(first.record.id);
    expect(replay.replayed).toBe(true);
    await expect(intakeDemoRequest(envx, { ...intakeBody, useCase: "Different" }, "idemkey01", "corr-3")).rejects.toMatchObject({
      status: 409,
    });
  });

  it("rejects landing calls without a configured token", async () => {
    const envx = testEnv();
    delete envx.LANDING_CALLER_TOKEN;
    const response = await handleLandingDemoIntake(
      new Request("https://ops.test/service/v1/demo-requests", {
        method: "POST",
        headers: { Authorization: "Bearer landing-in", "Content-Type": "application/json" },
        body: JSON.stringify({ ...intakeBody, idempotencyKey: "idemkey01" }),
      }),
      envx,
    ).catch((error) => error);
    expect(response.status).toBe(503);
  });

  it("rejects the opposite-direction token", async () => {
    const envx = testEnv();
    await expect(
      handleLandingDemoIntake(
        new Request("https://ops.test/service/v1/demo-requests", {
          method: "POST",
          headers: { Authorization: "Bearer portal-in", "Content-Type": "application/json" },
          body: JSON.stringify({ ...intakeBody, idempotencyKey: "idemkey01" }),
        }),
        envx,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("demo request operator lifecycle", () => {
  it("enforces transitions, optimistic concurrency, approval, and no duplicate customer", async () => {
    const envx = testEnv();
    const created = await intakeDemoRequest(envx, intakeBody, "idemkey02", "corr-1");
    expect(await getCustomer(envx.DB, stableCustomerId(created.record.id))).toBeNull();
    const url = new URL(`https://ops.test/api/demo-requests/${created.record.id}/transition`);

    const start = await handleOperatorDemoApi(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start_review", version: created.record.version, idempotencyKey: "decision-start-01" }),
      }),
      envx,
      url,
      ["api", "demo-requests", created.record.id, "transition"],
      operator,
    );
    expect(start.status).toBe(200);
    const reviewing = (await start.json()) as { request: { version: number; status: string } };
    expect(reviewing.request.status).toBe("under_review");

    const stale = await handleOperatorDemoApi(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", version: created.record.version, idempotencyKey: "decision-stale-01" }),
      }),
      envx,
      url,
      ["api", "demo-requests", created.record.id, "transition"],
      operator,
    ).catch((error) => error);
    expect(stale.status).toBe(409);

    const illegal = await handleOperatorDemoApi(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", version: reviewing.request.version, idempotencyKey: "decision-retry-01" }),
      }),
      envx,
      url,
      ["api", "demo-requests", created.record.id, "transition"],
      operator,
    ).catch((error) => error);
    expect(illegal.status).toBe(409);

    const approved = await handleOperatorDemoApi(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", version: reviewing.request.version, idempotencyKey: "decision-approve-01" }),
      }),
      envx,
      url,
      ["api", "demo-requests", created.record.id, "transition"],
      operator,
    );
    expect(approved.status).toBe(200);
    const active = (await approved.json()) as { request: { status: string; provisioning: { customerId: string } } };
    expect(active.request.status).toBe("active");
    const customerId = active.request.provisioning.customerId;
    expect(customerId).toBe(`demo_${created.record.id}`);
    expect(await getCustomer(envx.DB, customerId)).toMatchObject({
      status: "evaluation",
      originDemoRequestId: created.record.id,
    });
    expect(memoryEmails().find((email) => email.template === "customer_welcome")?.text).toContain("https://agents.example.test");
    expect(memoryEmails().find((email) => email.template === "customer_welcome")?.text.toLowerCase()).not.toMatch(/password:|bearer |jwt/);

    const replay = await handleOperatorDemoApi(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", version: 99, idempotencyKey: "decision-approve-01" }),
      }),
      envx,
      url,
      ["api", "demo-requests", created.record.id, "transition"],
      operator,
    );
    const replayed = (await replay.json()) as { request: { provisioning: { customerId: string } } };
    expect(replayed.request.provisioning.customerId).toBe(customerId);
    expect(memoryEmails().filter((email) => email.template === "customer_welcome")).toHaveLength(1);
    expect(memoryEmails().find((email) => email.template === "customer_welcome")?.text).toContain("https://portal.example.test");
    expect(memoryEmails().find((email) => email.template === "customer_welcome")?.text).not.toContain("portal.hivarium.dev");

    const events = await listDemoEvents(envx.DB, created.record.id);
    expect(events.some((event) => event.action === "demo.active")).toBe(true);
    const stored = await getDemoRequest(envx.DB, created.record.id);
    expect(stored?.status).toBe("active");
  });

  it("keeps the operator customer and retries portal membership without duplicates", async () => {
    let portalCalls = 0;
    const flakyPortal = {
      fetch: async () => {
        portalCalls += 1;
        if (portalCalls === 1) {
          return new Response("portal unavailable", { status: 503 });
        }
        return new Response(JSON.stringify({ membershipId: "mbr_demo", replayed: portalCalls > 2 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    } as Fetcher;
    const envx = testEnv();
    envx.CUSTOMER_PORTAL_SERVICE = flakyPortal;
    const created = await intakeDemoRequest(envx, intakeBody, "idemkey03", "corr-1");
    const url = new URL(`https://ops.test/api/demo-requests/${created.record.id}/transition`);
    const start = await handleOperatorDemoApi(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start_review", version: created.record.version, idempotencyKey: "start-03" }),
      }),
      envx,
      url,
      ["api", "demo-requests", created.record.id, "transition"],
      operator,
    );
    const reviewing = (await start.json()) as { request: { version: number } };
    const failed = await handleOperatorDemoApi(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", version: reviewing.request.version, idempotencyKey: "approve-03" }),
      }),
      envx,
      url,
      ["api", "demo-requests", created.record.id, "transition"],
      operator,
    ).catch((error) => error);
    expect(failed.status).toBe(502);
    const afterFail = await getDemoRequest(envx.DB, created.record.id);
    expect(afterFail?.status).toBe("provisioning_failed");
    expect(await getCustomer(envx.DB, `demo_${created.record.id}`)).toBeTruthy();
    expect(memoryEmails().filter((email) => email.template === "customer_welcome")).toHaveLength(0);

    const retried = await handleOperatorDemoApi(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", version: afterFail!.version, idempotencyKey: "retry-03" }),
      }),
      envx,
      url,
      ["api", "demo-requests", created.record.id, "transition"],
      operator,
    );
    expect(retried.status).toBe(200);
    const active = (await retried.json()) as { request: { status: string } };
    expect(active.request.status).toBe("active");
    expect(memoryEmails().filter((email) => email.template === "customer_welcome")).toHaveLength(1);
    const customers = await envx.DB.prepare("SELECT COUNT(*) as n FROM customers WHERE id = ?")
      .bind(`demo_${created.record.id}`)
      .first<{ n: number }>();
    expect(customers?.n).toBe(1);
  });

  it("keeps provisioning durable when CUSTOMER_PORTAL_URL is missing and does not send a welcome email", async () => {
    const envx = testEnv();
    delete envx.CUSTOMER_PORTAL_URL;
    const created = await intakeDemoRequest(envx, intakeBody, "idemkey04", "corr-1");
    const url = new URL(`https://ops.test/api/demo-requests/${created.record.id}/transition`);
    const start = await handleOperatorDemoApi(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start_review", version: created.record.version, idempotencyKey: "start-04" }),
      }),
      envx,
      url,
      ["api", "demo-requests", created.record.id, "transition"],
      operator,
    );
    const reviewing = (await start.json()) as { request: { version: number } };
    const approved = await handleOperatorDemoApi(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", version: reviewing.request.version, idempotencyKey: "approve-04" }),
      }),
      envx,
      url,
      ["api", "demo-requests", created.record.id, "transition"],
      operator,
    );
    expect(approved.status).toBe(200);
    expect(((await approved.json()) as { request: { status: string } }).request.status).toBe("active");
    expect(memoryEmails().filter((email) => email.template === "customer_welcome")).toHaveLength(0);
    const outbox = await envx.DB.prepare(
      "SELECT status, last_error_code FROM demo_email_outbox WHERE template = 'customer_welcome' AND request_id = ?",
    )
      .bind(created.record.id)
      .first<{ status: string; last_error_code: string }>();
    expect(outbox).toMatchObject({ status: "failed", last_error_code: "portal_url_unconfigured" });
  });

  it("does not mutate the original submission when proposed configuration is saved", async () => {
    const envx = testEnv();
    const created = await intakeDemoRequest(envx, intakeBody, "idemkey05", "corr-1");
    const configUrl = new URL(`https://ops.test/api/demo-requests/${created.record.id}/configuration`);
    const saved = await handleOperatorDemoApi(
      new Request(configUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: created.record.version,
          customerName: "Renamed Evaluation Co",
          administratorEmail: "ops-admin@acme.example",
        }),
      }),
      envx,
      configUrl,
      ["api", "demo-requests", created.record.id, "configuration"],
      operator,
    );
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as {
      request: { original: { organizationName: string; useCase: string }; proposed: { customerName: string } };
    };
    expect(body.request.original.organizationName).toBe("Acme Research");
    expect(body.request.original.useCase).toBe(intakeBody.useCase);
    expect(body.request.proposed.customerName).toBe("Renamed Evaluation Co");
  });

  it("retries a failed welcome email without rolling back the customer", async () => {
    const envx = testEnv();
    envx.EMAIL_PROVIDER_API_KEY = "resend-secret";
    envx.EMAIL_FROM_ADDRESS = "Hivarium Access <access@hivarium.test>";
    envx.EMAIL_REPLY_TO = "access@hivarium.test";
    const fetchMock = vi.fn(async () => new Response("provider down", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const created = await intakeDemoRequest(envx, intakeBody, "idemkey06", "corr-1");
    const url = new URL(`https://ops.test/api/demo-requests/${created.record.id}/transition`);
    const start = await handleOperatorDemoApi(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start_review", version: created.record.version, idempotencyKey: "start-06" }),
      }),
      envx,
      url,
      ["api", "demo-requests", created.record.id, "transition"],
      operator,
    );
    const reviewing = (await start.json()) as { request: { version: number } };
    const approved = await handleOperatorDemoApi(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", version: reviewing.request.version, idempotencyKey: "approve-06" }),
      }),
      envx,
      url,
      ["api", "demo-requests", created.record.id, "transition"],
      operator,
    );
    expect(approved.status).toBe(200);
    const active = (await approved.json()) as { request: { version: number; provisioning: { welcomeEmailStatus: string; customerId: string } } };
    expect(active.request.provisioning.welcomeEmailStatus).toBe("failed");
    expect(await getCustomer(envx.DB, active.request.provisioning.customerId)).toBeTruthy();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "re_ok" }), { status: 200 }));
    const retryUrl = new URL(`https://ops.test/api/demo-requests/${created.record.id}/welcome-email`);
    const retried = await handleOperatorDemoApi(
      new Request(retryUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: active.request.version }),
      }),
      envx,
      retryUrl,
      ["api", "demo-requests", created.record.id, "welcome-email"],
      operator,
    );
    expect(retried.status).toBe(200);
    expect(((await retried.json()) as { request: { provisioning: { welcomeEmailStatus: string } } }).request.provisioning.welcomeEmailStatus).toBe("sent");
    vi.unstubAllGlobals();
  });
});
