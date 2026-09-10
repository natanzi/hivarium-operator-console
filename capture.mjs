import { chromium } from "playwright";
import path from "path";

(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();

    // Handle console errors for verification
    const errors = [];
    page.on("pageerror", err => errors.push(err.message));
    page.on("console", msg => {
        if (msg.type() === "error") errors.push(msg.text());
    });

    const url = "http://localhost:4173/customers/cust_greyharbor";

    console.log("Navigating to customer profile desktop...");
    await page.goto(url);
    // Wait for the UI to settle
    await page.waitForTimeout(500);

    // 1. Overview tab
    await page.screenshot({ path: ".artifacts/phase-01/customer-overview-1920.png" });

    // 2. Commercial tab
    await page.getByTestId("tab-commercial").click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: ".artifacts/phase-01/commercial-tab-1920.png" });

    // 3. Agent Access tab
    await page.getByTestId("tab-agent-access").click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: ".artifacts/phase-01/agent-access-tab-1920.png" });

    // 4. Activity tab
    await page.getByTestId("tab-activity").click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: ".artifacts/phase-01/activity-tab-1920.png" });

    // 5. Commercial Sheet
    await page.getByTestId("tab-overview").click();
    await page.getByTestId("overview-commercial-action").click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: ".artifacts/phase-01/commercial-sheet-1920.png" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // 6. Agent Detail
    console.log("Navigating to agent detail desktop...");
    await page.goto("http://localhost:4173/agents/agent_sentinel");
    await page.waitForTimeout(500);
    await page.screenshot({ path: ".artifacts/phase-01/agent-detail-1920.png" });

    // Switch to mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    console.log("Navigating to customer profile mobile...");
    await page.goto(url);
    await page.waitForTimeout(500);

    // 7. Customer Profile Mobile
    await page.screenshot({ path: ".artifacts/phase-01/customer-profile-mobile-390.png" });

    // 8. Commercial Sheet Mobile
    await page.getByTestId("tab-overview").click();
    await page.getByTestId("overview-commercial-action").click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: ".artifacts/phase-01/commercial-sheet-mobile-390.png" });

    await browser.close();

    if (errors.length > 0) {
        console.error("Browser console errors detected:", errors);
    } else {
        console.log("No browser console errors detected.");
    }
})();
