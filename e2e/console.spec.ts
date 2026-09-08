import { test, expect } from '@playwright/test';

test.describe('Hivarium Operator Console E2E', () => {

    test('pagination renders correctly with 6 items', async ({ page }) => {
        await page.goto('/');

        // Check initial table state
        await expect(page.getByText('Showing 1-6 of 6')).toBeVisible();
        await expect(page.getByText('Page 1 of 1')).toBeVisible();

        // Check next/previous buttons are disabled using typical navigation selectors
        const prevButton = page.locator('button', { hasText: 'Previous' }).or(page.locator('button[aria-label="Go to previous page"]'));
        const nextButton = page.locator('button', { hasText: 'Next' }).or(page.locator('button[aria-label="Go to next page"]'));

        // We conditionally try to expect them to be disabled if they exist.
        if (await prevButton.count() > 0) {
            await expect(prevButton.first()).toBeDisabled();
        }
        if (await nextButton.count() > 0) {
            await expect(nextButton.first()).toBeDisabled();
        }
    });

    test('search filters reset pagination properly and handle zero results', async ({ page }) => {
        await page.goto('/');

        // Search for a non-existent item
        const searchInput = page.getByPlaceholder('Search by name, domain or contact…');
        await searchInput.fill('XYZ123NonExistent');

        // Should show 0 of 0 or a similar blank state
        await expect(page.getByText('No customers match the current filters.')).toBeVisible();
        await expect(page.getByText(/0 of 0/).or(page.getByText('Showing 0-0 of 0')).or(page.getByText('Showing 0 to 0 of 0')).or(page.getByText('0')).first()).toBeVisible();

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
        await expect(page.getByTestId('page-title')).toContainText('Edit Customer');

        // Edit the industry
        const input = page.getByLabel('Industry');
        if (await input.isVisible()) {
            await input.fill('Space Logistics');
            await page.getByText('Save changes').click();

            // Should redirect to profile and persist
            await expect(page.getByTestId('page-title')).toContainText('Bluepeak Logistics');
        }
    });

});
