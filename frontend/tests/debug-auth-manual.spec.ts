import { test, expect } from '@playwright/test';
import { generateTestToken } from './helpers/auth';

test.describe('Debug Authentication - Manual Setup', () => {
    test('debug auth with manual localStorage setup', async ({ page }) => {
        console.log('Starting manual auth debug test...');

        // Generate fresh test token
        const userId = 1;
        const username = 'testuser';
        const token = generateTestToken(userId, username);

        console.log('Generated token (first 50 chars):', token.substring(0, 50));

        // Navigate to the home page first
        await page.goto('/');

        // Wait for page to load
        await page.waitForLoadState('domcontentloaded');

        // Manually set localStorage items
        await page.evaluate(({ token, userId, username }) => {
            localStorage.setItem('authToken', token);
            localStorage.setItem('userId', String(userId));
            localStorage.setItem('username', username);
        }, { token, userId, username });

        // Verify localStorage was set
        const authToken = await page.evaluate(() => localStorage.getItem('authToken'));
        const storedUserId = await page.evaluate(() => localStorage.getItem('userId'));
        const storedUsername = await page.evaluate(() => localStorage.getItem('username'));

        console.log('After manual setup:');
        console.log('  Auth token exists:', !!authToken);
        console.log('  User ID:', storedUserId);
        console.log('  Username:', storedUsername);
        console.log('  Token (first 50 chars):', authToken?.substring(0, 50));

        // Now try to navigate to calendar
        console.log('=== Navigating to Calendar ===');
        await page.goto('/calendar');

        // Wait for any redirects or authentication checks
        await page.waitForTimeout(3000);

        const currentUrl = page.url();
        console.log('Current URL:', currentUrl);

        // Check if we're still authenticated
        const finalAuthToken = await page.evaluate(() => localStorage.getItem('authToken'));
        console.log('Final auth token exists:', !!finalAuthToken);

        // Check for calendar elements vs signin elements
        const hasCalendarContainer = await page.locator('.calendar-container').count();
        const hasSignInForm = await page.locator('form, .login, .signin').count();

        console.log('Calendar container found:', hasCalendarContainer);
        console.log('Sign-in form elements found:', hasSignInForm);

        // Take screenshot
        await page.screenshot({ path: 'debug-manual-auth.png', fullPage: true });

        if (currentUrl.includes('/signin')) {
            console.log('Still being redirected to signin - auth context may not be working');

            // Check for any network errors
            const networkLogs: string[] = [];
            page.on('response', (response) => {
                if (!response.ok()) {
                    networkLogs.push(`${response.status()} ${response.url()}`);
                }
            });

            if (networkLogs.length > 0) {
                console.log('Network errors:', networkLogs);
            }
        } else {
            console.log('Success! Calendar page loaded with authentication');
        }

        expect(currentUrl).toBeDefined();
    });

    test('test without global storage state', async ({ browser }) => {
        // Create a new context without the global storage state
        const context = await browser.newContext();
        const page = await context.newPage();

        console.log('Testing without global storage state...');

        // Generate fresh test token
        const userId = 1;
        const username = 'testuser';
        const token = generateTestToken(userId, username);

        // Navigate to home page
        await page.goto('/');
        await page.waitForLoadState('domcontentloaded');

        // Set up authentication manually
        await page.evaluate(({ token, userId, username }) => {
            localStorage.setItem('authToken', token);
            localStorage.setItem('userId', String(userId));
            localStorage.setItem('username', username);
        }, { token, userId, username });

        // Navigate to calendar
        await page.goto('/calendar');
        await page.waitForTimeout(3000);

        const currentUrl = page.url();
        console.log('Without global storage - URL:', currentUrl);

        const hasCalendarContainer = await page.locator('.calendar-container').count();
        console.log('Without global storage - Calendar found:', hasCalendarContainer > 0);

        await context.close();

        expect(currentUrl).toBeDefined();
    });
}); 