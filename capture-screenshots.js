// capture-screenshots.js
import { chromium } from "playwright";
import fs from "fs";

(async () => {
    fs.mkdirSync(".artifacts/phase-03", { recursive: true });
    const browser = await chromium.launch();
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    await page.goto("http://localhost:4173/customers");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: ".artifacts/phase-03/customer-list.png" });

    await page.click("text=Bluepeak Logistics");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: ".artifacts/phase-03/customer-profile.png" });

    await page.goto("http://localhost:4173/customers");
    await page.waitForLoadState("networkidle");
    await page.click('[data-testid="archive-cust_sablefin"]');
    await page.waitForSelector('[data-testid="archive-customer-dialog"]');
    await page.screenshot({ path: ".artifacts/phase-03/archive-dialog.png" });
    await page.click('[data-testid="confirm-archive-cust_sablefin"]');
    await page.waitForTimeout(500);

    await page.goto("http://localhost:4173/customers/cust_sablefin");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: ".artifacts/phase-03/archived-historical-profile.png" });

    await page.goto("http://localhost:4173/customers/cust_bluepeak");
    await page.click('text=Activity');
    await page.waitForTimeout(500);
    await page.screenshot({ path: ".artifacts/phase-03/audit-history.png" });

    await page.route("**/api/customers", route => route.abort());
    await page.goto("http://localhost:4173/customers");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: ".artifacts/phase-03/api-error.png" });
    await page.unroute("**/api/customers");

    const mobileContext = await browser.newContext({
        viewport: { width: 375, height: 667 },
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto("http://localhost:4173/customers/cust_bluepeak");
    await mobilePage.waitForLoadState("networkidle");
    await mobilePage.screenshot({ path: ".artifacts/phase-03/mobile-customer-profile.png" });

    await browser.close();
})();
