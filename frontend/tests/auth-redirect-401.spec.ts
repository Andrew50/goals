import { test, expect } from '@playwright/test';

test.describe('401 redirect behavior', () => {
    test('navigates to /signin after a 401 response', async ({ page }) => {
        // Start on an authenticated route; storage state provides auth
        await page.goto('/calendar');

        // Force a 401 by clearing token and calling a protected endpoint
        await page.evaluate(() => {
            localStorage.removeItem('authToken');
        });

        // Trigger a fetch to a protected API (calendar), expect redirect
        await page.evaluate(async () => {
            try {
                await fetch(`${(window as any).REACT_APP_API_URL || ''}/calendar`, { credentials: 'include' });
            } catch {}
        });

        // Wait for navigation to the signin page caused by global 401 handler
        await page.waitForURL('**/signin');
        expect(page.url()).toContain('/signin');
    });
});




