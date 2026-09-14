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
    test.beforeEach(async ({ request }) => {
        const res = await request.post("/api/e2e/reset");
        const body = await res.text();
        expect(res.ok(), body).toBeTruthy();
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
        const bodyText = await page.locator("body").innerText();
        console.error("BODY TEXT AT TEST 2:", bodyText);
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

        await page.getByLabel(/Contact name/i).fill("Space Contact");
        await page.getByTestId("submit-customer").click();

        await expect(page).toHaveURL(/\/customers\/cust_bluepeak$/);
        await expect(page.getByTestId("page-title")).toHaveText("Bluepeak Logistics");
        await expect(page.getByTestId("panel-overview")).toContainText("Space Contact");
    });

    test("operator creates a customer and archives it with confirmation", async ({ page }) => {
        await page.goto("/customers/new");
        await page.getByLabel(/Company name/i).fill("E2E Rocket Co");
        await page.getByLabel(/Email domain/i).fill("e2erocket.example");
        await page.getByLabel(/Contact name/i).fill("Ada Lovelace");
        await page.getByLabel(/Contact email/i).fill("ada@e2erocket.example");
        await page.getByTestId("submit-customer").click();

        await expect(page).toHaveURL(/\/customers\/cust_e2e_rocket_co$/);
        await expect(page.getByTestId("page-title")).toHaveText("E2E Rocket Co");

        await page.getByTestId("back-to-customers").click();
        await expect(page).toHaveURL(/\/customers$/);
        await page.getByTestId("customer-search").fill("E2E Rocket");
        await expect(page.getByTestId("customer-row-cust_e2e_rocket_co")).toBeVisible();

        // 1. One click never archives immediately.
        await page.getByTestId("archive-cust_e2e_rocket_co").click();
        const dialog = page.getByTestId("archive-customer-dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText("Archive E2E Rocket Co?");
        await expect(dialog).toContainText("All contracts, agent-access history, ledger transactions, and usage records will be retained and remain available. The customer will leave the working list.");

        // 2. Cancel preserves the customer
        await page.getByRole("button", { name: /Cancel/i }).click();
        await expect(dialog).toBeHidden();
        await expect(page.getByTestId("archive-cust_e2e_rocket_co")).toBeFocused();
        await expect(page.getByTestId("customer-row-cust_e2e_rocket_co")).toBeVisible();

        // 3. Confirmation archives the customer
        await page.getByTestId("archive-cust_e2e_rocket_co").click();
        await page.getByTestId("confirm-archive-cust_e2e_rocket_co").click();
        await expect(page.getByTestId("customer-row-cust_e2e_rocket_co")).toHaveCount(0); // hidden from default list

        // 4. Archived customer remains accessible (direct URL)
        await page.goto("/customers/cust_e2e_rocket_co");
        await expect(page.getByTestId("page-title")).toHaveText("E2E Rocket Co");
        await expect(page.getByText("Archived", { exact: true })).toBeVisible();

        // 5. Prohibited new mutations are unavailable
        await expect(page.getByTestId("edit-customer-button")).toHaveCount(0);
        await expect(page.getByTestId("record-usage-button")).toHaveCount(0);
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
        await page.getByTestId("arrangement-reason").fill("E2E prepaid balance");
        await page.getByTestId("submit-commercial-arrangement").click();

        await expect(page.getByText("Commercial model started")).toBeVisible();
        await expect(sheet).toHaveCount(0);

        // A new prepaid account starts with an empty derived balance and the
        // default 100-token warning threshold; there is no editable balance.
        await expect(page.getByTestId("overview-summary-band")).toContainText("0 tokens");
        await expect(page.getByTestId("overview-summary-band")).toContainText(
            "Warning at 100 tokens or below"
        );

        await page.getByTestId("tab-commercial").click();
        await expect(page.getByTestId("active-arrangement")).toContainText("Prepaid");
        await expect(page.getByTestId("active-arrangement")).toContainText("0 tokens");
        await expect(page.getByTestId("active-arrangement")).toContainText("100 tokens");

        await page.reload();
        await page.getByTestId("tab-commercial").click();
        await expect(page.getByTestId("active-arrangement")).toContainText("0 tokens");
        await expect(page.getByTestId("active-arrangement")).toContainText("100 tokens");
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

    // -------------------------------------------------------------------------
    // Credit tracer: confirmed Add token credit persists balance and statement
    // -------------------------------------------------------------------------

    test("confirmed credit tracer persists balance and statement after reload", async ({ page }) => {
        await page.goto("/customers/cust_meridians");
        await page.getByTestId("tab-commercial").click();

        const card = page.getByTestId("active-arrangement");
        await expect(card).toContainText("250,000 tokens");
        await expect(card).toContainText("100 tokens");
        await expect(card).toContainText("Derived from 6 immutable transactions");

        await page.getByRole("button", { name: "Add credit" }).click();
        const sheet = page.getByTestId("add-credit-sheet");
        await expect(sheet).toBeVisible();

        await page.getByTestId("credit-amount").fill("5000");
        await page.getByTestId("credit-reference").fill("E2E credit tracer");
        await expect(page.getByTestId("resulting-balance")).toContainText("255,000 tokens");
        await page.getByTestId("review-credit").click();

        const confirmation = page.getByTestId("credit-confirmation");
        await expect(confirmation).toBeVisible();
        await expect(confirmation).toContainText("Add 5,000 tokens to Meridians Health?");
        await expect(confirmation).toContainText(
            "The balance will change from 250,000 tokens to 255,000 tokens."
        );

        await page.getByTestId("confirm-add-credit").click();

        await expect(page.getByText("Token credit added")).toBeVisible();
        await expect(sheet).toHaveCount(0);
        await expect(card).toContainText("255,000 tokens");
        await expect(card).toContainText("Derived from 7 immutable transactions");

        await page.reload();
        await page.getByTestId("tab-commercial").click();
        await expect(page.getByTestId("active-arrangement")).toContainText("255,000 tokens");
        await expect(page.getByTestId("active-arrangement")).toContainText(
            "Derived from 7 immutable transactions"
        );
    });

    // -------------------------------------------------------------------------
    // Low-balance badge appears in the customer list and profile
    // -------------------------------------------------------------------------

    test("low-balance badge appears in list and profile after threshold edit", async ({ page }) => {
        await page.goto("/customers/cust_meridians");
        await page.getByTestId("tab-commercial").click();

        await page.getByRole("button", { name: "Edit threshold" }).click();
        const sheet = page.getByTestId("edit-threshold-sheet");
        await expect(sheet).toBeVisible();

        await page.getByTestId("threshold-tokens").fill("300000");
        await page.getByTestId("save-threshold").click();

        await expect(page.getByText("Warning threshold updated")).toBeVisible();
        await expect(sheet).toHaveCount(0);

        // The profile Overview and Commercial surfaces both flag the account.
        await page.getByTestId("tab-overview").click();
        await expect(page.getByTestId("overview-summary-band")).toContainText("Low balance");

        await page.getByTestId("tab-commercial").click();
        await expect(page.getByTestId("active-arrangement")).toContainText("Low balance");

        // The customer list row carries the badge with accessible balance and
        // threshold text.
        await page.getByTestId("back-to-customers").click();
        await expect(page).toHaveURL(/\/customers$/);
        const row = page.getByTestId("customer-row-cust_meridians");
        await expect(row).toContainText("Low balance");
        await expect(row).toContainText("250,000 tokens");
        await expect(row).toContainText("300,000 tokens");
    });

    // -------------------------------------------------------------------------
    // Usage and corrections: atomic debit, idempotent replay, conflict, single
    // reversal, and insufficient-balance block (02-02 Task 3)
    // -------------------------------------------------------------------------

    test("usage debit is atomic, idempotent, and conflict-safe", async ({ page }) => {
        await page.goto("/customers/cust_meridians");
        await page.getByTestId("tab-activity").click();
        await expect(page.getByTestId("panel-activity")).toContainText("250,000 tokens");

        // First debit: record 1,200 tokens for Sentinel through the named
        // customer confirmation and assert the reduced derived balance.
        await page.getByTestId("record-usage").click();
        const sheet = page.getByTestId("record-usage-sheet");
        await expect(sheet).toBeVisible();
        await expect(sheet).toContainText("Available balance");
        await expect(sheet).toContainText("250,000 tokens");

        await page.getByTestId("usage-agent-trigger").click();
        await page.getByTestId("usage-agent-option-agent_sentinel").click();
        await page.getByTestId("usage-tokens").fill("1200");
        await page.getByTestId("usage-source-reference").fill("e2e_usage_atomic_001");
        await expect(page.getByTestId("usage-resulting-balance")).toContainText(
            "248,800 tokens"
        );

        await page.getByTestId("review-usage").click();
        const confirmation = page.getByTestId("usage-confirmation");
        await expect(confirmation).toBeVisible();
        await expect(confirmation).toContainText(
            "Record 1,200 tokens of usage for Meridians Health?"
        );
        await expect(confirmation).toContainText("Sentinel will consume 1,200 tokens.");
        await expect(confirmation).toContainText("Source reference: e2e_usage_atomic_001");
        await expect(confirmation).toContainText(
            "The balance will change from 250,000 tokens to 248,800 tokens."
        );

        await page.getByTestId("confirm-record-usage").click();
        await expect(page.getByText("Usage recorded")).toBeVisible();
        await expect(page.getByText("1,200 tokens were deducted for Sentinel.")).toBeVisible();
        await expect(sheet).toHaveCount(0);
        await expect(page.getByTestId("panel-activity")).toContainText("248,800 tokens");

        // The atomic usage+debit write survives a full page refresh.
        await page.reload();
        await page.getByTestId("tab-activity").click();
        await expect(page.getByTestId("panel-activity")).toContainText("248,800 tokens");

        // Exact replay: the identical source reference and values perform no
        // write and announce "Usage already recorded".
        await page.getByTestId("record-usage").click();
        await expect(sheet).toBeVisible();
        await expect(sheet).toContainText("248,800 tokens");
        await page.getByTestId("usage-agent-trigger").click();
        await page.getByTestId("usage-agent-option-agent_sentinel").click();
        await page.getByTestId("usage-tokens").fill("1200");
        await page.getByTestId("usage-source-reference").fill("e2e_usage_atomic_001");
        await page.getByTestId("review-usage").click();
        await page.getByTestId("confirm-record-usage").click();

        await expect(page.getByText("Usage already recorded")).toBeVisible();
        await expect(page.getByText("No additional tokens were deducted.")).toBeVisible();
        await expect(sheet).toHaveCount(0);
        await expect(page.getByTestId("panel-activity")).toContainText("248,800 tokens");

        // Conflicting reuse: the same reference with a different token quantity
        // is rejected with the source-reference conflict and no balance change.
        await page.getByTestId("record-usage").click();
        await expect(sheet).toBeVisible();
        await page.getByTestId("usage-agent-trigger").click();
        await page.getByTestId("usage-agent-option-agent_sentinel").click();
        await page.getByTestId("usage-tokens").fill("2000");
        await page.getByTestId("usage-source-reference").fill("e2e_usage_atomic_001");
        await page.getByTestId("review-usage").click();
        await page.getByTestId("confirm-record-usage").click();

        await expect(page.getByTestId("usage-conflict-message")).toContainText(
            'Source reference "e2e_usage_atomic_001" is already assigned to different usage. Enter a unique source reference or restore the original values.'
        );
        await expect(page.getByTestId("usage-tokens")).toHaveValue("2000");
        await expect(sheet).toContainText("248,800 tokens");
    });

    test("manual adjustment and single reversal with named confirmations", async ({ page }) => {
        await page.goto("/customers/cust_meridians");
        await page.getByTestId("tab-commercial").click();
        await expect(page.getByTestId("active-arrangement")).toContainText("250,000 tokens");

        // Positive manual adjustment through the named-customer confirmation.
        await page.getByTestId("adjust-balance").click();
        const sheet = page.getByTestId("adjustment-sheet");
        await expect(sheet).toBeVisible();
        await expect(sheet).toContainText("Current balance");
        await expect(sheet).toContainText("250,000 tokens");

        await page.getByTestId("adjustment-amount").fill("500");
        await page.getByTestId("adjustment-reference").fill("e2e_adj_add_001");
        await page.getByTestId("adjustment-reason").fill("E2E positive adjustment");
        await expect(page.getByTestId("adjustment-resulting-balance")).toContainText(
            "250,500 tokens"
        );

        await page.getByTestId("review-adjustment").click();
        const confirmation = page.getByTestId("adjustment-confirmation");
        await expect(confirmation).toBeVisible();
        await expect(confirmation).toContainText("Adjust Meridians Health's balance?");
        await expect(confirmation).toContainText("+500 tokens will be applied.");
        await expect(confirmation).toContainText(
            "The balance will change from 250,000 tokens to 250,500 tokens."
        );

        await page.getByTestId("confirm-apply-adjustment").click();
        await expect(page.getByText("Balance adjustment recorded")).toBeVisible();
        await expect(sheet).toHaveCount(0);
        await expect(page.getByTestId("active-arrangement")).toContainText("250,500 tokens");

        // The adjustment persists across a full page refresh.
        await page.reload();
        await page.getByTestId("tab-commercial").click();
        await expect(page.getByTestId("active-arrangement")).toContainText("250,500 tokens");

        // Single full reversal of the adjustment through the named-customer
        // confirmation; the immutable original remains visible.
        await page.getByTestId("tab-activity").click();
        await page.getByTestId("reverse-txn_cust_meridians_adjustment_2026-09-09T00:00:00.000Z").click();
        const reversalSheet = page.getByTestId("reversal-sheet");
        await expect(reversalSheet).toBeVisible();
        const original = page.getByTestId("reversal-original-transaction");
        await expect(original).toContainText("Manual adjustment");
        await expect(original).toContainText("+500 tokens");

        await page.getByTestId("reversal-reference").fill("e2e_rev_adj_001");
        await page.getByTestId("reversal-reason").fill("E2E reversal of adjustment");
        await expect(page.getByTestId("reversal-resulting-balance")).toContainText(
            "250,000 tokens"
        );

        await page.getByTestId("review-reversal").click();
        const reversalConfirmation = page.getByTestId("reversal-confirmation");
        await expect(reversalConfirmation).toBeVisible();
        await expect(reversalConfirmation).toContainText(
            "Reverse this transaction for Meridians Health?"
        );
        await expect(reversalConfirmation).toContainText(
            "The original transaction of +500 tokens will be reversed by −500 tokens."
        );
        await expect(reversalConfirmation).toContainText(
            "The balance will change from 250,500 tokens to 250,000 tokens."
        );
        await expect(reversalConfirmation).toContainText(
            "The original record will remain visible."
        );

        await page.getByTestId("confirm-reverse-transaction").click();
        await expect(page.getByText("Transaction reversed")).toBeVisible();
        await expect(reversalSheet).toHaveCount(0);
        await expect(page.getByTestId("panel-activity")).toContainText("250,000 tokens");

        // The immutable original remains visible, but a reversed transaction is
        // no longer eligible for reversal so the action is not rendered.
        await expect(page.getByTestId("panel-activity")).toContainText("+500 tokens");
        await expect(
            page.getByTestId(
                "reverse-txn_cust_meridians_adjustment_2026-09-09T00:00:00.000Z"
            )
        ).toHaveCount(0);
    });

    test("insufficient balance blocks usage", async ({ page }) => {
        await page.goto("/customers/cust_meridians");
        await page.getByTestId("tab-activity").click();
        await expect(page.getByTestId("panel-activity")).toContainText("250,000 tokens");

        // A debit larger than the available balance is blocked before the final
        // confirmation with the available and attempted token values.
        await page.getByTestId("record-usage").click();
        const sheet = page.getByTestId("record-usage-sheet");
        await expect(sheet).toBeVisible();

        await page.getByTestId("usage-agent-trigger").click();
        await page.getByTestId("usage-agent-option-agent_sentinel").click();
        await page.getByTestId("usage-tokens").fill("300000");
        await page.getByTestId("usage-source-reference").fill("e2e_usage_insufficient_001");
        await page.getByTestId("review-usage").click();

        await expect(page.getByTestId("usage-insufficient-message")).toContainText(
            "Usage was not recorded. Meridians Health has 250,000 tokens available, but this debit requires 300,000 tokens."
        );
        await expect(page.getByTestId("usage-confirmation")).toHaveCount(0);

        // No ledger or usage row was added: discarding the draft leaves the
        // derived balance unchanged.
        await page.getByTestId("discard-usage-draft").click();
        await page
            .getByRole("alertdialog")
            .getByRole("button", { name: "Discard usage draft" })
            .click();
        await expect(sheet).toHaveCount(0);
        await expect(page.getByTestId("panel-activity")).toContainText("250,000 tokens");
    });

    // -------------------------------------------------------------------------
    // Token account statement: running balances, filters, empty-filtered copy,
    // and reversed-usage netting (02-03 Task 3)
    // -------------------------------------------------------------------------

    test("statement renders running balances and survives reload", async ({ page }) => {
        await page.goto("/customers/cust_meridians");
        await page.getByTestId("tab-activity").click();

        const statement = page.getByTestId("token-statement");
        await expect(statement).toBeVisible();
        await expect(statement).toContainText("Token account statement");
        await expect(statement).toContainText("Balance 250,000 tokens");

        // Newest-first rows with signed amounts and full-account resulting
        // balances (never filtered subtotals).
        const rows = statement.locator("tbody tr");
        await expect(rows).toHaveCount(6);

        await expect(rows.nth(0)).toContainText("Credit grant");
        await expect(rows.nth(0)).toContainText("+2,000 tokens");
        await expect(rows.nth(0)).toContainText("250,000 tokens");
        await expect(rows.nth(0)).toContainText("credit_meridians_jul_001");

        await expect(rows.nth(1)).toContainText("Reversal");
        await expect(rows.nth(1)).toContainText("+1,500 tokens");
        await expect(rows.nth(1)).toContainText("248,000 tokens");
        await expect(rows.nth(1)).toContainText("rev_usage_meridians_jun_003");

        await expect(rows.nth(2)).toContainText("Usage debit");
        await expect(rows.nth(2)).toContainText("−1,500 tokens");
        await expect(rows.nth(2)).toContainText("246,500 tokens");
        await expect(rows.nth(2)).toContainText("usage_meridians_jun_003");
        await expect(rows.nth(2)).toContainText("Sentinel");

        await expect(rows.nth(3)).toContainText("Usage debit");
        await expect(rows.nth(3)).toContainText("−800 tokens");
        await expect(rows.nth(3)).toContainText("248,000 tokens");
        await expect(rows.nth(3)).toContainText("usage_meridians_jun_002");
        await expect(rows.nth(3)).toContainText("Mercator");

        await expect(rows.nth(4)).toContainText("Usage debit");
        await expect(rows.nth(4)).toContainText("−1,200 tokens");
        await expect(rows.nth(4)).toContainText("248,800 tokens");
        await expect(rows.nth(4)).toContainText("usage_meridians_may_001");

        await expect(rows.nth(5)).toContainText("Credit grant");
        await expect(rows.nth(5)).toContainText("+250,000 tokens");
        await expect(rows.nth(5)).toContainText("250,000 tokens");
        await expect(rows.nth(5)).toContainText("opening_arr_meridians_prepaid");

        // The statement survives a full page refresh.
        await page.reload();
        await page.getByTestId("tab-activity").click();
        await expect(page.getByTestId("token-statement")).toContainText(
            "Balance 250,000 tokens"
        );
        await expect(
            page.getByTestId("token-statement").locator("tbody tr")
        ).toHaveCount(6);
        await expect(
            page.getByTestId("token-statement").locator("tbody tr").nth(0)
        ).toContainText("credit_meridians_jul_001");
    });

    test("filters narrow the statement and update the selected-period summary", async ({ page }) => {
        await page.goto("/customers/cust_meridians");
        await page.getByTestId("tab-activity").click();

        const statement = page.getByTestId("token-statement");
        const rows = statement.locator("tbody tr");

        // Date range alone: inclusive boundaries keep the June 2 debit and the
        // June 21 reversal visible.
        await page.getByTestId("statement-from").fill("2026-06-02");
        await page.getByTestId("statement-to").fill("2026-06-21");
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0)).toContainText("rev_usage_meridians_jun_003");
        await expect(rows.nth(1)).toContainText("usage_meridians_jun_003");
        await expect(rows.nth(2)).toContainText("usage_meridians_jun_002");
        await expect(page.getByTestId("statement-net-consumed")).toHaveText(
            "−800 tokens"
        );
        await expect(
            page.getByTestId("statement-agent-agent_mercator")
        ).toContainText("Mercator — 800 tokens");
        await expect(
            page.getByTestId("statement-agent-agent_sentinel")
        ).toContainText("Sentinel — 0 tokens");

        // Agent filter alone: only Sentinel usage remains.
        await page.getByTestId("clear-statement-filters").click();
        await page.getByTestId("statement-agent-trigger").click();
        await page.getByTestId("statement-agent-option-agent_sentinel").click();
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(0)).toContainText("usage_meridians_jun_003");
        await expect(rows.nth(1)).toContainText("usage_meridians_may_001");
        await expect(page.getByTestId("statement-net-consumed")).toHaveText(
            "−1,200 tokens"
        );
        await expect(
            page.getByTestId("statement-agent-agent_sentinel")
        ).toContainText("Sentinel — 1,200 tokens");

        // Transaction-type filter alone: only the reversal row remains.
        await page.getByTestId("clear-statement-filters").click();
        await page.getByTestId("statement-type-trigger").click();
        await page.getByTestId("statement-type-option-reversal").click();
        await expect(rows).toHaveCount(1);
        await expect(rows.nth(0)).toContainText("rev_usage_meridians_jun_003");
        await expect(page.getByTestId("statement-net-consumed")).toHaveText(
            "+1,500 tokens"
        );
        await expect(
            page.getByTestId("statement-agent-agent_sentinel")
        ).toContainText("Sentinel — 1,500 tokens");

        // All three filters together: the June 20 Sentinel usage debit only.
        await page.getByTestId("statement-from").fill("2026-06-02");
        await page.getByTestId("statement-to").fill("2026-06-21");
        await page.getByTestId("statement-agent-trigger").click();
        await page.getByTestId("statement-agent-option-agent_sentinel").click();
        await page.getByTestId("statement-type-trigger").click();
        await page.getByTestId("statement-type-option-usage_debit").click();
        await expect(rows).toHaveCount(1);
        await expect(rows.nth(0)).toContainText("usage_meridians_jun_003");
        await expect(rows.nth(0)).toContainText("−1,500 tokens");
        await expect(rows.nth(0)).toContainText("246,500 tokens");
        await expect(page.getByTestId("statement-net-consumed")).toHaveText(
            "−1,500 tokens"
        );
        await expect(
            page.getByTestId("statement-agent-agent_sentinel")
        ).toContainText("Sentinel — 1,500 tokens");

        // Clear filters restores the full statement and the full-period summary.
        await page.getByTestId("clear-statement-filters").click();
        await expect(rows).toHaveCount(6);
        await expect(page.getByTestId("statement-net-consumed")).toHaveText(
            "−2,000 tokens"
        );
        await expect(
            page.getByTestId("statement-agent-agent_sentinel")
        ).toContainText("Sentinel — 1,200 tokens");
        await expect(
            page.getByTestId("statement-agent-agent_mercator")
        ).toContainText("Mercator — 800 tokens");
    });

    test("filters to an empty result show the documented copy", async ({ page }) => {
        await page.goto("/customers/cust_meridians");
        await page.getByTestId("tab-activity").click();

        await page.getByTestId("statement-from").fill("2026-08-01");
        await page.getByTestId("statement-to").fill("2026-08-31");

        const empty = page.getByTestId("statement-empty-filtered");
        await expect(empty).toBeVisible();
        await expect(empty).toContainText("No transactions match these filters");
        await expect(empty).toContainText(
            "Clear one or more filters to review the full token account statement."
        );

        // The current balance and the filter controls remain visible.
        await expect(page.getByTestId("token-statement")).toContainText(
            "Balance 250,000 tokens"
        );
        await expect(page.getByTestId("statement-from")).toBeVisible();
        await expect(page.getByTestId("statement-to")).toBeVisible();

        // Clear filters restores the full statement.
        await page.getByTestId("clear-statement-filters").click();
        await expect(page.getByTestId("statement-empty-filtered")).toHaveCount(0);
        await expect(
            page.getByTestId("token-statement").locator("tbody tr")
        ).toHaveCount(6);
    });

    test("reversed usage nets to zero in the selected period", async ({ page }) => {
        await page.goto("/customers/cust_meridians");
        await page.getByTestId("tab-activity").click();

        // The reversed original row remains visible with a neutral Reversed
        // badge linking to its reversal.
        const reversedBadge = page.getByTestId(
            "reversed-txn_usage_usage_meridians_jun_003"
        );
        await expect(reversedBadge).toBeVisible();
        await expect(reversedBadge).toContainText("Reversed");

        // The reversal row itself names the original transaction reference.
        const reversalRow = page.locator(
            '[data-row-id="txn_reversal_txn_usage_usage_meridians_jun_003"]'
        );
        await expect(reversalRow).toBeVisible();
        await expect(reversalRow).toContainText("Reverses usage_meridians_jun_003");
        await expect(reversalRow).toContainText("+1,500 tokens");

        // The period containing the debit and its reversal nets to zero.
        await page.getByTestId("statement-from").fill("2026-06-20");
        await page.getByTestId("statement-to").fill("2026-06-21");
        await expect(page.getByTestId("statement-net-consumed")).toHaveText(
            "0 tokens"
        );
        await expect(
            page.getByTestId("statement-agent-agent_sentinel")
        ).toContainText("Sentinel — 0 tokens");

        // The reversed original row stays visible inside the filtered period.
        await expect(reversedBadge).toBeVisible();
    });
});
