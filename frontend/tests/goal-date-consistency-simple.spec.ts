import { test, expect } from '@playwright/test';

test.describe('Goal Date Consistency - Core Functionality', () => {
    test.beforeEach(async ({ page }) => {
        // Authentication is handled by global setup
        await page.goto('/calendar');
        await page.waitForSelector('.calendar-container', { timeout: 10000 });
        await page.waitForTimeout(2000); // Allow time for data to load
    });

    test('verify goal date consistency across calendar task list and list view', async ({ page }) => {
        // Test data - using specific dates that are easy to verify
        const testGoalName = `Date Consistency Test ${Date.now()}`;
        const testStartDate = '2024-03-15'; // March 15, 2024 (Friday)
        const testEndDate = '2024-03-25'; // March 25, 2024 (Monday)

        // Expected display formats
        const expectedStartDateDisplay = 'Fri, Mar 15, 2024';
        const expectedEndDateDisplay = 'Mon, Mar 25, 2024';

        console.log('Creating goal with test dates...');

        // Step 1: Create a goal with specific dates
        await page.locator('.calendar-sidebar button:has-text("Add Task")').click();
        await expect(page.locator('div[role="dialog"]')).toBeVisible();

        // Fill in goal details
        const nameInput = page.locator('div[role="dialog"] input').first();
        await nameInput.fill(testGoalName);

        // Set start date
        const startDateInput = page.locator('input[type="date"]').first();
        await startDateInput.fill(testStartDate);

        // Set end date
        const endDateInput = page.locator('input[type="date"]').nth(1);
        await endDateInput.fill(testEndDate);

        // Create the goal
        await page.locator('button:has-text("Create")').first().click();

        // Wait for dialog to close (with generous timeout)
        await page.waitForTimeout(5000);

        // Check if dialog is still open and handle it
        const dialogStillOpen = await page.locator('div[role="dialog"]').isVisible();
        if (dialogStillOpen) {
            console.log('Dialog still open, checking for errors...');
            const dialogContent = await page.locator('div[role="dialog"]').textContent();
            console.log('Dialog content:', dialogContent);

            // Try to close it
            await page.locator('button:has-text("Cancel")').click();
            await page.waitForTimeout(1000);
        }

        console.log('Goal creation attempted');

        // Step 2: Verify dates in Calendar Task List
        console.log('Verifying dates in Calendar Task List...');

        // Wait for the task to appear
        await page.waitForTimeout(3000);

        // Debug: Check what tasks are in the sidebar
        const allTasks = page.locator('.external-event');
        const taskCount = await allTasks.count();
        console.log(`Found ${taskCount} tasks in sidebar`);

        // Look for our specific task
        const taskListItem = page.locator('.external-event').filter({ hasText: testGoalName });
        const taskExists = await taskListItem.count() > 0;

        if (taskExists) {
            console.log('Task found in sidebar!');

            // Get the task content to verify date format
            const taskContent = await taskListItem.textContent();
            console.log('Task content:', taskContent);

            // Verify date information in the task item
            await expect(taskListItem).toContainText('Start: Fri, Mar 15, 2024');
            await expect(taskListItem).toContainText('Due: Mon, Mar 25, 2024');

            // Click on the task to open details
            await taskListItem.click();
            await expect(page.locator('div[role="dialog"]')).toBeVisible();

            // Verify dates in the goal view dialog
            await expect(page.locator('div[role="dialog"]')).toContainText(expectedStartDateDisplay);
            await expect(page.locator('div[role="dialog"]')).toContainText(expectedEndDateDisplay);

            // Close the dialog
            await page.locator('button:has-text("Close")').click();
            await expect(page.locator('div[role="dialog"]')).not.toBeVisible();

            // Step 3: Verify dates in List View
            console.log('Verifying dates in List View...');

            await page.goto('/list');
            await page.waitForSelector('.list-container', { timeout: 10000 });
            await page.waitForTimeout(2000);

            // Find the goal row in the table
            const goalRow = page.locator('tr').filter({ hasText: testGoalName });
            await expect(goalRow).toBeVisible();

            // Verify date columns
            await expect(goalRow).toContainText('3/15/2024');
            await expect(goalRow).toContainText('3/25/2024');

            // Click on the goal to open details
            await goalRow.click();
            await expect(page.locator('div[role="dialog"]')).toBeVisible();

            // Verify dates in the goal view dialog from list
            await expect(page.locator('div[role="dialog"]')).toContainText(expectedStartDateDisplay);
            await expect(page.locator('div[role="dialog"]')).toContainText(expectedEndDateDisplay);

            await page.locator('button:has-text("Close")').click();
            await expect(page.locator('div[role="dialog"]')).not.toBeVisible();

            // Step 4: Verify dates in Edit Mode
            console.log('Verifying dates in Edit Mode...');

            // Go back to calendar
            await page.goto('/calendar');
            await page.waitForSelector('.calendar-container', { timeout: 10000 });
            await page.waitForTimeout(2000);

            // Right-click on the task to open in edit mode
            const editTaskItem = page.locator('.external-event').filter({ hasText: testGoalName });
            await expect(editTaskItem).toBeVisible();
            await editTaskItem.click({ button: 'right' });

            await expect(page.locator('div[role="dialog"]')).toBeVisible();
            await expect(page.locator('div[role="dialog"]')).toContainText('Edit Goal');

            // Verify the input fields have the correct values
            await expect(page.locator('input[type="date"]').first()).toHaveValue(testStartDate);
            await expect(page.locator('input[type="date"]').nth(1)).toHaveValue(testEndDate);

            await page.locator('button:has-text("Cancel")').click();
            await expect(page.locator('div[role="dialog"]')).not.toBeVisible();

            console.log('✅ Date consistency verification completed successfully!');

        } else {
            console.log('❌ Task was not created successfully');

            // Still check if we can find any tasks with similar names (for debugging)
            for (let i = 0; i < Math.min(taskCount, 5); i++) {
                const taskText = await allTasks.nth(i).textContent();
                console.log(`Existing task ${i}: ${taskText}`);
            }

            // Fail the test with useful information
            throw new Error(`Goal "${testGoalName}" was not created successfully. Found ${taskCount} tasks in sidebar but none matched our goal name.`);
        }
    });

    test('verify existing task date consistency', async ({ page }) => {
        // This test verifies date consistency using existing tasks in the system
        console.log('Checking existing tasks for date consistency...');

        // Wait for tasks to load
        await page.waitForTimeout(3000);

        // Find any existing task
        const allTasks = page.locator('.external-event');
        const taskCount = await allTasks.count();
        console.log(`Found ${taskCount} existing tasks`);

        if (taskCount > 0) {
            // Use the first task for testing
            const firstTask = allTasks.first();
            const taskContent = await firstTask.textContent();
            console.log('Testing with existing task:', taskContent);

            // Extract the task name for identification
            const taskName = taskContent?.split('task')[0] || 'Unknown Task';

            // Click on the task to open details in calendar view
            await firstTask.click();
            await expect(page.locator('div[role="dialog"]')).toBeVisible();

            // Capture the date information from calendar view
            const calendarDialogContent = await page.locator('div[role="dialog"]').textContent();
            console.log('Calendar view dialog content:', calendarDialogContent);

            await page.locator('button:has-text("Close")').click();
            await expect(page.locator('div[role="dialog"]')).not.toBeVisible();

            // Navigate to list view and verify same dates
            await page.goto('/list');
            await page.waitForSelector('.list-container', { timeout: 10000 });
            await page.waitForTimeout(2000);

            // Find the same goal in the list
            const goalRow = page.locator('tr').filter({ hasText: taskName.trim() });
            if (await goalRow.count() > 0) {
                await goalRow.click();
                await expect(page.locator('div[role="dialog"]')).toBeVisible();

                // Capture the date information from list view
                const listDialogContent = await page.locator('div[role="dialog"]').textContent();
                console.log('List view dialog content:', listDialogContent);

                await page.locator('button:has-text("Close")').click();

                // Compare date formats - they should contain the same date strings
                const calendarDates: string[] = calendarDialogContent?.match(/\w{3}, \w{3} \d{1,2}, \d{4}/g) || [];
                const listDates: string[] = listDialogContent?.match(/\w{3}, \w{3} \d{1,2}, \d{4}/g) || [];

                console.log('Calendar dates found:', calendarDates);
                console.log('List dates found:', listDates);

                // Verify that we found dates and they match
                expect(calendarDates.length).toBeGreaterThan(0);
                expect(listDates.length).toBeGreaterThan(0);

                // Check that at least one date appears in both views
                const hasMatchingDate = calendarDates.some((date: string) => listDates.includes(date));
                expect(hasMatchingDate).toBeTruthy();

                console.log('✅ Date consistency verified for existing task!');
            } else {
                console.log('Could not find task in list view');
            }
        } else {
            console.log('No existing tasks found to test with');
        }
    });
}); 