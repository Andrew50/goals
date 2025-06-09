import { test, expect } from '@playwright/test';

test.describe('Debug Event Visibility', () => {
    test('debug event visibility and viewport', async ({ page }) => {
        await page.goto('/calendar');
        await page.waitForSelector('.calendar-container');
        await page.waitForSelector('.fc-view-harness');

        // Handle webpack dev server overlay if present
        const webpackOverlay = page.locator('#webpack-dev-server-client-overlay');
        if (await webpackOverlay.isVisible()) {
            console.log('Webpack overlay detected, removing it...');
            await page.evaluate(() => {
                const overlay = document.getElementById('webpack-dev-server-client-overlay');
                if (overlay) {
                    overlay.remove();
                }
            });
            await page.waitForTimeout(1000);
        }

        // Wait for events to load
        await page.waitForTimeout(5000);

        // Check viewport size
        const viewport = page.viewportSize();
        console.log('Viewport size:', viewport);

        // Check calendar container size
        const calendarContainer = page.locator('.calendar-container');
        const containerBox = await calendarContainer.boundingBox();
        console.log('Calendar container bounding box:', containerBox);

        // Check events
        const eventCount = await page.locator('.fc-event').count();
        console.log('Total events found:', eventCount);

        if (eventCount > 0) {
            for (let i = 0; i < eventCount; i++) {
                const event = page.locator('.fc-event').nth(i);
                const isVisible = await event.isVisible();
                const boundingBox = await event.boundingBox();

                console.log(`Event ${i}:`);
                console.log(`  - visible: ${isVisible}`);
                console.log(`  - bounding box: ${JSON.stringify(boundingBox)}`);

                // Try to scroll to the event
                console.log(`  - scrolling to event ${i}...`);
                await event.scrollIntoViewIfNeeded();
                await page.waitForTimeout(1000);

                const isVisibleAfterScroll = await event.isVisible();
                console.log(`  - visible after scroll: ${isVisibleAfterScroll}`);

                // Try to force click if still not visible
                if (!isVisibleAfterScroll) {
                    console.log(`  - trying force click on event ${i}...`);
                    try {
                        await event.click({ force: true });
                        console.log(`  - force click successful!`);

                        // Check if dialog opened
                        const dialog = page.locator('div[role="dialog"]');
                        const dialogVisible = await dialog.isVisible();
                        console.log(`  - dialog visible: ${dialogVisible}`);

                        if (dialogVisible) {
                            await page.locator('button:has-text("Close"), button:has-text("Cancel")').click();
                            await page.waitForTimeout(500);
                        }

                    } catch (error) {
                        console.log(`  - force click failed: ${error.message}`);
                    }
                }
            }
        }

        // Try different calendar views
        console.log('=== TRYING WEEK VIEW ===');

        // Check again for webpack overlay before clicking
        const webpackOverlayBeforeClick = page.locator('#webpack-dev-server-client-overlay');
        if (await webpackOverlayBeforeClick.isVisible()) {
            console.log('Webpack overlay detected before week view click, removing it...');
            await page.evaluate(() => {
                const overlay = document.getElementById('webpack-dev-server-client-overlay');
                if (overlay) {
                    overlay.remove();
                }
            });
            await page.waitForTimeout(1000);
        }

        // Wait for the week button to be available and click it
        const weekButton = page.locator('.fc-timeGridWeek-button');
        await weekButton.waitFor({ state: 'visible', timeout: 10000 });

        try {
            await weekButton.click({ timeout: 10000 });
        } catch (error) {
            console.log('Regular click failed, trying force click:', error.message);
            await weekButton.click({ force: true });
        }

        await page.waitForTimeout(2000);

        const weekEvents = await page.locator('.fc-event').count();
        console.log('Events in week view:', weekEvents);

        if (weekEvents > 0) {
            const firstWeekEvent = page.locator('.fc-event').first();
            const weekEventVisible = await firstWeekEvent.isVisible();
            console.log('First week event visible:', weekEventVisible);

            if (weekEventVisible) {
                console.log('Week event is visible! Trying to click...');
                try {
                    await firstWeekEvent.click();
                    console.log('Week event click successful!');

                    const dialog = page.locator('div[role="dialog"]');
                    const dialogVisible = await dialog.isVisible();
                    console.log('Dialog visible after week event click:', dialogVisible);

                    if (dialogVisible) {
                        await page.locator('button:has-text("Close"), button:has-text("Cancel")').click();
                        await page.waitForTimeout(500);
                    }

                } catch (error) {
                    console.log('Week event click failed:', error.message);
                }
            }
        }

        // Take a screenshot
        await page.screenshot({ path: 'debug-visibility.png', fullPage: true });

        expect(true).toBe(true); // Always pass for debugging
    });
}); 