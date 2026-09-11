import { test } from '@playwright/test';
test('dummy', async ({ page }) => {
  await page.goto("http://localhost:4173/customers/cust_bluepeak/edit");
  await page.waitForTimeout(500);
  const statusHtml = await page.getByTestId("status-trigger").innerHTML();
  console.log("STATUS HTML:", statusHtml);
});
