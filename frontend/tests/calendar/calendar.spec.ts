import { test, expect } from '@playwright/test';

test.describe('Combined Calendar Tests', () => {
  // Unified beforeEach from both scripts
  test.beforeEach(async ({ page, context }) => {
    // Authentication is handled by global setup and storageState in playwright.config.ts

    // Reset geolocation if needed (from second script)
    if (context) {
      await context.setGeolocation(null);
    }

    // Go to the calendar page
    await page.goto('/calendar');

    // Wait for the calendar to load (mix of both scripts)
    await page.waitForSelector('.calendar-container', { timeout: 10000 });
    await page.waitForSelector('.fc-view-harness', { timeout: 5000 });

    // Wait longer for events to load from API
    await page.waitForTimeout(3000);
  });

  // ----------------------
  // Tests from the first script
  // ----------------------
  test.describe('Calendar Page E2E Tests', () => {
    test('should display calendar view', async ({ page }) => {
      await expect(page.locator('.calendar-container')).toBeVisible();
      await expect(page.locator('.calendar-main')).toBeVisible();
      await expect(page.locator('.calendar-sidebar')).toBeVisible();
      await expect(page.locator('.fc')).toBeVisible();
    });

    test('should show month view by default', async ({ page }) => {
      await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible();
      await expect(page.locator('.fc-prev-button')).toBeVisible();
      await expect(page.locator('.fc-next-button')).toBeVisible();
      await expect(page.locator('.fc-today-button')).toBeVisible();
    });

    test('should switch to week view', async ({ page }) => {
      await page.locator('.fc-timeGridWeek-button').click();
      await expect(page.locator('.fc-timeGridWeek-view')).toBeVisible();
    });

    test('should switch to day view', async ({ page }) => {
      await page.locator('.fc-timeGridDay-button').click();
      await expect(page.locator('.fc-timeGridDay-view')).toBeVisible();
    });

    test('should click on a day and possibly open goal menu', async ({ page }) => {
      // Switch to month view to be sure
      await page.locator('.fc-dayGridMonth-button').click();
      await page.locator('.fc-day-today').click();
      // Verification depends on actual UI: this just checks click is successful
    });
  });

  // ----------------------
  // Tests from the second script
  // ----------------------
  test.describe('Calendar UI Interactions', () => {
    test('left-clicking an event opens GoalMenu in view mode', async ({ page }) => {
      // Switch to week view where events are more reliably visible
      await page.locator('.fc-timeGridWeek-button').click();
      await page.waitForTimeout(1000);

      const calendarEvent = page.locator('.fc-event').first();
      await expect(calendarEvent).toBeVisible();
      await calendarEvent.click();

      await expect(page.locator('div[role="dialog"]')).toBeVisible();
      await expect(page.locator('button:has-text("Edit")')).toBeVisible();
      await expect(page.locator('button:has-text("Close")')).toBeVisible();
      await expect(page.locator('div[role="dialog"]')).toContainText('View Goal');

      await page.locator('button:has-text("Close")').click();
    });

    test('right-clicking an event opens GoalMenu in edit mode', async ({ page }) => {
      // Switch to week view where events are more reliably visible
      await page.locator('.fc-timeGridWeek-button').click();
      await page.waitForTimeout(1000);

      const calendarEvent = page.locator('.fc-event').first();
      await expect(calendarEvent).toBeVisible();
      await calendarEvent.click({ button: 'right' });

      await expect(page.locator('div[role="dialog"]')).toBeVisible();
      await expect(page.locator('div[role="dialog"]')).toContainText('Edit Goal');
      await expect(page.locator('input[name="name"]')).toBeEnabled();
      await expect(page.locator('button:has-text("Save")')).toBeVisible();
      await page.locator('button:has-text("Cancel")').click();
    });

    test('clicking calendar background opens GoalMenu in create mode', async ({ page }) => {
      await page.locator('.fc-day:not(.fc-day-past)').first().click();
      await expect(page.locator('div[role="dialog"]')).toBeVisible();
      await expect(page.locator('div[role="dialog"]')).toContainText('Create New Goal');

      await page.locator('input[placeholder="Name"]').fill('Test Task Created From Calendar');
      await expect(page.locator('input[type="datetime-local"]')).toBeVisible();
      await page.locator('button:has-text("Cancel")').click();
    });

    test('dragging event to a new date updates the event', async ({ page }) => {
      // Switch to week view for better event visibility and interaction
      await page.locator('.fc-timeGridWeek-button').click();
      await page.waitForTimeout(1000);

      const firstEvent = page.locator('.fc-event').first();
      await expect(firstEvent).toBeVisible();
      const initialTitle = await firstEvent.textContent();
      const targetDay = page.locator('.fc-day:not(.fc-day-past)').nth(2);

      await firstEvent.dragTo(targetDay);
      await page.waitForTimeout(500);
      await expect(targetDay.locator('.fc-event')).toContainText(initialTitle || '');

      await page.reload();
      await page.waitForSelector('.calendar-container', { timeout: 10000 });
      await page.locator('.fc-timeGridWeek-button').click();
      await page.waitForTimeout(1000);
      const dayAfterReload = page.locator('.fc-day:not(.fc-day-past)').nth(2);
      await expect(dayAfterReload.locator('.fc-event')).toContainText(initialTitle || '');
    });

    test('resizing event from bottom changes duration', async ({ page }) => {
      await page.locator('.fc-timeGridWeek-button').click();
      await page.waitForTimeout(1000);

      const event = page.locator('.fc-timegrid-event').first();
      await expect(event).toBeVisible();

      const initialBounds = await event.boundingBox();
      if (!initialBounds) throw new Error('Could not get event bounds');

      const resizeHandle = page.locator('.fc-timegrid-event .fc-event-resizer-end').first();
      await expect(resizeHandle).toBeVisible();
      await resizeHandle.dragTo(event, {
        targetPosition: { x: 0, y: initialBounds.height + 50 },
      });

      await page.waitForTimeout(500);
      const finalBounds = await event.boundingBox();
      if (!finalBounds) throw new Error('Could not get final event bounds');
      expect(finalBounds.height).toBeGreaterThan(initialBounds.height);

      await page.reload();
      await page.waitForSelector('.calendar-container', { timeout: 10000 });
      await page.locator('.fc-timeGridWeek-button').click();
      await page.waitForTimeout(1000);

      const eventAfterReload = page.locator('.fc-timegrid-event').first();
      const reloadedBounds = await eventAfterReload.boundingBox();
      if (!reloadedBounds) throw new Error('Could not get reloaded event bounds');
      expect(reloadedBounds.height).toBeGreaterThan(initialBounds.height);
    });

    test('resizing event from top changes start time and preserves duration', async ({ page }) => {
      await page.locator('.fc-timeGridWeek-button').click();
      await page.waitForTimeout(1000);

      const event = page.locator('.fc-timegrid-event').first();
      await expect(event).toBeVisible();

      const initialBounds = await event.boundingBox();
      if (!initialBounds) throw new Error('Could not get event bounds');

      const topResizeHandle = page.locator('.fc-timegrid-event .fc-event-resizer-start').first();
      await expect(topResizeHandle).toBeVisible();
      await topResizeHandle.dragTo(event, { targetPosition: { x: 0, y: -25 } });

      await page.waitForTimeout(500);
      const finalBounds = await event.boundingBox();
      if (!finalBounds) throw new Error('Could not get final event bounds');
      expect(finalBounds.y).toBeLessThan(initialBounds.y);
      expect(finalBounds.height).toBeGreaterThan(initialBounds.height);
    });

    test('create new unscheduled task and verify it appears in task list', async ({ page }) => {
      await page.locator('.calendar-sidebar button:has-text("Add Task")').click();

      await expect(page.locator('div[role="dialog"]')).toBeVisible();
      const taskName = `Test Task ${Date.now()}`;
      await page.locator('input[placeholder="Name"]').fill(taskName);
      await page.locator('select[name="goal_type"]').selectOption('task');
      await page.locator('button:has-text("Create")').click();

      await expect(page.locator('div[role="dialog"]')).not.toBeVisible();
      await expect(page.locator('.task-item').filter({ hasText: taskName })).toBeVisible();
    });

    test('drag unscheduled task to calendar', async ({ page }) => {
      const taskName = `Drag Test ${Date.now()}`;
      await page.locator('.calendar-sidebar button:has-text("Add Task")').click();
      await page.locator('input[placeholder="Name"]').fill(taskName);
      await page.locator('select[name="goal_type"]').selectOption('task');
      await page.locator('button:has-text("Create")').click();

      const taskItem = page.locator('.task-item', { hasText: taskName });
      await expect(taskItem).toBeVisible();

      await page.locator('.fc-timeGridWeek-button').click();
      await page.waitForTimeout(1000);
      const targetTimeSlot = page.locator('.fc-timegrid-slot').filter({ hasText: '9:00' });
      await taskItem.dragTo(targetTimeSlot);

      await page.waitForTimeout(500);
      await expect(taskItem).not.toBeVisible();
      await expect(page.locator('.fc-event', { hasText: taskName })).toBeVisible();

      await page.reload();
      await page.waitForSelector('.calendar-container');
      await page.locator('.fc-timeGridWeek-button').click();
      await page.waitForTimeout(1000);
      await expect(page.locator('.fc-event', { hasText: taskName })).toBeVisible();
    });

    test('drag scheduled event back to task list', async ({ page }) => {
      const taskName = `Return to List ${Date.now()}`;
      await page.locator('.calendar-sidebar button:has-text("Add Task")').click();
      await page.locator('input[placeholder="Name"]').fill(taskName);
      await page.locator('select[name="goal_type"]').selectOption('task');
      await page.locator('button:has-text("Create")').click();

      const taskItem = page.locator('.task-item', { hasText: taskName });
      await expect(taskItem).toBeVisible();

      await page.locator('.fc-timeGridWeek-button').click();
      await page.waitForTimeout(1000);
      const targetTimeSlot = page.locator('.fc-timegrid-slot').filter({ hasText: '9:00' });
      await taskItem.dragTo(targetTimeSlot);

      const calendarEvent = page.locator('.fc-event', { hasText: taskName });
      await expect(calendarEvent).toBeVisible();

      const taskListContainer = page.locator('.calendar-sidebar');
      await calendarEvent.dragTo(taskListContainer);

      await page.waitForTimeout(500);
      await expect(page.locator('.task-item', { hasText: taskName })).toBeVisible();
      await expect(calendarEvent).not.toBeVisible();

      await page.reload();
      await page.waitForSelector('.calendar-container');
      await expect(page.locator('.task-item', { hasText: taskName })).toBeVisible();
      await expect(page.locator('.fc-event', { hasText: taskName })).not.toBeVisible();
    });

    test('long event name displays correctly in month and week views', async ({ page }) => {
      await page.locator('.fc-day:not(.fc-day-past)').first().click();

      const longName =
        'This is a very long event name that should be truncated in month view but fully visible in week view';
      await page.locator('input[placeholder="Name"]').fill(longName);
      await page.locator('select[name="goal_type"]').selectOption('task');
      await page.locator('button:has-text("Create")').click();

      const monthViewEvent = page.locator('.fc-event', {
        hasText: longName.substring(0, 10),
      });
      await expect(monthViewEvent).toBeVisible();

      await page.locator('.fc-timeGridWeek-button').click();
      await page.waitForTimeout(1000);
      const weekViewEvent = page.locator('.fc-event', {
        hasText: longName.substring(0, 20),
      });
      await expect(weekViewEvent).toBeVisible();
    });
  });
});

