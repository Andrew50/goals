import { test, expect } from '@playwright/test';

test.describe('Calendar Events Debug', () => {
    test('debug why events are not visible', async ({ page }) => {
        await page.goto('/calendar');
        await page.waitForSelector('.calendar-container');
        await page.waitForSelector('.fc-view-harness');

        // Wait for any async loading
        await page.waitForTimeout(3000);

        // Check different calendar views for events
        console.log('=== MONTH VIEW ===');
        await page.locator('.fc-dayGridMonth-button').click();
        await page.waitForTimeout(1000);

        const monthEvents = await page.locator('.fc-event').count();
        console.log('Events in month view:', monthEvents);

        if (monthEvents > 0) {
            const eventTexts = await page.locator('.fc-event').allTextContents();
            console.log('Event texts in month view:', eventTexts);
        }

        console.log('=== WEEK VIEW ===');
        await page.locator('.fc-timeGridWeek-button').click();
        await page.waitForTimeout(1000);

        const weekEvents = await page.locator('.fc-event').count();
        console.log('Events in week view:', weekEvents);

        if (weekEvents > 0) {
            const eventTexts = await page.locator('.fc-event').allTextContents();
            console.log('Event texts in week view:', eventTexts);
        }

        console.log('=== DAY VIEW ===');
        await page.locator('.fc-timeGridDay-button').click();
        await page.waitForTimeout(1000);

        const dayEvents = await page.locator('.fc-event').count();
        console.log('Events in day view:', dayEvents);

        if (dayEvents > 0) {
            const eventTexts = await page.locator('.fc-event').allTextContents();
            console.log('Event texts in day view:', eventTexts);
        }

        // Check what date the calendar is showing
        const currentDate = await page.locator('.fc-toolbar-title').textContent();
        console.log('Calendar showing date:', currentDate);

        // Check if there are any tasks in the sidebar
        const tasks = await page.locator('.task-item').count();
        console.log('Tasks in sidebar:', tasks);

        if (tasks > 0) {
            const taskTexts = await page.locator('.task-item').allTextContents();
            console.log('Task texts:', taskTexts);
        }

        // Check for any network requests to the calendar API
        const apiRequests: string[] = [];
        page.on('request', request => {
            if (request.url().includes('/calendar')) {
                apiRequests.push(request.url());
            }
        });

        // Trigger a refresh to see API calls
        await page.reload();
        await page.waitForSelector('.calendar-container');
        await page.waitForTimeout(2000);

        console.log('API requests made:', apiRequests);

        // Navigate to different months to see if events are in the future/past
        console.log('=== CHECKING NEXT MONTH ===');
        await page.locator('.fc-next-button').click();
        await page.waitForTimeout(1000);

        const nextMonthEvents = await page.locator('.fc-event').count();
        console.log('Events in next month:', nextMonthEvents);

        console.log('=== CHECKING PREVIOUS MONTH ===');
        await page.locator('.fc-prev-button').click();
        await page.locator('.fc-prev-button').click(); // Go back to previous month
        await page.waitForTimeout(1000);

        const prevMonthEvents = await page.locator('.fc-event').count();
        console.log('Events in previous month:', prevMonthEvents);

        // Take a screenshot
        await page.screenshot({ path: 'debug-events.png', fullPage: true });

        expect(true).toBe(true); // Always pass for debugging
    });
}); 