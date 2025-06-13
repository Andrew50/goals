import { test, expect } from '@playwright/test';

test.describe('Debug Single Calendar Test', () => {
    test('debug left-clicking an event', async ({ page }) => {
        await page.goto('/calendar');
        await page.waitForSelector('.calendar-container');
        await page.waitForSelector('.fc-view-harness');

        // Wait longer for events to load
        await page.waitForTimeout(5000);

        console.log('=== CHECKING FOR EVENTS ===');
        const eventCount = await page.locator('.fc-event').count();
        console.log('Total events found:', eventCount);

        if (eventCount > 0) {
            const eventTexts = await page.locator('.fc-event').allTextContents();
            console.log('Event texts:', eventTexts);

            // Check if events are visible
            for (let i = 0; i < eventCount; i++) {
                const event = page.locator('.fc-event').nth(i);
                const isVisible = await event.isVisible();
                const boundingBox = await event.boundingBox();
                console.log(`Event ${i}: visible=${isVisible}, boundingBox=${JSON.stringify(boundingBox)}`);
            }

            // Try to click the first event
            console.log('=== ATTEMPTING TO CLICK FIRST EVENT ===');
            const firstEvent = page.locator('.fc-event').first();

            try {
                // Wait for the event to be visible
                await expect(firstEvent).toBeVisible({ timeout: 10000 });
                console.log('First event is visible, attempting click...');

                await firstEvent.click();
                console.log('Click successful!');

                // Check if dialog opened
                const dialog = page.locator('div[role="dialog"]');
                const dialogVisible = await dialog.isVisible();
                console.log('Dialog visible after click:', dialogVisible);

                if (dialogVisible) {
                    const dialogText = await dialog.textContent();
                    console.log('Dialog content:', dialogText);
                }

            } catch (error) {
                console.log('Error clicking event:', error.message);

                // Take a screenshot for debugging
                await page.screenshot({ path: 'debug-click-failure.png', fullPage: true });
            }
        } else {
            console.log('No events found!');

            // Check what's in the calendar
            const calendarContent = await page.locator('.fc-view-harness').innerHTML();
            console.log('Calendar content length:', calendarContent.length);

            // Take a screenshot
            await page.screenshot({ path: 'debug-no-events.png', fullPage: true });
        }

        expect(true).toBe(true); // Always pass for debugging
    });
}); 