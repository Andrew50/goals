import { test, expect } from '@playwright/test';

test.describe('List page multi-select behavior', () => {
    test.beforeEach(async ({ page }) => {
        // Authentication handled by global setup
        await page.goto('/list');
        await page.waitForSelector('.list-container', { timeout: 15000 });
        await page.waitForSelector('table.goals-table', { timeout: 15000 });
        // Give time for data fetch/render
        await page.waitForTimeout(1000);
    });

    test('row checkboxes remain selected when clicked sequentially', async ({ page }) => {
        const name1 = `MultiSelect Test A ${Date.now()}`;
        const name2 = `MultiSelect Test B ${Date.now()}`;

        // Helper to create a goal via the List page dialog
        const createGoal = async (goalName: string) => {
            await page.locator('.new-goal-button').click();
            await expect(page.locator('div[role="dialog"]')).toBeVisible();

            await page.locator('label:has-text("Name") + div input').fill(goalName);

            // Ensure Goal Type is Task (in case default differs)
            await page.locator('label:has-text("Goal Type") + div').click();
            await page.locator('li:has-text("Task")').click();

            await page.locator('button:has-text("Create"):not(:has-text("Another"))').click();
            await page.waitForFunction(() => !document.querySelector('div[role="dialog"]'), { timeout: 10000 });

            // Wait for the new row to appear
            await expect(page.locator('tr', { hasText: goalName })).toBeVisible({ timeout: 15000 });
        };

        // Create two distinct goals
        await createGoal(name1);
        await createGoal(name2);

        const row1 = page.locator('tr', { hasText: name1 });
        const row2 = page.locator('tr', { hasText: name2 });

        const cb1 = row1.locator('input[type="checkbox"]');
        const cb2 = row2.locator('input[type="checkbox"]');

        // Click first checkbox and verify UI reflects 1 selected and checkbox remains checked
        await cb1.check();
        await expect(cb1).toBeChecked();
        await expect(page.locator('.bulk-actions-bar')).toBeVisible();
        await expect(page.locator('.bulk-actions-bar')).toContainText('1 selected');

        // Click second checkbox and verify both remain selected
        await cb2.check();
        await expect(cb1).toBeChecked();
        await expect(cb2).toBeChecked();
        await expect(page.locator('.bulk-actions-bar')).toContainText('2 selected');

        // Small stability check after a short delay to catch any flicker/regression
        await page.waitForTimeout(250);
        await expect(cb1).toBeChecked();
        await expect(cb2).toBeChecked();
        await expect(page.locator('.bulk-actions-bar')).toContainText('2 selected');
    });
});


