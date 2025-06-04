import { test, expect } from '@playwright/test';
import { generateStorageState } from '../helpers/auth'; // Import the new helper

/**
 * Timestamp E2E Tests
 * 
 * These tests verify that timestamps are correctly handled throughout the entire application flow,
 * particularly focusing on timezone conversions between UI display, backend storage, and persistence.
 */

test.describe('Timestamp and Timezone E2E Tests', () => {
    // Set up for tests in this describe block
    test.beforeEach(async ({ page }) => {
        // Authentication is handled by global setup and storageState in playwright.config.ts
        // for the default context used by these tests.

        // Go directly to the calendar page
        await page.goto('/calendar');

        // Wait for the calendar to load (use a reliable selector)
        await page.waitForSelector('.calendar-container', { timeout: 10000 });
        // Optional: Wait for events if expected immediately
        // await page.waitForSelector('.fc-event', { timeout: 5000 });
    });

    test('creates a task with specific time and verifies it persists correctly after reload', async ({ page }) => { // context fixture no longer needed here
        // Click on a specific time slot (e.g., 10:00 AM on the current day)
        // Find the time slot (this selector may need adjustment based on your FullCalendar setup)
        const timeSlot = page.locator('.fc-time-grid-slot').filter({ hasText: '10:00' }).first();
        await timeSlot.click();

        // Wait for the GoalMenu to appear
        await page.waitForSelector('.goal-menu-modal', { timeout: 5000 });

        // Fill in the task details
        await page.fill('input[name="name"]', 'Timezone Test Task');

        // Verify the time is pre-filled correctly (should be 10:00)
        const timeInput = page.locator('input[type="time"]');
        const prefilledTime = await timeInput.inputValue();
        expect(prefilledTime).toBe('10:00');

        // Create the task
        await page.click('button:has-text("Create")');

        // Wait for the task to appear on the calendar
        await page.waitForSelector('.fc-event:has-text("Timezone Test Task")', { timeout: 5000 });

        // Reload the page to verify persistence
        await page.reload();

        // Wait for the calendar to load again
        await page.waitForSelector('.fc-view-container', { timeout: 5000 });

        // Find the event again
        const event = page.locator('.fc-event:has-text("Timezone Test Task")');
        await expect(event).toBeVisible();

        // Verify the event is still at 10:00 AM
        // This checks that the time stored in UTC on the backend was correctly 
        // converted back to local time on reload
        const eventTime = page.locator('.fc-event:has-text("Timezone Test Task") .fc-time');
        const timeText = await eventTime.textContent() || '';
        expect(timeText).toContain('10:00');
    });

    test('drags a task to a new time and verifies it persists after reload', async ({ page }) => {
        // Create a task at a specific time first
        const timeSlot = page.locator('.fc-time-grid-slot').filter({ hasText: '9:00' }).first();
        await timeSlot.click();

        await page.waitForSelector('.goal-menu-modal');
        await page.fill('input[name="name"]', 'Draggable Test Task');
        await page.click('button:has-text("Create")');

        // Wait for the task to appear
        const event = page.locator('.fc-event:has-text("Draggable Test Task")');
        await expect(event).toBeVisible();

        // Drag the event to a new time (e.g., 2:00 PM)
        // This is a complex action that depends on your FullCalendar setup
        // The exact coordinates will need adjustment
        const targetSlot = page.locator('.fc-time-grid-slot').filter({ hasText: '14:00' }).first();

        // Get the bounding boxes of the elements
        const eventBoundingBox = await event.boundingBox();
        const targetBoundingBox = await targetSlot.boundingBox();

        if (eventBoundingBox && targetBoundingBox) {
            // Perform the drag operation
            await page.mouse.move(
                eventBoundingBox.x + eventBoundingBox.width / 2,
                eventBoundingBox.y + eventBoundingBox.height / 2
            );
            await page.mouse.down();
            await page.mouse.move(
                targetBoundingBox.x + targetBoundingBox.width / 2,
                targetBoundingBox.y + targetBoundingBox.height / 2,
                { steps: 20 } // Smooth movement to ensure the drag is registered
            );
            await page.mouse.up();
        }

        // Wait for the event to move (this might take a moment due to API calls)
        await page.waitForTimeout(1000);

        // Reload the page to verify persistence
        await page.reload();

        // Wait for the calendar to load again
        await page.waitForSelector('.fc-view-container');

        // Verify the event is now at 2:00 PM
        const movedEvent = page.locator('.fc-event:has-text("Draggable Test Task")');
        await expect(movedEvent).toBeVisible();

        // Verify the time has changed and persisted
        const eventTimeAfterMove = page.locator('.fc-event:has-text("Draggable Test Task") .fc-time');
        const timeTextAfterMove = await eventTimeAfterMove.textContent() || '';
        expect(timeTextAfterMove).toContain('14:00');
    });

    test('changes a task duration by resizing and verifies it persists', async ({ page }) => {
        // Create a task first
        const timeSlot = page.locator('.fc-time-grid-slot').filter({ hasText: '11:00' }).first();
        await timeSlot.click();

        await page.waitForSelector('.goal-menu-modal');
        await page.fill('input[name="name"]', 'Resizable Test Task');
        await page.click('button:has-text("Create")');

        // Wait for the task to appear
        const event = page.locator('.fc-event:has-text("Resizable Test Task")');
        await expect(event).toBeVisible();

        // Resize the event to make it longer
        // Find the resize handle at the bottom of the event
        const eventBoundingBox = await event.boundingBox();

        if (eventBoundingBox) {
            // Move to the bottom edge (resize handle) of the event
            await page.mouse.move(
                eventBoundingBox.x + eventBoundingBox.width / 2,
                eventBoundingBox.y + eventBoundingBox.height - 2
            );

            // Start the resize operation
            await page.mouse.down();

            // Move down to extend the event by approximately 1 hour
            // The exact movement needed will depend on your calendar's time slot heights
            await page.mouse.move(
                eventBoundingBox.x + eventBoundingBox.width / 2,
                eventBoundingBox.y + eventBoundingBox.height + 60, // Move by height of one hour slot
                { steps: 20 }
            );

            await page.mouse.up();
        }

        // Wait for the resize to register
        await page.waitForTimeout(1000);

        // Click on the event to open the detail view
        await event.click();

        // Wait for the goal menu to open
        await page.waitForSelector('.goal-menu-modal');

        // Check the duration (should be increased from default)
        // This assumes there's a duration field visible in the goal menu
        const durationElement = page.locator('.goal-menu-modal').getByText(/Duration/);
        const durationText = await durationElement.textContent() || '';

        // The text format may vary, but it should show more than the default duration
        expect(durationText).toContain('120'); // 2 hours in minutes

        // Close the modal
        await page.click('button:has-text("Close")');

        // Reload the page
        await page.reload();

        // Wait for the calendar to load again
        await page.waitForSelector('.fc-view-container');

        // Verify the event is still resized after reload
        const resizedEvent = page.locator('.fc-event:has-text("Resizable Test Task")');

        // Click on it again to check the duration
        await resizedEvent.click();
        await page.waitForSelector('.goal-menu-modal');

        // Verify the duration is still correct
        const durationElementAfterReload = page.locator('.goal-menu-modal').getByText(/Duration/);
        const durationTextAfterReload = await durationElementAfterReload.textContent() || '';
        expect(durationTextAfterReload).toContain('120');
    });

    test('simulates timezone change and verifies events stay at same local time', async ({ page, context }) => {
        // Create a task at a specific time
        const timeSlot = page.locator('.fc-time-grid-slot').filter({ hasText: '15:00' }).first();
        await timeSlot.click();

        await page.waitForSelector('.goal-menu-modal');
        await page.fill('input[name="name"]', 'Timezone Change Test');
        await page.click('button:has-text("Create")');

        // Wait for the task to appear at 3:00 PM
        const event = page.locator('.fc-event:has-text("Timezone Change Test")');
        await expect(event).toBeVisible();
        const eventTime = page.locator('.fc-event:has-text("Timezone Change Test") .fc-time');
        const initialTimeText = await eventTime.textContent() || '';
        expect(initialTimeText).toContain('15:00');

        // Now open a new "incognito" context with a different timezone
        // Note: This is a simplification. In reality, we would need to use a 
        // browser with a different timezone or use timezone emulation features.

        // For this example, we'll use Playwright's built-in timezone emulation
        const newContext = await context.browser().newContext({
            timezoneId: 'America/New_York', // Eastern Time
            locale: 'en-US'
        });

        // Create a new page in the different timezone
        const newTimezonePage = await newContext.newPage();

        // Set up auth for the new context MANUALLY, as it doesn't inherit global state
        // Use the generateStorageState helper for consistency
        const userId = 1; // Or the specific user needed for this test
        const username = `testuser${userId}`;
        // Use the baseURL from the config if possible, or default
        const baseURL = context.browser()?.browserType().name() === 'chromium' // Example check, adjust as needed
                       ? 'http://localhost:3000' // Or get from config more reliably if needed
                       : 'http://localhost:3000'; 
        const storageState = generateStorageState(userId, username, baseURL);
        await newContext.addCookies(storageState.cookies || []); // Use newContext
        await newContext.setStorageState(storageState); // Use newContext

        // Go to calendar
        await newTimezonePage.goto('/calendar');
        await newTimezonePage.waitForSelector('.fc-view-container');

        // Find the same event
        const eventInNewTimezone = newTimezonePage.locator('.fc-event:has-text("Timezone Change Test")');
        await expect(eventInNewTimezone).toBeVisible();

        // Check the time - it should show at a different hour (3 PM Pacific would be 6 PM Eastern)
        const eventTimeInNewTimezone = newTimezonePage.locator('.fc-event:has-text("Timezone Change Test") .fc-time');
        const newTimezoneTimeText = await eventTimeInNewTimezone.textContent() || '';
        // Assuming the original click was 3 PM Pacific (default test timezone)
        // 3 PM Pacific = 6 PM Eastern
        expect(newTimezoneTimeText).toContain('18:00'); 

        // *** ADDED VERIFICATION ***
        // Click the event in the new timezone context
        await eventInNewTimezone.click();

        // Wait for the GoalMenu to appear in the new timezone page
        await newTimezonePage.waitForSelector('input[type="datetime-local"]'); // Use a selector specific to GoalMenu's time input

        // Verify the time input in GoalMenu shows the correct local time (18:00)
        const timeInputInNewTimezone = newTimezonePage.locator('input[type="datetime-local"]'); // Adjust selector as needed
        const prefilledTimeInNewTimezone = await timeInputInNewTimezone.inputValue();
        expect(prefilledTimeInNewTimezone).toContain('T18:00');
        // If it were just a time input: expect(prefilledTimeInNewTimezone).toBe('18:00');

        // Clean up
        await newContext.close();
    });
});

