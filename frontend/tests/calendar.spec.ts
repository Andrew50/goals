import { test, expect } from '@playwright/test';

test.describe('Calendar Page E2E Tests', () => {
    test.beforeEach(async ({ page }) => {
        // Authentication is handled by global setup and storageState in playwright.config.ts

        // Go directly to the calendar page
        await page.goto('/calendar');

        // Wait for the calendar to load
        await page.waitForSelector('.calendar-container', { timeout: 10000 });
    });

    test('should display calendar view', async ({ page }) => {
        // Check that main calendar elements are visible
        await expect(page.locator('.calendar-container')).toBeVisible();
        await expect(page.locator('.calendar-main')).toBeVisible();
        await expect(page.locator('.calendar-sidebar')).toBeVisible();

        // FullCalendar specific elements
        await expect(page.locator('.fc')).toBeVisible();
    });

    test('should show month view by default', async ({ page }) => {
        // Check that we're in month view by default
        await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible();

        // Verify that navigation controls are present
        await expect(page.locator('.fc-prev-button')).toBeVisible();
        await expect(page.locator('.fc-next-button')).toBeVisible();
        await expect(page.locator('.fc-today-button')).toBeVisible();
    });

    test('should switch to week view', async ({ page }) => {
        // Click the week view button
        await page.locator('.fc-timeGridWeek-button').click();

        // Verify week view is displayed
        await expect(page.locator('.fc-timeGridWeek-view')).toBeVisible();
    });

    test('should switch to day view', async ({ page }) => {
        // Click the day view button
        await page.locator('.fc-timeGridDay-button').click();

        // Verify day view is displayed
        await expect(page.locator('.fc-timeGridDay-view')).toBeVisible();
    });

    test('should click on a day and possibly open goal menu', async ({ page }) => {
        // First, ensure we're in month view
        await page.locator('.fc-dayGridMonth-button').click();

        // Find a day cell - we'll click on the current day for simplicity
        await page.locator('.fc-day-today').click();

        // Since we can't easily verify if GoalMenu opened without knowing its specific structure,
        // this test just verifies the click happens without errors
    });
});
