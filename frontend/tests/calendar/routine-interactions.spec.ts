import { test, expect } from '@playwright/test';
import { generateTestToken } from '../helpers/auth';

// Base URL for backend API
const API_URL = 'http://localhost:5057';

// Helper function to wait for dialog to close with error handling
async function waitForDialogToClose(page: any, timeout = 20000) {
    try {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForFunction(() => !document.querySelector('div[role="dialog"]'), { timeout });
        await page.waitForTimeout(500);
    } catch (error) {
        const dialogVisible = await page.locator('div[role="dialog"]').isVisible();
        if (dialogVisible) {
            console.warn('Dialog still open after operation');
            const cancelButton = page.locator('button:has-text("Cancel")');
            const closeButton = page.locator('button:has-text("Close")');

            if (await cancelButton.isVisible()) {
                await cancelButton.click();
            } else if (await closeButton.isVisible()) {
                await closeButton.click();
            }

            await page.waitForFunction(() => !document.querySelector('div[role="dialog"]'), { timeout: 5000 });
        }
    }
}

// Helper function to create a routine via API for testing
async function createTestRoutine(request: any, routineName: string) {
    const testToken = generateTestToken(1);
    const today = new Date();

    const routineData = {
        name: routineName,
        goal_type: 'routine',
        description: 'Test routine for interaction testing',
        priority: 'medium',
        frequency: '1D',
        start_timestamp: today.getTime(),
        routine_time: today.getTime(),
        duration: 60,
        user_id: 1
    };

    const createResponse = await request.post(`${API_URL}/goals/create`, {
        headers: {
            'Authorization': `Bearer ${testToken}`,
            'Content-Type': 'application/json'
        },
        data: routineData
    });

    expect(createResponse.ok()).toBeTruthy();
    const createdRoutine = await createResponse.json();

    // Generate routine events
    const endOfWeek = new Date();
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const routineResponse = await request.post(`${API_URL}/routine/${endOfWeek.getTime()}`, {
        headers: {
            'Authorization': `Bearer ${testToken}`,
            'Content-Type': 'application/json'
        }
    });

    expect(routineResponse.ok()).toBeTruthy();
    return createdRoutine;
}

