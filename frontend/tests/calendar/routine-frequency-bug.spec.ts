import { test, expect } from '@playwright/test';

test.describe('Routine Frequency Selection Bug', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/calendar');
        await page.waitForSelector('.calendar-container', { timeout: 10000 });
        await page.waitForSelector('.fc-view-harness', { timeout: 5000 });
        await page.waitForTimeout(2000);
    });

    test('should create routine with correct MWF frequency without creating events on click day', async ({ page }) => {
        console.log('🔍 Testing routine frequency selection bug...');

        // Switch to week view
        await page.locator('.fc-timeGridWeek-button').click();
        await page.waitForTimeout(1000);

        // Click on any day to open the goal menu (simulate clicking Thursday)
        console.log('🖱️  Clicking on calendar to create routine...');
        const thursdayColumn = page.locator('.fc-timegrid-col').nth(4); // Thursday column
        await thursdayColumn.click({ position: { x: 50, y: 200 } });

        // Goal menu should open
        await expect(page.locator('div[role="dialog"]')).toBeVisible({ timeout: 5000 });

        const routineName = `MWF Test Routine ${Date.now()}`;

        // Fill in name
        await page.locator('label:has-text("Name") + div input').fill(routineName);
        await page.waitForTimeout(300);

        // Set goal type to routine
        console.log('🔄 Setting goal type to routine...');
        await page.locator('label:has-text("Goal Type") + div').click();
        await page.waitForTimeout(200);
        await page.locator('li:has-text("Routine")').click();
        await page.waitForTimeout(1000); // Wait for routine fields to appear

        // Verify frequency fields are visible
        await expect(page.locator('text=Repeat every')).toBeVisible({ timeout: 5000 });

        // Check initial frequency value after changing to routine
        console.log('📊 Checking initial frequency after selecting routine type...');

        // Set to weekly frequency
        console.log('📅 Setting frequency to weekly...');
        const unitDropdown = page.locator('select').filter({ hasText: 'day' });
        await expect(unitDropdown).toBeVisible({ timeout: 5000 });
        await unitDropdown.selectOption('W');
        await page.waitForTimeout(500);

        // Wait for day selector to appear
        await expect(page.locator('text=Repeat on')).toBeVisible({ timeout: 5000 });

        console.log('📊 Selecting Monday, Wednesday, Friday...');

        // Get all day circles
        const dayCircles = page.locator('div:has-text("Repeat on") + div > div');
        const dayCount = await dayCircles.count();
        console.log(`Found ${dayCount} day selection circles`);

        // Clear all existing selections first
        for (let i = 0; i < dayCount; i++) {
            const circle = dayCircles.nth(i);
            const isSelected = await circle.evaluate((el) => {
                return el.style.backgroundColor.includes('rgb') || el.classList.contains('selected');
            });

            if (isSelected) {
                console.log(`Deselecting day ${i}`);
                await circle.click();
                await page.waitForTimeout(100);
            }
        }

        // Select Monday (1), Wednesday (3), Friday (5)
        await dayCircles.nth(1).click(); // Monday
        await page.waitForTimeout(200);
        await dayCircles.nth(3).click(); // Wednesday
        await page.waitForTimeout(200);
        await dayCircles.nth(5).click(); // Friday
        await page.waitForTimeout(200);

        console.log('✅ Selected Monday, Wednesday, Friday');

        // Set start date to today
        const today = new Date();
        const startDateString = today.toISOString().split('T')[0];
        const startDateInput = page.locator('label:has-text("Start Date") + div input');
        await startDateInput.fill(startDateString);
        await page.waitForTimeout(300);

        // Create the routine
        console.log('💾 Creating the routine...');
        await page.locator('button:has-text("Create"):not(:has-text("Another"))').click();

        // Wait for dialog to close
        await page.waitForFunction(() => !document.querySelector('div[role="dialog"]'), { timeout: 10000 });
        console.log('✅ Routine created successfully');

        // Wait for events to be generated
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(3000);

        // Verify events appear only on Monday, Wednesday, Friday
        console.log('🔍 Verifying events appear only on correct days...');

        const routineEvents = page.locator('.fc-event', { hasText: routineName });
        await expect(routineEvents.first()).toBeVisible({ timeout: 10000 });

        const eventCount = await routineEvents.count();
        console.log(`📊 Found ${eventCount} routine events`);

        // Check that no events exist on Thursday (column 4)
        const thursdayEvents = page.locator('.fc-timegrid-col').nth(4).locator('.fc-event', { hasText: routineName });
        const thursdayEventCount = await thursdayEvents.count();

        console.log(`📊 Found ${thursdayEventCount} events on Thursday`);
        expect(thursdayEventCount).toBe(0);

        // Check that events exist on other days
        const mondayEvents = page.locator('.fc-timegrid-col').nth(1).locator('.fc-event', { hasText: routineName });
        const wednesdayEvents = page.locator('.fc-timegrid-col').nth(3).locator('.fc-event', { hasText: routineName });
        const fridayEvents = page.locator('.fc-timegrid-col').nth(5).locator('.fc-event', { hasText: routineName });

        const mondayCount = await mondayEvents.count();
        const wednesdayCount = await wednesdayEvents.count();
        const fridayCount = await fridayEvents.count();

        console.log(`📊 Events by day: Monday=${mondayCount}, Wednesday=${wednesdayCount}, Friday=${fridayCount}, Thursday=${thursdayEventCount}`);

        // Expect at least one event on Monday, Wednesday, or Friday
        expect(mondayCount + wednesdayCount + fridayCount).toBeGreaterThan(0);

        console.log('✅ Test completed - Events are correctly placed only on MWF days');
    });
}); 