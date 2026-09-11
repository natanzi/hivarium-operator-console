const { test, expect } = require('@playwright/test');
test('debug e2e', async ({ page }) => {
  await page.goto("http://localhost:4173/customers/new");
  await page.getByLabel(/Company name/i).fill("E2E Rocket Co");
  await page.getByLabel(/Email domain/i).fill("e2erocket.example");
  await page.getByLabel(/Contact name/i).fill("Ada Lovelace");
  await page.getByLabel(/Contact email/i).fill("ada@e2erocket.example");
  await page.getByTestId("submit-customer").click();
  await page.waitForURL(/\/customers\/cust_e2e_rocket_co$/);
  
  await page.getByTestId("back-to-customers").click();
  await page.waitForURL(/\/customers$/);
  await page.getByTestId("customer-search").fill("E2E Rocket");
  
  await expect(page.getByTestId("customer-row-cust_e2e_rocket_co")).toBeVisible();
  
  await page.getByTestId("archive-cust_e2e_rocket_co").click();
  const dialog = page.getByTestId("archive-customer-dialog");
  await expect(dialog).toBeVisible();
  
  await page.getByRole("button", { name: /Cancel/i }).click();
  await expect(dialog).toHaveCount(0);
  
  await page.waitForTimeout(500);
  
  const body = await page.evaluate(() => document.body.innerHTML);
  require('fs').writeFileSync('dom-dump.html', body);
});