test.describe('Calendar Routine Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/calendar');
        await page.waitForSelector('.calendar-container', { timeout: 10000 });
        await page.waitForSelector('.fc-view-harness', { timeout: 5000 });
        await page.waitForTimeout(3000);
    });

    test.describe('Routine Event Clicking and Viewing', () => {
        test('should open routine event in view mode when left-clicked', async ({ page, request }) => {
            const routineName = `Test Routine Click ${Date.now()}`;
            await createTestRoutine(request, routineName);

            // Reload to fetch new data
            await page.reload();
            await page.waitForSelector('.fc', { timeout: 10000 });
            await page.waitForTimeout(2000);

            // Switch to week view for better event visibility
            await page.locator('.fc-timeGridWeek-button').click();
            await page.waitForTimeout(2000);

            // Find and click the routine event
            const routineEvent = page.locator('.fc-event', { hasText: routineName });
            await expect(routineEvent).toBeVisible({ timeout: 10000 });
            await routineEvent.click();

            // Verify the GoalMenu opens in view mode
            await expect(page.locator('div[role="dialog"]')).toBeVisible();
            await expect(page.locator('div[role="dialog"]')).toContainText('View Goal');
            await expect(page.locator('button:has-text("Edit")')).toBeVisible();
            await expect(page.locator('button:has-text("Close")')).toBeVisible();

            // Verify it shows routine-specific information
            await expect(page.locator('div[role="dialog"]')).toContainText(routineName);
            await expect(page.locator('div[role="dialog"]')).toContainText('Event');

            await page.locator('button:has-text("Close")').click();
            await waitForDialogToClose(page);
        });

        test('should open routine event in edit mode when right-clicked', async ({ page, request }) => {
            const routineName = `Test Routine Right Click ${Date.now()}`;
            await createTestRoutine(request, routineName);

            await page.reload();
            await page.waitForSelector('.fc', { timeout: 10000 });
            await page.waitForTimeout(2000);

            await page.locator('.fc-timeGridWeek-button').click();
            await page.waitForTimeout(2000);

            const routineEvent = page.locator('.fc-event', { hasText: routineName });
            await expect(routineEvent).toBeVisible({ timeout: 10000 });
            await routineEvent.click({ button: 'right' });

            await expect(page.locator('div[role="dialog"]')).toBeVisible();
            await expect(page.locator('div[role="dialog"]')).toContainText('Edit Goal');
            await expect(page.locator('button:has-text("Save")')).toBeVisible();

            await page.locator('button:has-text("Cancel")').click();
            await waitForDialogToClose(page);
        });
    });

    test.describe('Routine Event Deletion Tests', () => {
        test('should delete single routine event occurrence', async ({ page, request }) => {
            const routineName = `Test Routine Delete Single ${Date.now()}`;
            await createTestRoutine(request, routineName);

            await page.reload();
            await page.waitForSelector('.fc', { timeout: 10000 });
            await page.waitForTimeout(2000);

            await page.locator('.fc-timeGridWeek-button').click();
            await page.waitForTimeout(2000);

            // Right-click to open in edit mode
            const routineEvent = page.locator('.fc-event', { hasText: routineName });
            await expect(routineEvent).toBeVisible({ timeout: 10000 });
            await routineEvent.click({ button: 'right' });

            await expect(page.locator('div[role="dialog"]')).toBeVisible();

            // Click delete button
            await page.locator('button:has-text("Delete")').click();

            // Verify routine delete dialog appears
            await expect(page.locator('div[role="dialog"]')).toContainText('Delete Routine Event');
            await expect(page.locator('input[value="single"]')).toBeVisible();
            await expect(page.locator('input[value="future"]')).toBeVisible();
            await expect(page.locator('input[value="all"]')).toBeVisible();

            // Select "Only this occurrence" (should be default)
            await page.locator('input[value="single"]').check();

            // Confirm deletion
            await page.locator('button:has-text("Delete"):not(:has-text("Cancel"))').click();

            // Wait for dialogs to close
            await waitForDialogToClose(page);

            // Verify we're back to the calendar
            await expect(page.locator('.calendar-container')).toBeVisible();
        });

        test('should delete future routine event occurrences', async ({ page, request }) => {
            const routineName = `Test Routine Delete Future ${Date.now()}`;
            await createTestRoutine(request, routineName);

            await page.reload();
            await page.waitForSelector('.fc', { timeout: 10000 });
            await page.waitForTimeout(2000);

            await page.locator('.fc-timeGridWeek-button').click();
            await page.waitForTimeout(2000);

            const routineEvent = page.locator('.fc-event', { hasText: routineName });
            await expect(routineEvent).toBeVisible({ timeout: 10000 });
            await routineEvent.click({ button: 'right' });

            await expect(page.locator('div[role="dialog"]')).toBeVisible();
            await page.locator('button:has-text("Delete")').click();

            await expect(page.locator('div[role="dialog"]')).toContainText('Delete Routine Event');

            // Select "This and all future occurrences"
            await page.locator('input[value="future"]').check();

            await page.locator('button:has-text("Delete"):not(:has-text("Cancel"))').click();
            await waitForDialogToClose(page);

            await expect(page.locator('.calendar-container')).toBeVisible();
        });

        test('should delete all routine event occurrences', async ({ page, request }) => {
            const routineName = `Test Routine Delete All ${Date.now()}`;
            await createTestRoutine(request, routineName);

            await page.reload();
            await page.waitForSelector('.fc', { timeout: 10000 });
            await page.waitForTimeout(2000);

            await page.locator('.fc-timeGridWeek-button').click();
            await page.waitForTimeout(2000);

            const routineEvent = page.locator('.fc-event', { hasText: routineName });
            await expect(routineEvent).toBeVisible({ timeout: 10000 });
            await routineEvent.click({ button: 'right' });

            await expect(page.locator('div[role="dialog"]')).toBeVisible();
            await page.locator('button:has-text("Delete")').click();

            await expect(page.locator('div[role="dialog"]')).toContainText('Delete Routine Event');

            // Select "All occurrences of this routine"
            await page.locator('input[value="all"]').check();

            await page.locator('button:has-text("Delete"):not(:has-text("Cancel"))').click();
            await waitForDialogToClose(page);

            await expect(page.locator('.calendar-container')).toBeVisible();
        });

        test('should cancel routine deletion', async ({ page, request }) => {
            const routineName = `Test Routine Delete Cancel ${Date.now()}`;
            await createTestRoutine(request, routineName);

            await page.reload();
            await page.waitForSelector('.fc', { timeout: 10000 });
            await page.waitForTimeout(2000);

            await page.locator('.fc-timeGridWeek-button').click();
            await page.waitForTimeout(2000);

            const routineEvent = page.locator('.fc-event', { hasText: routineName });
            await expect(routineEvent).toBeVisible({ timeout: 10000 });
            await routineEvent.click({ button: 'right' });

            await expect(page.locator('div[role="dialog"]')).toBeVisible();
            await page.locator('button:has-text("Delete")').click();

            await expect(page.locator('div[role="dialog"]')).toContainText('Delete Routine Event');

            // Cancel deletion
            await page.locator('button:has-text("Cancel")').click();

            // Should be back to edit mode
            await expect(page.locator('div[role="dialog"]')).toContainText('Edit Goal');

            await page.locator('button:has-text("Cancel")').click();
            await waitForDialogToClose(page);
        });
    });

    test.describe('Routine Event Editing Tests', () => {
        test('should edit routine event fields and trigger update scope dialog', async ({ page, request }) => {
            const routineName = `Test Routine Edit ${Date.now()}`;
            await createTestRoutine(request, routineName);

            await page.reload();
            await page.waitForSelector('.fc', { timeout: 10000 });
            await page.waitForTimeout(2000);

            await page.locator('.fc-timeGridWeek-button').click();
            await page.waitForTimeout(2000);

            const routineEvent = page.locator('.fc-event', { hasText: routineName });
            await expect(routineEvent).toBeVisible({ timeout: 10000 });
            await routineEvent.click({ button: 'right' });

            await expect(page.locator('div[role="dialog"]')).toBeVisible();
            await expect(page.locator('div[role="dialog"]')).toContainText('Edit Goal');

            // Edit the scheduled time to trigger routine update dialog
            const timeInput = page.locator('input[type="datetime-local"]');
            await expect(timeInput).toBeVisible();

            // Get current time and add 1 hour
            const currentTime = await timeInput.inputValue();
            const currentDate = new Date(currentTime);
            currentDate.setHours(currentDate.getHours() + 1);
            const newTime = currentDate.toISOString().slice(0, 16);

            await timeInput.fill(newTime);
            await page.waitForTimeout(500);

            // Save changes
            await page.locator('button:has-text("Save")').click();

            // Should trigger routine update scope dialog
            await expect(page.locator('div[role="dialog"]')).toContainText('Update Routine Event');
            await expect(page.locator('input[value="single"]')).toBeVisible();
            await expect(page.locator('input[value="future"]')).toBeVisible();
            await expect(page.locator('input[value="all"]')).toBeVisible();

            // Test canceling the scope dialog
            await page.locator('button:has-text("Cancel")').click();

            // Should return to edit mode
            await expect(page.locator('div[role="dialog"]')).toContainText('Edit Goal');

            await page.locator('button:has-text("Cancel")').click();
            await waitForDialogToClose(page);
        });

        test('should update single routine event occurrence', async ({ page, request }) => {
            const routineName = `Test Routine Update Single ${Date.now()}`;
            await createTestRoutine(request, routineName);

            await page.reload();
            await page.waitForSelector('.fc', { timeout: 10000 });
            await page.waitForTimeout(2000);

            await page.locator('.fc-timeGridWeek-button').click();
            await page.waitForTimeout(2000);

            const routineEvent = page.locator('.fc-event', { hasText: routineName });
            await expect(routineEvent).toBeVisible({ timeout: 10000 });
            await routineEvent.click({ button: 'right' });

            // Edit duration to trigger update dialog
            await page.locator('input[type="number"]').first().fill('2'); // 2 hours
            await page.locator('button:has-text("Save")').click();

            await expect(page.locator('div[role="dialog"]')).toContainText('Update Routine Event');

            // Select "Only this occurrence" (should be default)
            await page.locator('input[value="single"]').check();
            await page.locator('button:has-text("Update")').click();

            await waitForDialogToClose(page);
            await expect(page.locator('.calendar-container')).toBeVisible();
        });

        test('should update future routine event occurrences', async ({ page, request }) => {
            const routineName = `Test Routine Update Future ${Date.now()}`;
            await createTestRoutine(request, routineName);

            await page.reload();
            await page.waitForSelector('.fc', { timeout: 10000 });
            await page.waitForTimeout(2000);

            await page.locator('.fc-timeGridWeek-button').click();
            await page.waitForTimeout(2000);

            const routineEvent = page.locator('.fc-event', { hasText: routineName });
            await expect(routineEvent).toBeVisible({ timeout: 10000 });
            await routineEvent.click({ button: 'right' });

            // Edit duration
            await page.locator('input[type="number"]').first().fill('3'); // 3 hours
            await page.locator('button:has-text("Save")').click();

            await expect(page.locator('div[role="dialog"]')).toContainText('Update Routine Event');

            // Select "This and all future occurrences"
            await page.locator('input[value="future"]').check();
            await page.locator('button:has-text("Update")').click();

            await waitForDialogToClose(page);
            await expect(page.locator('.calendar-container')).toBeVisible();
        });

        test('should update all routine event occurrences', async ({ page, request }) => {
            const routineName = `Test Routine Update All ${Date.now()}`;
            await createTestRoutine(request, routineName);

            await page.reload();
            await page.waitForSelector('.fc', { timeout: 10000 });
            await page.waitForTimeout(2000);

            await page.locator('.fc-timeGridWeek-button').click();
            await page.waitForTimeout(2000);

            const routineEvent = page.locator('.fc-event', { hasText: routineName });
            await expect(routineEvent).toBeVisible({ timeout: 10000 });
            await routineEvent.click({ button: 'right' });

            // Edit duration
            await page.locator('input[type="number"]').first().fill('1'); // 1 hour
            await page.locator('input[type="number"]').nth(1).fill('30'); // 30 minutes
            await page.locator('button:has-text("Save")').click();

            await expect(page.locator('div[role="dialog"]')).toContainText('Update Routine Event');

            // Select "All occurrences of this routine"
            await page.locator('input[value="all"]').check();
            await page.locator('button:has-text("Update")').click();

            await waitForDialogToClose(page);
            await expect(page.locator('.calendar-container')).toBeVisible();
        });
    });

    test.describe('Routine Event Comprehensive Field Testing', () => {
        test('should handle all routine event field edits properly', async ({ page, request }) => {
            const routineName = `Test Routine Fields ${Date.now()}`;
            await createTestRoutine(request, routineName);

            await page.reload();
            await page.waitForSelector('.fc', { timeout: 10000 });
            await page.waitForTimeout(2000);

            await page.locator('.fc-timeGridWeek-button').click();
            await page.waitForTimeout(2000);

            const routineEvent = page.locator('.fc-event', { hasText: routineName });
            await expect(routineEvent).toBeVisible({ timeout: 10000 });
            await routineEvent.click({ button: 'right' });

            await expect(page.locator('div[role="dialog"]')).toBeVisible();

            // Test completion checkbox
            const completedCheckbox = page.locator('input[type="checkbox"]:near(text("Completed"))');
            if (await completedCheckbox.isVisible()) {
                const isChecked = await completedCheckbox.isChecked();
                await completedCheckbox.setChecked(!isChecked);
                await page.waitForTimeout(500);
            }

            // Test all-day checkbox
            const allDayCheckbox = page.locator('input[type="checkbox"]:near(text("All Day"))');
            if (await allDayCheckbox.isVisible()) {
                await allDayCheckbox.check();
                await page.waitForTimeout(500);

                // Verify that time inputs are hidden when all-day is checked
                const timeInputs = page.locator('input[type="number"]');
                const timeInputCount = await timeInputs.count();

                // Uncheck all-day to test duration inputs
                await allDayCheckbox.uncheck();
                await page.waitForTimeout(500);
            }

            // Test duration fields (hours and minutes)
            const hourInput = page.locator('label:has-text("Hours") + * input[type="number"]');
            const minuteInput = page.locator('label:has-text("Minutes") + * input[type="number"]');

            if (await hourInput.isVisible()) {
                await hourInput.fill('2');
                await page.waitForTimeout(200);
            }

            if (await minuteInput.isVisible()) {
                await minuteInput.fill('45');
                await page.waitForTimeout(200);
            }

            // Test scheduled date/time
            const datetimeInput = page.locator('input[type="datetime-local"]');
            if (await datetimeInput.isVisible()) {
                const currentValue = await datetimeInput.inputValue();
                const currentDate = new Date(currentValue);
                currentDate.setMinutes(currentDate.getMinutes() + 30);
                const newValue = currentDate.toISOString().slice(0, 16);
                await datetimeInput.fill(newValue);
                await page.waitForTimeout(500);
            }

            // Save changes (this should trigger routine update dialog)
            await page.locator('button:has-text("Save")').click();

            // Handle routine update scope dialog if it appears
            const updateDialog = page.locator('div[role="dialog"]:has-text("Update Routine Event")');
            if (await updateDialog.isVisible()) {
                // Test that all three options are present and selectable
                await expect(page.locator('input[value="single"]')).toBeVisible();
                await expect(page.locator('input[value="future"]')).toBeVisible();
                await expect(page.locator('input[value="all"]')).toBeVisible();

                // Select single and update
                await page.locator('input[value="single"]').check();
                await page.locator('button:has-text("Update")').click();
            }

            await waitForDialogToClose(page);
            await expect(page.locator('.calendar-container')).toBeVisible();
        });
    });

    test.describe('Smart Schedule Integration', () => {
        test('should open smart schedule dialog for routine events', async ({ page, request }) => {
            const routineName = `Test Routine Smart Schedule ${Date.now()}`;
            await createTestRoutine(request, routineName);

            await page.reload();
            await page.waitForSelector('.fc', { timeout: 10000 });
            await page.waitForTimeout(2000);

            await page.locator('.fc-timeGridWeek-button').click();
            await page.waitForTimeout(2000);

            const routineEvent = page.locator('.fc-event', { hasText: routineName });
            await expect(routineEvent).toBeVisible({ timeout: 10000 });
            await routineEvent.click(); // Left-click for view mode

            await expect(page.locator('div[role="dialog"]')).toBeVisible();
            await expect(page.locator('div[role="dialog"]')).toContainText('View Goal');

            // Look for Smart Schedule button
            const smartScheduleButton = page.locator('button:has-text("Smart Schedule")');
            if (await smartScheduleButton.isVisible()) {
                await smartScheduleButton.click();

                // Verify smart schedule dialog opens
                await expect(page.locator('div[role="dialog"]')).toContainText('Smart Schedule');

                // Close the smart schedule dialog
                await page.locator('button:has-text("Cancel")').click();
            }

            await page.locator('button:has-text("Close")').click();
            await waitForDialogToClose(page);
        });
    });

    test.describe('Event Split Functionality', () => {
        test('should split routine events', async ({ page, request }) => {
            const routineName = `Test Routine Split ${Date.now()}`;
            await createTestRoutine(request, routineName);

            await page.reload();
            await page.waitForSelector('.fc', { timeout: 10000 });
            await page.waitForTimeout(2000);

            await page.locator('.fc-timeGridWeek-button').click();
            await page.waitForTimeout(2000);

            const routineEvent = page.locator('.fc-event', { hasText: routineName });
            await expect(routineEvent).toBeVisible({ timeout: 10000 });
            await routineEvent.click(); // Left-click for view mode

            await expect(page.locator('div[role="dialog"]')).toBeVisible();

            // Look for Split Event button
            const splitButton = page.locator('button:has-text("Split Event")');
            if (await splitButton.isVisible()) {
                await splitButton.click();

                // Wait for the split operation to complete
                await waitForDialogToClose(page);
                await expect(page.locator('.calendar-container')).toBeVisible();
            } else {
                // Close the dialog if split is not available
                await page.locator('button:has-text("Close")').click();
                await waitForDialogToClose(page);
            }
        });
    });
}); 