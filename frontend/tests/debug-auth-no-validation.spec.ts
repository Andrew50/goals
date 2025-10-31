import { test, expect } from '@playwright/test';
import { generateTestToken } from './helpers/auth';

test.describe('Debug Authentication - Skip Validation', () => {
    test('test auth without network validation', async ({ page }) => {
        console.log('Testing auth bypass...');

        // Navigate to home first
        await page.goto('/');
        await page.waitForLoadState('domcontentloaded');

        // Generate test token
        const userId = 1;
        const username = 'testuser';
        const token = generateTestToken(userId, username);

        // Override the validation function to always return success
        await page.addInitScript(() => {
            // Override fetch to intercept auth validation requests
            const originalFetch = window.fetch;
            window.fetch = function (input, init) {
                const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input as any).url);

                // If it's an auth validation request, return success
                if (url.includes('auth/validate')) {
                    console.log('Intercepting auth validation request');
                    return Promise.resolve(new Response(JSON.stringify({ valid: true }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    }));
                }

                // For all other requests, use original fetch
                return originalFetch.call(this, input, init);
            };
        });

        // Set localStorage
        await page.evaluate(({ token, userId, username }) => {
            localStorage.setItem('authToken', token);
            localStorage.setItem('userId', String(userId));
            localStorage.setItem('username', username);
            console.log('Set localStorage items');
        }, { token, userId, username });

        // Wait a moment for any auth state updates
        await page.waitForTimeout(1000);

        // Check localStorage persistence
        const storedToken = await page.evaluate(() => localStorage.getItem('authToken'));
        console.log('Token still exists after 1s:', !!storedToken);

        // Navigate to calendar
        await page.goto('/calendar');
        await page.waitForTimeout(2000);

        const currentUrl = page.url();
        console.log('Final URL:', currentUrl);

        const hasCalendar = await page.locator('.calendar-container').count();
        console.log('Calendar found:', hasCalendar > 0);

        // Take screenshot
        await page.screenshot({ path: 'debug-no-validation.png', fullPage: true });

        expect(currentUrl).toBeDefined();
    });

    test('test with blocked network requests', async ({ page }) => {
        console.log('Testing with blocked network...');

        // Block all network requests to simulate backend being down
        await page.route('http://localhost:6060/**', route => {
            console.log('Blocked request to:', route.request().url());
            route.abort();
        });

        await page.goto('/');
        await page.waitForLoadState('domcontentloaded');

        const token = generateTestToken(1, 'testuser');

        await page.evaluate((token) => {
            localStorage.setItem('authToken', token);
            localStorage.setItem('userId', '1');
            localStorage.setItem('username', 'testuser');
        }, token);

        // Wait to see if token gets cleared
        await page.waitForTimeout(3000);

        const tokenAfterWait = await page.evaluate(() => localStorage.getItem('authToken'));
        console.log('Token persists with blocked network:', !!tokenAfterWait);

        // Try to navigate to calendar
        await page.goto('/calendar');
        await page.waitForTimeout(2000);

        const currentUrl = page.url();
        console.log('URL with blocked network:', currentUrl);

        expect(currentUrl).toBeDefined();
    });
}); 