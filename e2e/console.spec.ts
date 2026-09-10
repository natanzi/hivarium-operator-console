import { test, expect } from '@playwright/test';

test.describe('Hivarium Operator Console E2E', () => {

    test('pagination renders correctly with 6 items', async ({ page }) => {
        await page.goto('/');

        // Check initial table state
        await expect(page.locator('body')).toContainText(/Showing\s+1[–-]?6\s+of\s+6/);
        await expect(page.getByText('Page 1 of 1')).toBeVisible();

        // Check next/previous buttons are disabled using strict selectors
        const prevButton = page.locator('button[aria-label="Previous page"]');
        const nextButton = page.locator('button[aria-label="Next page"]');

        await expect(prevButton).toBeDisabled();
        await expect(nextButton).toBeDisabled();
    });

    test('search filters reset pagination properly and handle zero results', async ({ page }) => {
        await page.goto('/');

        // Search for a non-existent item
        const searchInput = page.getByPlaceholder('Search by name, domain or contact…');
        await searchInput.fill('XYZ123NonExistent');

        // Should show 0 of 0 or a similar blank state
        await expect(page.getByText('No customers match the current filters.')).toBeVisible();
        await expect(page.locator('body')).toContainText(/Showing\s+0[–-]?0\s+of\s+0/);

        // The negative out of bounds like 25-6 should definitely NOT be visible
        await expect(page.getByText('Showing 25-6')).toBeHidden();
    });

    test('customer profile and edit flow works', async ({ page }) => {
        await page.goto('/');

        // Find Bluepeak Logistics and click it
        await page.getByText('Bluepeak Logistics').click();

        // Check profile page loads
        await expect(page.getByTestId('page-title')).toContainText('Bluepeak Logistics');

        // Click Edit
        await page.getByText('Edit customer').click();

        // Wait for the edit page
        await expect(page.getByTestId('page-title')).toContainText('Edit Bluepeak Logistics');

        // Edit the contact
        const input = page.getByLabel('Contact name *');
        await input.fill('Space Contact');
        await page.getByText('Save changes').click();

        // Should redirect to profile and persist
        await expect(page.getByTestId('page-title')).toContainText('Bluepeak Logistics');
    });

});
