import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const ARTIFACTS = path.join(process.cwd(), ".artifacts", "demo-workflow");

const INTAKE = {
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
  idempotencyKey: "e2e-demo-workflow-01",
};

async function shot(page: Page, name: string) {
  await page.screenshot({
    path: path.join(ARTIFACTS, `${name}.png`),
    fullPage: true,
  });
}

test.describe("Demo request visual smoke", () => {
  test.beforeAll(async () => {
    await mkdir(ARTIFACTS, { recursive: true });
  });

  test.beforeEach(async ({ request }) => {
    const res = await request.post("/api/e2e/reset");
    expect(res.ok(), await res.text()).toBeTruthy();
  });

  test("review, approve, and retry-email surfaces at desktop and mobile", async ({ page, request }) => {
    const intake = await request.post("/service/v1/demo-requests", {
      headers: {
        Authorization: "Bearer e2e-landing-in",
        "Content-Type": "application/json",
      },
      data: INTAKE,
    });
    expect(intake.ok(), await intake.text()).toBeTruthy();
    const created = (await intake.json()) as { requestId: string; publicReference: string };
    expect(created.requestId).toBeTruthy();

    const customersBefore = await request.get("/api/customers");
    const beforeBody = (await customersBefore.json()) as { customers: Array<{ id: string }> };
    expect(beforeBody.customers.some((customer) => customer.id.startsWith("demo_"))).toBe(false);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/demo-requests");
    await expect(page.getByTestId(`demo-row-${created.requestId}`)).toBeVisible();
    await expect(page.getByText("Acme Research")).toBeVisible();
    await shot(page, "01-demo-requests-list-desktop");

    await page.getByRole("link", { name: "Review" }).click();
    await expect(page.getByRole("heading", { name: "Original submission" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Proposed evaluation configuration" })).toBeVisible();
    await shot(page, "02-demo-request-detail-desktop");

    await page.getByTestId("start-review").click();
    await page.getByTestId("start-review-dialog-confirm").click();
    await expect(page.getByTestId("demo-status")).toContainText("Under review");
    await expect(page.getByTestId("start-review")).toHaveCount(0);
    await page.getByLabel("Customer display name").fill("Acme Evaluation Workspace");
    await page.getByTestId("save-demo-config").click();
    await expect(page.getByTestId("save-demo-config")).toBeEnabled();
    await expect(page.getByText("Acme Research").first()).toBeVisible();
    await expect(page.getByLabel("Customer display name")).toHaveValue("Acme Evaluation Workspace");
    await shot(page, "03-original-vs-proposed-desktop");

    await page.getByTestId("approve-demo").click();
    await expect(page.getByTestId("approve-summary")).toContainText("Acme Evaluation Workspace");
    await shot(page, "04-approval-dialog-desktop");
    const approveResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/transition") && response.request().method() === "POST",
    );
    await page.getByTestId("approve-dialog-confirm").click();
    const approveResponse = await approveResponsePromise;
    expect(approveResponse.ok(), await approveResponse.text()).toBeTruthy();
    await expect(page.getByTestId("demo-status")).toContainText("Active", { timeout: 30_000 });
    await expect(page.getByTestId("retry-welcome-email")).toBeVisible();
    await shot(page, "05-retry-email-state-desktop");

    const customersAfter = await request.get("/api/customers");
    const afterBody = (await customersAfter.json()) as { customers: Array<{ id: string; originDemoRequestId?: string | null }> };
    const demoCustomers = afterBody.customers.filter((customer) => customer.id === `demo_${created.requestId}`);
    expect(demoCustomers).toHaveLength(1);

    await page.goto(`/customers/demo_${created.requestId}`);
    await expect(page.getByTestId("origin-demo-request")).toBeVisible();
    await shot(page, "06-customer-after-approval-desktop");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/demo-requests");
    const overflowList = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflowList).toBe(false);
    await shot(page, "07-demo-requests-list-mobile");

    await page.goto(`/demo-requests/${created.requestId}`);
    const overflowDetail = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflowDetail).toBe(false);
    await shot(page, "08-demo-request-detail-mobile");
  });
});
