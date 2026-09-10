// The Playwright test runner provides a CommonJS-style `require` for this
// spec, so the suite is written against the classic `@playwright/test` entry.
import { test, expect } from "@playwright/test";

/**
 * Hivarium Operator Console end-to-end operator journeys.
 *
 * Every scenario starts from the canonical deterministic seed. The init script
 * below clears the persisted store on the first document load of a scenario
 * and leaves it untouched on later reloads, so a scenario can prove that a
 * mutation survives a full page refresh. No flow is conditionally skipped:
 * every required control and result is asserted directly.
 */
const STORAGE_KEY = "hivarium.operator-console.store.v1";

test.describe("Hivarium Operator Console E2E", () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript((key) => {
            if (!window.sessionStorage.getItem("__e2e_store_reset__")) {
                window.localStorage.removeItem(key);
                window.sessionStorage.setItem("__e2e_store_reset__", "1");
            }
        }, STORAGE_KEY);
    });

    // -------------------------------------------------------------------------
    // Existing console regression: list, search, navigation, create/edit/delete
    // -------------------------------------------------------------------------

    test("customer list renders the deterministic seed with pagination bounds", async ({ page }) => {
        await page.goto("/");
        await expect(page).toHaveURL(/\/customers$/);

        await expect(page.locator("body")).toContainText(/Showing\s+1[–-]6\s+of\s+6/);
        await expect(page.getByText("Page 1 of 1")).toBeVisible();

        await expect(page.locator('button[aria-label="Previous page"]')).toBeDisabled();
        await expect(page.locator('button[aria-label="Next page"]')).toBeDisabled();
    });

    test("search filters the customer list and handles zero results", async ({ page }) => {
        await page.goto("/customers");
        const search = page.getByTestId("customer-search");

        await search.fill("XYZ123NonExistent");
        await expect(page.getByText("No customers match the current filters.")).toBeVisible();
        await expect(page.locator("body")).toContainText(/Showing\s+0[–-]0\s+of\s+0/);
        await expect(page.getByText("Showing 25-6")).toHaveCount(0);

        await search.fill("Bluepeak");
        await expect(page.getByTestId("customer-row-cust_bluepeak")).toBeVisible();
        await expect(page.getByTestId("customer-row-cust_northwind")).toHaveCount(0);
    });

    test("operator navigates to a customer profile and edits the contact", async ({ page }) => {
        await page.goto("/customers");
        await page.getByTestId("view-cust_bluepeak").click();
        await expect(page).toHaveURL(/\/customers\/cust_bluepeak$/);
        await expect(page.getByTestId("page-title")).toHaveText("Bluepeak Logistics");

        await page.getByTestId("edit-customer-button").click();
        await expect(page).toHaveURL(/\/customers\/cust_bluepeak\/edit$/);
        await expect(page.getByTestId("page-title")).toHaveText("Edit Bluepeak Logistics");

        await page.getByLabel("Contact name").fill("Space Contact");
        await page.getByTestId("submit-customer").click();

        await expect(page).toHaveURL(/\/customers\/cust_bluepeak$/);
        await expect(page.getByTestId("page-title")).toHaveText("Bluepeak Logistics");
        await expect(page.getByTestId("panel-overview")).toContainText("Space Contact");
    });

    test("operator creates a customer and deletes it with confirmation", async ({ page }) => {
        await page.goto("/customers/new");
        await page.getByLabel("Company name").fill("E2E Rocket Co");
        await page.getByLabel("Email domain").fill("e2erocket.example");
        await page.getByLabel("Contact name").fill("Ada Lovelace");
        await page.getByLabel("Contact email").fill("ada@e2erocket.example");
        await page.getByTestId("submit-customer").click();

        await expect(page).toHaveURL(/\/customers\/cust_e2e_rocket_co$/);
        await expect(page.getByTestId("page-title")).toHaveText("E2E Rocket Co");

        await page.getByTestId("back-to-customers").click();
        await expect(page).toHaveURL(/\/customers$/);
        await page.getByTestId("customer-search").fill("E2E Rocket");
        await expect(page.getByTestId("customer-row-cust_e2e_rocket_co")).toBeVisible();

        await page.getByTestId("delete-cust_e2e_rocket_co").click();
        const dialog = page.getByTestId("delete-customer-dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText("Delete E2E Rocket Co?");
        await expect(dialog).toContainText("This action cannot be undone.");

        await page.getByTestId("confirm-delete-cust_e2e_rocket_co").click();
        await expect(page.getByTestId("customer-row-cust_e2e_rocket_co")).toHaveCount(0);
    });

    // -------------------------------------------------------------------------
    // One complete flow per commercial model
    // -------------------------------------------------------------------------

    test("sets a monthly commercial model and persists it after reload", async ({ page }) => {
        await page.goto("/customers/cust_greyharbor");
        await expect(page.getByTestId("overview-summary-band")).toContainText("No commercial model");

        await page.getByTestId("overview-commercial-action").click();
        const sheet = page.getByTestId("commercial-sheet");
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole("heading", { name: "Set commercial model" })).toBeVisible();

        await page.getByTestId("monthly-amount").fill("199");
        await page.getByTestId("renews-at").fill("2027-01-01");
        await page.getByTestId("arrangement-reason").fill("E2E monthly arrangement");
        await page.getByTestId("submit-commercial-arrangement").click();

        await expect(page.getByText("Commercial model started")).toBeVisible();
        await expect(sheet).toHaveCount(0);

        await page.getByTestId("tab-commercial").click();
        await expect(page.getByTestId("active-arrangement")).toContainText("Monthly");
        await expect(page.getByTestId("active-arrangement")).toContainText("$199.00");

        await page.reload();
        await page.getByTestId("tab-commercial").click();
        await expect(page.getByTestId("active-arrangement")).toContainText("$199.00");
    });

    test("sets a prepaid commercial model and persists it after reload", async ({ page }) => {
        await page.goto("/customers/cust_greyharbor");
        await page.getByTestId("overview-commercial-action").click();
        const sheet = page.getByTestId("commercial-sheet");
        await expect(sheet).toBeVisible();

        await page.locator('label[for="commercial-model-prepaid"]').click();
        await page.getByTestId("prepaid-balance").fill("500");
        await page.getByTestId("arrangement-reason").fill("E2E prepaid balance");
        await page.getByTestId("submit-commercial-arrangement").click();

        await expect(page.getByText("Commercial model started")).toBeVisible();
        await expect(sheet).toHaveCount(0);

        await page.getByTestId("tab-commercial").click();
        await expect(page.getByTestId("active-arrangement")).toContainText("Prepaid");
        await expect(page.getByTestId("active-arrangement")).toContainText("$500.00");

        await page.reload();
        await page.getByTestId("tab-commercial").click();
        await expect(page.getByTestId("active-arrangement")).toContainText("$500.00");
    });

    test("sets an annual commercial model and persists it after reload", async ({ page }) => {
        await page.goto("/customers/cust_greyharbor");
        await page.getByTestId("overview-commercial-action").click();
        const sheet = page.getByTestId("commercial-sheet");
        await expect(sheet).toBeVisible();

        await page.locator('label[for="commercial-model-annual"]').click();
        await page.getByTestId("annual-value").fill("12000");
        await page.getByTestId("annual-start").fill("2026-01-01");
        await page.getByTestId("annual-end").fill("2027-01-01");
        await page.getByTestId("annual-allowance").fill("100000");
        await page.getByTestId("annual-overage").fill("0.02");
        await page.getByTestId("arrangement-reason").fill("E2E annual contract");
        await page.getByTestId("submit-commercial-arrangement").click();

        await expect(page.getByText("Commercial model started")).toBeVisible();
        await expect(sheet).toHaveCount(0);

        await page.getByTestId("tab-commercial").click();
        await expect(page.getByTestId("active-arrangement")).toContainText("Annual contract");
        await expect(page.getByTestId("active-arrangement")).toContainText("$12000.00");

        await page.reload();
        await page.getByTestId("tab-commercial").click();
        await expect(page.getByTestId("active-arrangement")).toContainText("$12000.00");
    });

    // -------------------------------------------------------------------------
    // Scheduled commercial transitions
    // -------------------------------------------------------------------------

    test("schedules a commercial transition and keeps the current arrangement active", async ({ page }) => {
        await page.goto("/customers/cust_northwind");
        await page.getByTestId("overview-commercial-action").click();
        const sheet = page.getByTestId("commercial-sheet");
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole("heading", { name: "Change commercial model" })).toBeVisible();

        await page.locator('label[for="commercial-effective-scheduled"]').click();
        await page.getByTestId("effective-date").fill("2026-12-01");
        await page.getByTestId("monthly-amount").fill("249");
        await page.getByTestId("renews-at").fill("2027-12-01");
        await page.getByTestId("arrangement-reason").fill("E2E scheduled upgrade");
        await page.getByTestId("submit-commercial-arrangement").click();

        await expect(page.getByText("Commercial model scheduled")).toBeVisible();
        await expect(sheet).toHaveCount(0);

        await page.getByTestId("tab-commercial").click();
        const scheduled = page.getByTestId("scheduled-change");
        await expect(scheduled).toContainText("Scheduled change");
        await expect(scheduled).toContainText(/Effective (Dec 1|Nov 30), 2026/);
        await expect(scheduled).toContainText("Monthly");
        await expect(page.getByTestId("active-arrangement")).toContainText("$149.00");

        await page.reload();
        await page.getByTestId("tab-commercial").click();
        await expect(page.getByTestId("scheduled-change")).toContainText(/Effective (Dec 1|Nov 30), 2026/);
        await expect(page.getByTestId("active-arrangement")).toContainText("$149.00");
    });

    test("shows the seeded scheduled change before its effective boundary", async ({ page }) => {
        await page.goto("/customers/cust_meridians");
        await page.getByTestId("tab-commercial").click();
        await expect(page.getByTestId("active-arrangement")).toContainText("Prepaid");

        const scheduled = page.getByTestId("scheduled-change");
        await expect(scheduled).toContainText("Scheduled change");
        await expect(scheduled).toContainText(/Effective (Dec 1|Nov 30), 2026/);
        await expect(scheduled).toContainText("Monthly");
        await expect(page.getByTestId("review-scheduled-change")).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // Agent access: grant, scheduled revoke, immediate revoke
    // -------------------------------------------------------------------------

    test("grants agent access immediately and persists it after reload", async ({ page }) => {
        await page.goto("/customers/cust_sablefin");
        await page.getByTestId("tab-agent-access").click();
        await expect(page.getByTestId("panel-agent-access")).toContainText(
            "No agents are available to this customer"
        );

        await page.getByTestId("grant-agent-access").click();
        const sheet = page.getByTestId("access-sheet");
        await expect(sheet).toBeVisible();

        await page.getByTestId("agent-option-agent_courier").click();
        await page.getByTestId("access-reason").fill("E2E grant");
        await page.getByTestId("submit-agent-access").click();

        await expect(page.getByText("Agent access granted")).toBeVisible();
        await expect(sheet).toHaveCount(0);
        await expect(page.getByTestId("panel-agent-access")).toContainText("Courier");

        await page.reload();
        await page.getByTestId("tab-agent-access").click();
        await expect(page.getByTestId("panel-agent-access")).toContainText("Courier");
    });

    test("schedules an access revocation and keeps current access", async ({ page }) => {
        await page.goto("/customers/cust_northwind");
        await page.getByTestId("tab-agent-access").click();

        await page
            .getByTestId("grant-grant_lic_northwind_courier")
            .getByRole("button", { name: "Revoke access" })
            .click();
        await expect(page.getByText("Revoke Courier access for Northwind Trading?")).toBeVisible();

        await page.locator('label[for="revoke-scheduled"]').click();
        await page.getByTestId("revoke-date").fill("2026-12-01");
        await page.getByTestId("revoke-reason").fill("E2E scheduled offboarding");
        await page.getByRole("button", { name: "Schedule revocation" }).click();

        await expect(page.getByText("Agent access revocation scheduled")).toBeVisible();
        await expect(page.getByTestId("grant-grant_lic_northwind_courier")).toContainText(
            /Revocation scheduled (Dec 1|Nov 30), 2026/
        );

        await page.reload();
        await page.getByTestId("tab-agent-access").click();
        await expect(page.getByTestId("grant-grant_lic_northwind_courier")).toContainText(
            /Revocation scheduled (Dec 1|Nov 30), 2026/
        );
    });

    test("revokes access immediately and retains the record in history", async ({ page }) => {
        await page.goto("/customers/cust_northwind");
        await page.getByTestId("tab-agent-access").click();

        await page
            .getByTestId("grant-grant_lic_northwind_courier")
            .getByRole("button", { name: "Revoke access" })
            .click();
        await expect(page.getByText("Revoke Courier access for Northwind Trading?")).toBeVisible();
        await expect(page.getByText("The access record will remain in history.")).toBeVisible();

        await page.getByTestId("revoke-reason").fill("E2E immediate revoke");
        await page.getByRole("button", { name: "Revoke agent access" }).click();

        await expect(page.getByText("Agent access revoked")).toBeVisible();
        await expect(page.getByTestId("panel-agent-access")).toContainText("Access history");
        await expect(page.getByTestId("grant-grant_lic_northwind_courier")).toContainText("revoked");
        await expect(
            page
                .getByTestId("grant-grant_lic_northwind_courier")
                .getByRole("button", { name: "Revoke access" })
        ).toHaveCount(0);

        await page.reload();
        await page.getByTestId("tab-agent-access").click();
        await expect(page.getByTestId("grant-grant_lic_northwind_courier")).toContainText("revoked");
    });

    // -------------------------------------------------------------------------
    // Termination naming, grant count, and linked Activity evidence
    // -------------------------------------------------------------------------

    test("termination names the customer and discloses the active grant count", async ({ page }) => {
        await page.goto("/customers/cust_northwind");
        await page.getByTestId("tab-commercial").click();
        await page.getByTestId("terminate-arrangement").click();

        await expect(page.getByText("Terminate Monthly for Northwind Trading?")).toBeVisible();
        await expect(
            page.getByText("2 active agent access grants will be revoked and recorded in Activity.")
        ).toBeVisible();

        await page.getByRole("button", { name: "Keep arrangement" }).click();
        await expect(page.getByText("Terminate Monthly for Northwind Trading?")).toHaveCount(0);
        await expect(page.getByTestId("active-arrangement")).toBeVisible();
    });

    test("termination revokes access and records separate linked activity entries", async ({ page }) => {
        await page.goto("/customers/cust_meridians");
        await page.getByTestId("tab-commercial").click();
        await page.getByTestId("terminate-arrangement").click();

        await expect(page.getByText("Terminate Prepaid for Meridians Health?")).toBeVisible();
        await expect(
            page.getByText("1 active agent access grant will be revoked and recorded in Activity.")
        ).toBeVisible();

        await page.getByTestId("terminate-reason").fill("E2E termination");
        await page.getByRole("button", { name: "Terminate and revoke access" }).click();

        await expect(page.getByText("Commercial arrangement terminated")).toBeVisible();
        await expect(page.getByTestId("active-arrangement")).toHaveCount(0);
        await expect(page.getByTestId("panel-commercial")).toContainText("No commercial model is active");

        await page.getByTestId("tab-activity").click();
        await expect(page.getByTestId("panel-activity")).toContainText(
            "Terminated prepaid commercial arrangement."
        );
        // The commercial termination and the automatic revocation are separate
        // entries in the same timeline.
        await expect(page.getByTestId("activity-evt_arr_meridians_prepaid_terminated")).toBeVisible();
        await expect(page.getByTestId("activity-evt_grant_meridians_sentinel_revoked")).toBeVisible();

        const cause = page.getByTestId("activity-cause-evt_grant_meridians_sentinel_revoked");
        await expect(cause).toContainText("Automatic");
        await expect(cause).toContainText("Terminated prepaid commercial arrangement.");
    });

    // -------------------------------------------------------------------------
    // Catalog to agent detail to customer profile (reverse navigation)
    // -------------------------------------------------------------------------

    test("navigates from the agent catalog to agent detail to the customer profile", async ({ page }) => {
        await page.goto("/agents");
        await expect(page.getByTestId("page-title")).toHaveText("Agent Catalog");

        await page.getByTestId("agent-link-agent_sentinel").click();
        await expect(page).toHaveURL(/\/agents\/agent_sentinel$/);
        await expect(page.getByTestId("page-title")).toHaveText("Sentinel");
        await expect(page.getByTestId("agent-detail-card")).toContainText("agent_sentinel");
        await expect(page.getByTestId("agent-detail-card")).toContainText(
            "Autonomous security triage agent"
        );
        await expect(page.getByTestId("agent-customer-access")).toContainText("Meridians Health");

        await page.getByTestId("agent-access-link-grant_meridians_sentinel").click();
        await expect(page).toHaveURL(/\/customers\/cust_meridians$/);
        await expect(page.getByTestId("page-title")).toHaveText("Meridians Health");
    });
});
