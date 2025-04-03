import { test, expect } from '@playwright/test';
import { generateTestToken } from './helpers/auth';

/**
 * Timestamp E2E Tests
 * 
 * These tests verify that timestamps are correctly handled throughout the entire application flow,
 * particularly focusing on timezone conversions between UI display, backend storage, and persistence.
 */

test.describe('Timestamp and Timezone E2E Tests', () => {
    // Set up for all tests
    test.beforeEach(async ({ page }) => {
        // Set up an authenticated session
        const token = generateTestToken(1); // user ID 1

        // Set the token in local storage before navigating to the app
        await page.goto('/');
        await page.evaluate((authToken) => {
            localStorage.setItem('authToken', authToken);
        }, token);

        // Go to the calendar page
        await page.goto('/calendar');

        // Wait for the calendar to load
        await page.waitForSelector('.fc-view-container', { timeout: 5000 });
    });

    test('creates a task with specific time and verifies it persists correctly after reload', async ({ page, context }) => {
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

        // Set up auth
        await newTimezonePage.goto('/');
        await newTimezonePage.evaluate((authToken) => {
            localStorage.setItem('authToken', authToken);
        }, generateTestToken(1));

        // Go to calendar
        await newTimezonePage.goto('/calendar');
        await newTimezonePage.waitForSelector('.fc-view-container');

        // Find the same event
        const eventInNewTimezone = newTimezonePage.locator('.fc-event:has-text("Timezone Change Test")');
        await expect(eventInNewTimezone).toBeVisible();

        // Check the time - it should show at a different hour (3 PM Pacific would be 6 PM Eastern)
        const eventTimeInNewTimezone = newTimezonePage.locator('.fc-event:has-text("Timezone Change Test") .fc-time');
        const newTimezoneTimeText = await eventTimeInNewTimezone.textContent() || '';
        expect(newTimezoneTimeText).toContain('18:00'); // 6 PM in Eastern Time

        // Clean up
        await newContext.close();
    });
}); 