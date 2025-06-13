import { test, expect } from '@playwright/test';

// Helper function to wait for dialog to close
async function waitForDialogToClose(page: any, timeout = 20000) {
    try {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForFunction(() => !document.querySelector('div[role="dialog"]'), { timeout });
        await page.waitForTimeout(500);
    } catch (error) {
        const dialogVisible = await page.locator('div[role="dialog"]').isVisible();
        if (dialogVisible) {
            console.warn('Dialog still open, attempting to close...');
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

// Helper function to get the date for next Thursday
function getNextThursday(): Date {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 4 = Thursday
    const daysUntilThursday = (4 - dayOfWeek + 7) % 7;
    const nextThursday = new Date(today);
    nextThursday.setDate(today.getDate() + (daysUntilThursday === 0 ? 7 : daysUntilThursday));
    return nextThursday;
}

// Helper function to format date for calendar navigation
function formatDateForCalendar(date: Date): string {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
}

test.describe('Thursday to MWF Routine Creation Bug Reproduction', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to calendar
        await page.goto('/calendar');
        await page.waitForSelector('.calendar-container', { timeout: 10000 });
        await page.waitForSelector('.fc-view-harness', { timeout: 5000 });
        await page.waitForTimeout(3000); // Allow data to load
    });

    test('should create routine on Thursday with MWF repetition and verify events appear only on MWF', async ({ page }) => {
        console.log('🔍 Starting Thursday to MWF routine creation test...');

        // Step 1: Switch to week view (this is important for the user's workflow)
        console.log('📅 Switching to week view...');
        await page.locator('.fc-timeGridWeek-button').click();
        await page.waitForTimeout(1000);
        await expect(page.locator('.fc-timeGridWeek-view')).toBeVisible();

        // Step 2: Navigate to a week that contains a Thursday we can click
        const nextThursday = getNextThursday();
        console.log(`🗓️  Navigating to week containing Thursday: ${nextThursday.toDateString()}`);

        // Check if today button is enabled before clicking it
        const todayButton = page.locator('.fc-today-button');
        const isTodayButtonEnabled = await todayButton.isEnabled();

        if (isTodayButtonEnabled) {
            console.log('📍 Clicking today button to navigate to current week');
            await todayButton.click();
            await page.waitForTimeout(500);
        } else {
            console.log('📍 Today button disabled - already on current week');
        }

        // If Thursday is in the future, navigate forward
        const today = new Date();
        if (nextThursday > today) {
            const weeksToNavigate = Math.ceil((nextThursday.getTime() - today.getTime()) / (7 * 24 * 60 * 60 * 1000));
            console.log(`⏭️  Navigating forward ${weeksToNavigate} weeks to reach Thursday`);
            for (let i = 0; i < weeksToNavigate; i++) {
                await page.locator('.fc-next-button').click();
                await page.waitForTimeout(300);
            }
        }

        // Step 3: Click on Thursday to create a routine
        console.log('🖱️  Clicking on Thursday to create routine...');

        // Wait for the calendar to be fully loaded
        await page.waitForTimeout(1000);

        // Thursday is the 5th column (0-indexed: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4)
        // Use a more reliable selector for the Thursday column
        const thursdayColumn = page.locator('.fc-timegrid-col').nth(4);

        await expect(thursdayColumn).toBeVisible({ timeout: 10000 });
        console.log('✅ Thursday column found');

        // Click on Thursday around 10 AM (position y=200 should be around 10 AM)
        console.log('🖱️  Clicking on Thursday at approximately 10 AM...');
        await thursdayColumn.click({ position: { x: 50, y: 200 } });

        // Step 4: Goal menu should open - fill in routine details
        console.log('📝 Filling in routine details...');
        await expect(page.locator('div[role="dialog"]')).toBeVisible({ timeout: 5000 });

        const routineName = `Thursday MWF Test Routine ${Date.now()}`;

        // Fill in the name
        await page.locator('label:has-text("Name") + div input').fill(routineName);
        await page.waitForTimeout(300);

        // Set goal type to routine
        console.log('🔄 Setting goal type to routine...');
        await page.locator('label:has-text("Goal Type") + div').click();
        await page.waitForTimeout(200);
        await page.locator('li:has-text("Routine")').click();
        await page.waitForTimeout(500); // Wait for routine fields to appear

        // Step 5: Set frequency to weekly (this should auto-set to Thursday: "1W:4")
        console.log('📅 Setting frequency to weekly...');

        // The frequency dropdown should be visible now
        await expect(page.locator('text=Repeat every')).toBeVisible({ timeout: 5000 });

        // Find the unit dropdown - it should be the select element with options for day/week/month/year
        const unitDropdown = page.locator('select').filter({ hasText: 'day' });
        await expect(unitDropdown).toBeVisible({ timeout: 5000 });
        await unitDropdown.selectOption('W');
        await page.waitForTimeout(500);
        console.log('✅ Selected weekly frequency');

        // Step 6: The day selector should now be visible - select Monday, Wednesday, Friday
        console.log('📊 Selecting Monday, Wednesday, Friday...');
        await expect(page.locator('text=Repeat on')).toBeVisible({ timeout: 5000 });

        // The days are represented as circles with S, M, T, W, T, F, S
        // We need Monday (index 1), Wednesday (index 3), Friday (index 5)
        const dayCircles = page.locator('div:has-text("Repeat on") + div > div');

        // Clear any existing selections first (Thursday might be auto-selected)
        const allDays = await dayCircles.count();
        console.log(`Found ${allDays} day circles`);

        // Click Thursday (index 4) to deselect it if it's selected
        if (allDays >= 5) {
            await dayCircles.nth(4).click(); // Thursday
            await page.waitForTimeout(200);
        }

        // Select Monday (index 1), Wednesday (index 3), Friday (index 5)
        if (allDays >= 6) {
            await dayCircles.nth(1).click(); // Monday
            await page.waitForTimeout(200);
            await dayCircles.nth(3).click(); // Wednesday
            await page.waitForTimeout(200);
            await dayCircles.nth(5).click(); // Friday
            await page.waitForTimeout(200);
        }

        console.log('✅ Selected Monday, Wednesday, Friday');

        // Step 7: Set a start date (required for routines)
        console.log('📅 Setting start date...');
        const startDateInput = page.locator('label:has-text("Start Date") + div input');
        await startDateInput.fill(formatDateForCalendar(today));
        await page.waitForTimeout(300);

        // Step 8: Create the routine
        console.log('💾 Creating the routine...');
        await page.locator('button:has-text("Create"):not(:has-text("Another"))').click();

        // Wait for dialog to close and routine to be created
        await waitForDialogToClose(page);
        console.log('✅ Routine created successfully');

        // Step 9: Wait for events to be generated and calendar to update
        console.log('⏳ Waiting for events to be generated...');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(3000); // Give time for routine events to be created

        // Step 10: Verify that events appear only on Monday, Wednesday, Friday
        console.log('🔍 Verifying events appear only on Monday, Wednesday, Friday...');

        // Look for events with our routine name
        const routineEvents = page.locator('.fc-event', { hasText: routineName });

        // Wait for at least one event to appear
        await expect(routineEvents.first()).toBeVisible({ timeout: 10000 });

        // Get all routine events
        const eventCount = await routineEvents.count();
        console.log(`📊 Found ${eventCount} routine events`);

        // Verify each event is on Monday, Wednesday, or Friday
        for (let i = 0; i < eventCount; i++) {
            const event = routineEvents.nth(i);

            // Get the event's position/column to determine which day it's on
            const eventBox = await event.boundingBox();
            if (!eventBox) continue;

            // Get all day columns
            const dayColumns = page.locator('.fc-timegrid-col');
            const columnCount = await dayColumns.count();

            let eventDayIndex = -1;
            for (let col = 0; col < columnCount; col++) {
                const columnBox = await dayColumns.nth(col).boundingBox();
                if (columnBox && eventBox.x >= columnBox.x && eventBox.x < columnBox.x + columnBox.width) {
                    eventDayIndex = col;
                    break;
                }
            }

            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const eventDayName = dayNames[eventDayIndex] || 'Unknown';

            console.log(`📅 Event ${i + 1} is on: ${eventDayName} (column ${eventDayIndex})`);

            // Verify the event is on Monday (1), Wednesday (3), or Friday (5)
            expect([1, 3, 5]).toContain(eventDayIndex);

            // Critical check: Make sure NO events are on Thursday (4)
            expect(eventDayIndex).not.toBe(4);
        }

        // Step 11: Specifically check that NO events exist on Thursday
        console.log('🚫 Verifying NO events exist on Thursday...');

        // Get Thursday column
        const thursdayCol = page.locator('.fc-timegrid-col').nth(4);
        const thursdayEvents = thursdayCol.locator('.fc-event', { hasText: routineName });

        const thursdayEventCount = await thursdayEvents.count();
        console.log(`📊 Found ${thursdayEventCount} events on Thursday`);

        // This is the critical assertion - there should be NO events on Thursday
        expect(thursdayEventCount).toBe(0);

        console.log('✅ Test completed successfully! Events are only on Monday, Wednesday, Friday');
        console.log('✅ NO events found on Thursday (click day)');
    });
}); 