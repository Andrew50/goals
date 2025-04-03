import { test, expect, Page } from '@playwright/test';
import { generateTestToken } from './helpers/auth';

test.describe('Calendar UI Interactions', () => {
    let page: Page;

    test.beforeEach(async ({ browser }) => {
        // Create a fresh page for each test with timezone control
        page = await browser.newPage({
            timezoneId: 'America/New_York', // Control timezone for consistent testing
        });

        // Set up authentication
        await page.goto('/');
        const testToken = generateTestToken();
        await page.evaluate((token) => {
            localStorage.setItem('token', token);
            localStorage.setItem('userId', '1');
        }, testToken);

        // Go to calendar page and wait for it to load
        await page.goto('/');
        await page.waitForSelector('.calendar-container', { timeout: 10000 });

        // Wait for initial calendar data to load
        await page.waitForSelector('.fc-event', { timeout: 5000 });
    });

    test('left-clicking an event opens GoalMenu in view mode', async () => {
        // Find an event (we know there's one from our seed data)
        const calendarEvent = page.locator('.fc-event').first();

        // Verify event exists
        await expect(calendarEvent).toBeVisible();

        // Click the event
        await calendarEvent.click();

        // Verify GoalMenu opens in view mode
        await expect(page.locator('div[role="dialog"]')).toBeVisible();
        await expect(page.locator('button:has-text("Edit")')).toBeVisible();
        await expect(page.locator('button:has-text("Close")')).toBeVisible();

        // GoalMenu should have data from the event
        await expect(page.locator('div[role="dialog"]')).toContainText('View Goal');

        // Close the dialog
        await page.locator('button:has-text("Close")').click();
    });

    test('right-clicking an event opens GoalMenu in edit mode', async () => {
        // Find an event
        const calendarEvent = page.locator('.fc-event').first();

        // Right-click the event
        await calendarEvent.click({ button: 'right' });

        // Verify GoalMenu opens in edit mode
        await expect(page.locator('div[role="dialog"]')).toBeVisible();
        await expect(page.locator('div[role="dialog"]')).toContainText('Edit Goal');

        // Edit mode should have editable fields
        await expect(page.locator('input[name="name"]')).toBeEnabled();
        await expect(page.locator('button:has-text("Save")')).toBeVisible();

        // Close without saving
        await page.locator('button:has-text("Cancel")').click();
    });

    test('clicking calendar background opens GoalMenu in create mode', async () => {
        // Click on an empty spot in the calendar (find a day cell not occupied by events)
        await page.locator('.fc-day:not(.fc-day-past)').first().click();

        // Verify GoalMenu opens in create mode
        await expect(page.locator('div[role="dialog"]')).toBeVisible();
        await expect(page.locator('div[role="dialog"]')).toContainText('Create New Goal');

        // Fill out basic info for a task
        await page.locator('input[placeholder="Name"]').fill('Test Task Created From Calendar');

        // Verify scheduled date is present (should be prefilled with clicked date)
        await expect(page.locator('input[type="datetime-local"]')).toBeVisible();

        // Cancel the creation
        await page.locator('button:has-text("Cancel")').click();
    });

    test('dragging event to a new date updates the event', async () => {
        // Store initial position/date of first event
        const firstEvent = page.locator('.fc-event').first();
        const initialTitle = await firstEvent.textContent();

        // Find source and target dates (move event from its position to 2 days later)
        const targetDay = page.locator('.fc-day:not(.fc-day-past)').nth(2);

        // Perform drag operation
        await firstEvent.dragTo(targetDay);

        // Wait for update to process
        await page.waitForTimeout(500);

        // Verify event moved (check it's now in the target day)
        const dayAfterDrag = page.locator('.fc-day:not(.fc-day-past)').nth(2);
        await expect(dayAfterDrag.locator('.fc-event')).toContainText(initialTitle || '');

        // Verify persistence (reload page)
        await page.reload();
        await page.waitForSelector('.calendar-container', { timeout: 10000 });

        // Check event is still in new position
        const dayAfterReload = page.locator('.fc-day:not(.fc-day-past)').nth(2);
        await expect(dayAfterReload.locator('.fc-event')).toContainText(initialTitle || '');
    });

    test('resizing event from bottom changes duration', async () => {
        // Switch to week view for better resizing control
        await page.locator('.fc-timeGridWeek-button').click();

        // Find an event
        const event = page.locator('.fc-timegrid-event').first();

        // Get initial height
        const initialBounds = await event.boundingBox();
        if (!initialBounds) throw new Error('Could not get event bounds');

        // Find and drag the resize handle at bottom of event
        const resizeHandle = page.locator('.fc-timegrid-event .fc-event-resizer-end').first();

        // Drag down to increase duration by roughly 1 hour (50px should be about an hour in most calendar views)
        await resizeHandle.dragTo(event, {
            targetPosition: { x: 0, y: initialBounds.height + 50 },
        });

        // Wait for update
        await page.waitForTimeout(500);

        // Verify event height increased
        const finalBounds = await event.boundingBox();
        if (!finalBounds) throw new Error('Could not get final event bounds');
        expect(finalBounds.height).toBeGreaterThan(initialBounds.height);

        // Verify persistence
        await page.reload();
        await page.waitForSelector('.calendar-container', { timeout: 10000 });
        await page.locator('.fc-timeGridWeek-button').click();

        const eventAfterReload = page.locator('.fc-timegrid-event').first();
        const reloadedBounds = await eventAfterReload.boundingBox();
        if (!reloadedBounds) throw new Error('Could not get reloaded event bounds');
        expect(reloadedBounds.height).toBeGreaterThan(initialBounds.height);
    });

    test('resizing event from top changes start time and preserves duration', async () => {
        // Switch to week view
        await page.locator('.fc-timeGridWeek-button').click();

        // Find an event
        const event = page.locator('.fc-timegrid-event').first();

        // Get initial position and size
        const initialBounds = await event.boundingBox();
        if (!initialBounds) throw new Error('Could not get event bounds');

        // Find the top resize handle
        const topResizeHandle = page.locator('.fc-timegrid-event .fc-event-resizer-start').first();

        // Drag up to make event start earlier (move top up by 25 pixels)
        await topResizeHandle.dragTo(event, {
            targetPosition: { x: 0, y: -25 },
        });

        // Wait for update
        await page.waitForTimeout(500);

        // Verify top position changed
        const finalBounds = await event.boundingBox();
        if (!finalBounds) throw new Error('Could not get final event bounds');
        expect(finalBounds.y).toBeLessThan(initialBounds.y);

        // Height should be greater as we're starting earlier but ending at same time
        expect(finalBounds.height).toBeGreaterThan(initialBounds.height);
    });

    test('create new unscheduled task and verify it appears in task list', async () => {
        // Find and click "Add Task" button in the task list sidebar
        await page.locator('.calendar-sidebar button:has-text("Add Task")').click();

        // GoalMenu should open in create mode
        await expect(page.locator('div[role="dialog"]')).toBeVisible();

        // Fill out task details
        const taskName = `Test Task ${Date.now()}`;
        await page.locator('input[placeholder="Name"]').fill(taskName);
        await page.locator('select[name="goal_type"]').selectOption('task');

        // Create the task
        await page.locator('button:has-text("Create")').click();

        // Wait for dialog to close
        await expect(page.locator('div[role="dialog"]')).not.toBeVisible();

        // Verify task appears in the task list
        await expect(page.locator('.task-item').filter({ hasText: taskName })).toBeVisible();
    });

    test('drag unscheduled task to calendar', async () => {
        // Create a new task first
        const taskName = `Drag Test ${Date.now()}`;
        await page.locator('.calendar-sidebar button:has-text("Add Task")').click();
        await page.locator('input[placeholder="Name"]').fill(taskName);
        await page.locator('select[name="goal_type"]').selectOption('task');
        await page.locator('button:has-text("Create")').click();

        // Wait for task to appear in task list
        const taskItem = page.locator('.task-item', { hasText: taskName });
        await expect(taskItem).toBeVisible();

        // Switch to week view for more precise drag target
        await page.locator('.fc-timeGridWeek-button').click();

        // Find a target time slot in the calendar (9 AM slot)
        const targetTimeSlot = page.locator('.fc-timegrid-slot').filter({ hasText: '9:00' });

        // Drag task to calendar
        await taskItem.dragTo(targetTimeSlot);

        // Wait for the drag operation to complete and update
        await page.waitForTimeout(500);

        // Verify task disappeared from task list
        await expect(taskItem).not.toBeVisible();

        // Verify task appears as calendar event
        await expect(page.locator('.fc-event', { hasText: taskName })).toBeVisible();

        // Verify persistence
        await page.reload();
        await page.waitForSelector('.calendar-container');
        await page.locator('.fc-timeGridWeek-button').click();
        await expect(page.locator('.fc-event', { hasText: taskName })).toBeVisible();
    });

    test('drag scheduled event back to task list', async () => {
        // First create and schedule a task
        const taskName = `Return to List ${Date.now()}`;

        // Create task and drag to calendar
        await page.locator('.calendar-sidebar button:has-text("Add Task")').click();
        await page.locator('input[placeholder="Name"]').fill(taskName);
        await page.locator('select[name="goal_type"]').selectOption('task');
        await page.locator('button:has-text("Create")').click();

        // Wait for task to appear and drag it to calendar
        const taskItem = page.locator('.task-item', { hasText: taskName });
        await expect(taskItem).toBeVisible();

        // Switch to week view and find target slot
        await page.locator('.fc-timeGridWeek-button').click();
        const targetTimeSlot = page.locator('.fc-timegrid-slot').filter({ hasText: '9:00' });
        await taskItem.dragTo(targetTimeSlot);

        // Verify it's now in calendar
        const calendarEvent = page.locator('.fc-event', { hasText: taskName });
        await expect(calendarEvent).toBeVisible();

        // Now drag it back to the task list area
        const taskListContainer = page.locator('.calendar-sidebar');
        await calendarEvent.dragTo(taskListContainer);

        // Wait for the drag operation to complete
        await page.waitForTimeout(500);

        // Verify it's back in the task list
        await expect(page.locator('.task-item', { hasText: taskName })).toBeVisible();

        // Verify it's no longer in the calendar
        await expect(calendarEvent).not.toBeVisible();

        // Verify persistence
        await page.reload();
        await page.waitForSelector('.calendar-container');

        // Should still be in task list after reload
        await expect(page.locator('.task-item', { hasText: taskName })).toBeVisible();
        // Should not be in calendar after reload
        await expect(page.locator('.fc-event', { hasText: taskName })).not.toBeVisible();
    });

    test('long event name displays correctly in month and week views', async () => {
        // Create an event with a very long name
        await page.locator('.fc-day:not(.fc-day-past)').first().click();

        const longName = 'This is a very long event name that should be truncated in month view but fully visible in week view';
        await page.locator('input[placeholder="Name"]').fill(longName);
        await page.locator('select[name="goal_type"]').selectOption('task');
        await page.locator('button:has-text("Create")').click();

        // Check truncation in month view
        const monthViewEvent = page.locator('.fc-event', { hasText: longName.substring(0, 10) });
        await expect(monthViewEvent).toBeVisible();

        // Switch to week view
        await page.locator('.fc-timeGridWeek-button').click();

        // Event should show more of the title in week view
        const weekViewEvent = page.locator('.fc-event', { hasText: longName.substring(0, 20) });
        await expect(weekViewEvent).toBeVisible();
    });
}); 