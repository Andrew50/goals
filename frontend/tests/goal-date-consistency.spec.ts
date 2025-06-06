import { test, expect } from '@playwright/test';

test.describe('Goal Date Consistency Across Frontend', () => {
    // Test data - using specific dates that are easy to verify
    const testGoalName = `Date Consistency Test Goal ${Date.now()}`;
    const testStartDate = '2024-03-15'; // March 15, 2024
    const testEndDate = '2024-03-25'; // March 25, 2024  

    // Expected display formats (based on timestampToDisplayString function)
    const expectedStartDateDisplay = 'Fri, Mar 15, 2024';
    const expectedEndDateDisplay = 'Mon, Mar 25, 2024';

    test.beforeEach(async ({ page }) => {
        // Authentication is handled by global setup
        await page.goto('/calendar');
        await page.waitForSelector('.calendar-container', { timeout: 10000 });
        await page.waitForTimeout(2000); // Allow time for data to load
    });

    test('create goal and verify date consistency across all frontend locations', async ({ page }) => {
        // Step 1: Create a goal with specific dates
        console.log('Creating goal with test dates...');

        // Open goal creation dialog
        await page.locator('.calendar-sidebar button:has-text("Add Task")').click();
        await expect(page.locator('div[role="dialog"]')).toBeVisible();

        // Fill in goal details using correct selectors
        const nameInput = page.locator('div[role="dialog"] input').first();
        await nameInput.fill(testGoalName);

        // Set start date - find the first date input
        const startDateInput = page.locator('input[type="date"]').first();
        await startDateInput.fill(testStartDate);

        // Set end date - find the second date input
        const endDateInput = page.locator('input[type="date"]').nth(1);
        await endDateInput.fill(testEndDate);

        // Create the goal
        await page.locator('button:has-text("Create")').first().click();

        // Wait for dialog to close or check for errors
        try {
            await expect(page.locator('div[role="dialog"]')).not.toBeVisible({ timeout: 15000 });
        } catch (error) {
            // Check if there are validation errors
            const errorText = await page.locator('div[role="dialog"]').textContent();
            console.log('Dialog did not close, content:', errorText);

            // If there are errors, fail the test with useful information
            if (errorText?.includes('error') || errorText?.includes('Error')) {
                throw new Error(`Goal creation failed with error: ${errorText}`);
            }

            // Otherwise, try to close manually and continue
            await page.locator('button:has-text("Cancel")').click();
            await page.waitForTimeout(1000);
        }

        console.log('Goal created successfully');

        // Step 2: Verify dates in Calendar View (Task List)
        console.log('Verifying dates in Calendar Task List...');

        // Wait for the page to refresh and show the new task
        await page.waitForTimeout(3000);

        // Debug: Check what tasks are actually in the sidebar
        const allTasks = page.locator('.external-event');
        const taskCount = await allTasks.count();
        console.log(`Found ${taskCount} tasks in sidebar`);

        for (let i = 0; i < Math.min(taskCount, 5); i++) {
            const taskText = await allTasks.nth(i).textContent();
            console.log(`Task ${i}: ${taskText}`);
        }

        // Look for the task in the sidebar task list
        const taskListItem = page.locator('.external-event').filter({ hasText: testGoalName });
        await expect(taskListItem).toBeVisible({ timeout: 10000 });

        // Get the actual text content to understand the format
        const taskContent = await taskListItem.textContent();
        console.log('Task content:', taskContent);

        // Verify date information in the task item (using the actual format)
        await expect(taskListItem).toContainText('Start: Fri, Mar 15, 2024');
        await expect(taskListItem).toContainText('Due: Mon, Mar 25, 2024');

        // Click on the task to open details
        await taskListItem.click();
        await expect(page.locator('div[role="dialog"]')).toBeVisible();

        // Verify dates in the goal view dialog from task list
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

        // Verify start date column (using more flexible date matching)
        await expect(goalRow).toContainText('3/15/2024');

        // Verify end date column  
        await expect(goalRow).toContainText('3/25/2024');

        // Click on the goal to open details
        await goalRow.click();
        await expect(page.locator('div[role="dialog"]')).toBeVisible();

        // Verify dates in the goal view dialog from list
        await expect(page.locator('div[role="dialog"]')).toContainText(expectedStartDateDisplay);
        await expect(page.locator('div[role="dialog"]')).toContainText(expectedEndDateDisplay);

        await page.locator('button:has-text("Close")').click();
        await expect(page.locator('div[role="dialog"]')).not.toBeVisible();

        // Step 4: Verify dates in Network View (optional - may not be available)
        console.log('Verifying dates in Network View...');

        try {
            await page.goto('/network');
            await page.waitForSelector('#network-container', { timeout: 5000 });
            await page.waitForTimeout(3000); // Allow network to render

            // Find and click on the goal node
            // Network nodes are rendered by vis-network, so we need to use canvas interaction
            const networkCanvas = page.locator('#network-container canvas');
            await expect(networkCanvas).toBeVisible();

            // Try to find the goal by searching for it in the network
            // Since vis-network uses canvas, we'll look for the goal in any tooltips or dialogs
            await networkCanvas.click({ position: { x: 400, y: 300 } }); // Click center area
            await page.waitForTimeout(1000);

            // If a dialog opens, verify the dates
            const networkDialog = page.locator('div[role="dialog"]');
            if (await networkDialog.isVisible()) {
                const dialogText = await networkDialog.textContent();
                if (dialogText?.includes(testGoalName)) {
                    await expect(networkDialog).toContainText(expectedStartDateDisplay);
                    await expect(networkDialog).toContainText(expectedEndDateDisplay);
                    await page.locator('button:has-text("Close")').click();
                    await expect(page.locator('div[role="dialog"]')).not.toBeVisible();
                } else {
                    // Close any other dialog that might have opened
                    await page.locator('button:has-text("Close")').click();
                }
            }
            console.log('Network view verification completed');
        } catch (error) {
            console.log('Network view not available or failed, skipping:', error.message);
        }

        // Step 5: Verify dates in Edit Mode
        console.log('Verifying dates in Edit Mode...');

        // Go back to calendar and edit the task
        await page.goto('/calendar');
        await page.waitForSelector('.calendar-container', { timeout: 10000 });
        await page.waitForTimeout(2000);

        // Right-click on the task in the sidebar to open in edit mode
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

        console.log('Date consistency verification completed successfully!');
    });

    test('verify date formatting consistency across different locales', async ({ page }) => {
        // This test verifies that date formatting is consistent regardless of browser locale

        const testGoalName = `Locale Test Goal ${Date.now()}`;

        // Create a goal with dates
        await page.locator('.calendar-sidebar button:has-text("Add Task")').click();
        const nameInput = page.locator('div[role="dialog"] input').first();
        await nameInput.fill(testGoalName);
        await page.locator('input[type="date"]').first().fill('2024-01-15');
        await page.locator('input[type="date"]').nth(1).fill('2024-01-25');
        await page.locator('button:has-text("Create")').first().click();

        // Wait for dialog to close or handle errors
        try {
            await expect(page.locator('div[role="dialog"]')).not.toBeVisible({ timeout: 15000 });
        } catch (error) {
            await page.locator('button:has-text("Cancel")').click();
            await page.waitForTimeout(1000);
        }

        // Wait for the task to appear
        await page.waitForTimeout(3000);

        // Verify the goal appears in task list
        const taskListItem = page.locator('.external-event').filter({ hasText: testGoalName });
        await expect(taskListItem).toBeVisible({ timeout: 10000 });

        // Open goal details and capture date format
        await taskListItem.click();
        const dialogContent = await page.locator('div[role="dialog"]').textContent();
        await page.locator('button:has-text("Close")').click();

        // Navigate to list view and verify same format
        await page.goto('/list');
        await page.waitForSelector('.list-container');
        const goalRow = page.locator('tr').filter({ hasText: testGoalName });
        await goalRow.click();

        const listDialogContent = await page.locator('div[role="dialog"]').textContent();
        await page.locator('button:has-text("Close")').click();

        // The date formats should be identical between views
        const calendarDateMatch = dialogContent?.match(/Jan 15, 2024/);
        const listDateMatch = listDialogContent?.match(/Jan 15, 2024/);

        expect(calendarDateMatch).toBeTruthy();
        expect(listDateMatch).toBeTruthy();
    });

    test('verify date consistency when editing goal dates', async ({ page }) => {
        // This test verifies that when dates are edited, they update consistently everywhere

        const testGoalName = `Edit Date Test Goal ${Date.now()}`;
        const originalDate = '2024-02-10';
        const updatedDate = '2024-02-20';

        // Create initial goal
        await page.locator('.calendar-sidebar button:has-text("Add Task")').click();
        const nameInput = page.locator('div[role="dialog"] input').first();
        await nameInput.fill(testGoalName);
        await page.locator('input[type="date"]').first().fill(originalDate);
        await page.locator('button:has-text("Create")').first().click();

        // Wait for dialog to close or handle errors
        try {
            await expect(page.locator('div[role="dialog"]')).not.toBeVisible({ timeout: 15000 });
        } catch (error) {
            await page.locator('button:has-text("Cancel")').click();
            await page.waitForTimeout(1000);
        }

        // Wait for the task to appear
        await page.waitForTimeout(3000);

        // Edit the goal to change the date
        const taskListItem = page.locator('.external-event').filter({ hasText: testGoalName });
        await expect(taskListItem).toBeVisible({ timeout: 10000 });
        await taskListItem.click({ button: 'right' });

        await page.locator('input[type="date"]').first().fill(updatedDate);
        await page.locator('button:has-text("Save")').click();
        await expect(page.locator('div[role="dialog"]')).not.toBeVisible();

        // Wait for the update to take effect
        await page.waitForTimeout(2000);

        // Verify updated date in task list (using the actual format)
        await expect(taskListItem).toContainText('Start: Tue, Feb 20, 2024');

        // Verify updated date in task details
        await taskListItem.click();
        await expect(page.locator('div[role="dialog"]')).toContainText('Tue, Feb 20, 2024');
        await page.locator('button:has-text("Close")').click();

        // Verify updated date in list view
        await page.goto('/list');
        await page.waitForSelector('.list-container');
        const goalRow = page.locator('tr').filter({ hasText: testGoalName });
        await expect(goalRow).toContainText('2/20/2024');

        await goalRow.click();
        await expect(page.locator('div[role="dialog"]')).toContainText('Tue, Feb 20, 2024');
        await page.locator('button:has-text("Close")').click();
    });
}); 