test.describe('Timezone Handling in Calendar', () => {
    test.describe.configure({ mode: 'parallel' });

    // Test with various timezones
    for (const timezone of ['America/New_York', 'Europe/London', 'Asia/Tokyo']) {
        test(`creating and viewing events in ${timezone}`, async ({ browser }) => {
            // Create page with specific timezone
            const page = await browser.newPage({
                timezoneId: timezone,
            });

            // Setup auth MANUALLY for the context created by browser.newPage({ timezoneId: ... })
            // as it doesn't inherit the global storage state.
            const userId = 1;
            const username = `testuser${userId}`;
            const context = page.context(); // Get context from the page
            // Use the baseURL from the config if possible, or default
            const baseURL = context.browser()?.browserType().name() === 'chromium' // Example check, adjust as needed
                           ? 'http://localhost:3000' // Or get from config more reliably if needed
                           : 'http://localhost:3000';
            const storageState = generateStorageState(userId, username, baseURL);
            await context.addCookies(storageState.cookies || []);
            await context.setStorageState(storageState);

            // Go directly to the calendar page
            await page.goto('/calendar');
            await page.waitForSelector('.calendar-container', { timeout: 10000 }); // Increased timeout

            // Switch to day view for precise time testing
            await page.locator('.fc-timeGridDay-button').click();

            // Create event at specific local time (9:30 AM)
            await page.locator('.fc-timegrid-slot').filter({ hasText: '9:30' }).click();

            const eventName = `Timezone Test ${timezone}`;
            await page.locator('input[placeholder="Name"]').fill(eventName);
            await page.locator('select[name="goal_type"]').selectOption('task');

            // *** ADDED VERIFICATION ***
            // Verify the GoalMenu's time input is pre-filled with the clicked time (9:30 AM)
            // Assuming the input for a time-slot click is of type 'time' or 'datetime-local'
            // Adjust selector if GoalMenu uses a different input type/name for scheduled time
            const scheduleInput = page.locator('input[type="datetime-local"]'); // Or potentially 'input[type="time"]'
            const prefilledTime = await scheduleInput.inputValue();
            // The datetime-local input includes the date, so we check if the time part is correct
            expect(prefilledTime).toContain('T09:30'); 
            // If it were just a time input: expect(prefilledTime).toBe('09:30');

            // Set time to 9:30 AM local time for this timezone (if needed, might be prefilled)
            // If the input is datetime-local, we still need to ensure the date is correct
            if (!prefilledTime.startsWith(`${today.getFullYear()}`)) {
                 const today = new Date();
                 const dateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}T09:30`;
                 await scheduleInput.fill(dateString);
            }
            // If the input is just 'time', the click might already set it correctly.

            await page.locator('button:has-text("Create")').click();

            // Verify event appears at 9:30 AM
            const event = page.locator('.fc-event', { hasText: eventName });
            await expect(event).toBeVisible();

            // The event should be positioned near the 9:30 AM slot
            const nineThirtySlot = page.locator('.fc-timegrid-slot').filter({ hasText: '9:30' });
            const nineThirtyBounds = await nineThirtySlot.boundingBox();
            const eventBounds = await event.boundingBox();

            if (!nineThirtyBounds || !eventBounds) {
                throw new Error('Could not get element bounds');
            }

            // Event should be positioned within reasonable proximity to 9:30 AM slot
            expect(Math.abs(eventBounds.y - nineThirtyBounds.y)).toBeLessThan(100);

            // Reload page to verify persistence
            await page.reload();
            await page.waitForSelector('.calendar-container');
            await page.locator('.fc-timeGridDay-button').click();

            // Event should still be at 9:30 AM
            const eventAfterReload = page.locator('.fc-event', { hasText: eventName });
            await expect(eventAfterReload).toBeVisible();

            // Verify time is still correct
            const reloadedEventBounds = await eventAfterReload.boundingBox();
            const reloadedSlotBounds = await nineThirtySlot.boundingBox();

            if (!reloadedEventBounds || !reloadedSlotBounds) {
                throw new Error('Could not get reloaded element bounds');
            }

            expect(Math.abs(reloadedEventBounds.y - reloadedSlotBounds.y)).toBeLessThan(100);
        });

        test(`dragging events preserves time in ${timezone}`, async ({ browser }) => {
            const page = await browser.newPage({
                timezoneId: timezone,
            });

            // Setup and auth using context storage state
            const userId = 1;
            const username = `testuser${userId}`;
            const testToken = generateTestToken(userId, username); // Pass username if helper supports it
            const context = page.context(); // Get context from the page
            await context.addCookies([]);
            await context.setStorageState({
                cookies: [],
                origins: [
                    {
                        origin: 'http://localhost:3000', // Match the baseURL
                        localStorage: [
                            { name: 'authToken', value: testToken },
                            { name: 'userId', value: String(userId) },
                            { name: 'username', value: username }
                        ],
                    },
                ],
            });

            // Go directly to the calendar page
            await page.goto('/calendar');
            await page.waitForSelector('.calendar-container', { timeout: 10000 });

            // Switch to week view
            await page.locator('.fc-timeGridWeek-button').click();

            // Create an event at 10:00 AM
            await page.locator('.fc-timegrid-slot').filter({ hasText: '10:00' }).click();

            const eventName = `Drag Test ${timezone}`;
            await page.locator('input[placeholder="Name"]').fill(eventName);
            await page.locator('select[name="goal_type"]').selectOption('task');
            await page.locator('button:has-text("Create")').click();

            // Find the created event
            const event = page.locator('.fc-event', { hasText: eventName });
            await expect(event).toBeVisible();

            // Get initial position
            const initialBounds = await event.boundingBox();
            if (!initialBounds) throw new Error('Could not get event bounds');

            // Find tomorrow's 10:00 AM slot
            const tomorrow = page.locator('.fc-timegrid-col').nth(1).locator('.fc-timegrid-slot').filter({ hasText: '10:00' });

            // Drag event to tomorrow
            await event.dragTo(tomorrow);

            // Wait for update
            await page.waitForTimeout(500);

            // Verify event is still at 10:00 AM but on next day
            const eventAfterDrag = page.locator('.fc-event', { hasText: eventName });
            const afterDragBounds = await eventAfterDrag.boundingBox();
            if (!afterDragBounds) throw new Error('Could not get dragged event bounds');

            // Y position (time) should be the same
            expect(Math.abs(afterDragBounds.y - initialBounds.y)).toBeLessThan(10);

            // Verify persistence
            await page.reload();
            await page.waitForSelector('.calendar-container');
            await page.locator('.fc-timeGridWeek-button').click();

            const eventAfterReload = page.locator('.fc-event', { hasText: eventName });
            const reloadedBounds = await eventAfterReload.boundingBox();
            if (!reloadedBounds) throw new Error('Could not get reloaded event bounds');

            // Should still be at same time
            expect(Math.abs(reloadedBounds.y - initialBounds.y)).toBeLessThan(10);
        });
    }
}); 
