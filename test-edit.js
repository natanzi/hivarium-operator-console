const { test, expect } = require('@playwright/test');
test('debug e2e', async ({ page }) => {
  await page.goto("http://localhost:4173/customers");
  await page.getByTestId("view-cust_bluepeak").click();
  await page.getByTestId("edit-customer-button").click();
  await page.getByLabel(/Contact name/i).fill("Space Contact");
  await page.getByTestId("submit-customer").click();
  await page.waitForTimeout(1000);
  const body = await page.evaluate(() => document.body.innerHTML);
  const fs = require('fs');
  fs.writeFileSync('debug-body.html', body);
});
