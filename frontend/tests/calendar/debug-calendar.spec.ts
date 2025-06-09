import { test, expect } from '@playwright/test';

test.describe('Calendar Debug Tests', () => {
    test('debug calendar data loading', async ({ page }) => {
        // Listen for console messages from the start
        const logs: string[] = [];
        page.on('console', msg => {
            logs.push(`Console ${msg.type()}: ${msg.text()}`);
        });

        await page.goto('/');

        // Wait for the page to load
        await page.waitForLoadState('networkidle');

        // Check the current URL and route
        const currentUrl = page.url();
        console.log('Current URL:', currentUrl);

        // Check what's in the DOM
        const bodyContent = await page.locator('body').innerHTML();
        console.log('Page body content length:', bodyContent.length);

        // Check for common elements
        const hasRoot = await page.locator('#root').count();
        console.log('Root element found:', hasRoot > 0);

        // Check what's inside the root element
        if (hasRoot > 0) {
            const rootContent = await page.locator('#root').innerHTML();
            console.log('Root content length:', rootContent.length);
            console.log('Root content preview:', rootContent.substring(0, 500));
        }

        // Check for navigation/routing elements
        const hasNavigation = await page.locator('nav, .nav, .navigation').count();
        console.log('Navigation elements found:', hasNavigation);

        // Check for specific route indicators
        const hasCalendarRoute = await page.locator('[data-testid*="calendar"], .calendar, [class*="calendar"]').count();
        console.log('Calendar-related elements found:', hasCalendarRoute);

        // Check for other common page elements
        const hasHeader = await page.locator('header, .header').count();
        console.log('Header elements found:', hasHeader);

        const hasMain = await page.locator('main, .main, .content').count();
        console.log('Main content elements found:', hasMain);

        // Check for authentication-related elements
        const hasLoginForm = await page.locator('form, .login, .auth').count();
        console.log('Login/auth forms found:', hasLoginForm);

        // Check for any error messages or loading states
        const hasError = await page.locator('.error, .alert, [role="alert"]').count();
        console.log('Error messages found:', hasError);

        const hasLoading = await page.locator('.loading, .spinner').count();
        console.log('Loading indicators found:', hasLoading);

        // Check the page title
        const title = await page.title();
        console.log('Page title:', title);

        // Check localStorage to see if auth is working
        const authToken = await page.evaluate(() => localStorage.getItem('authToken'));
        const userId = await page.evaluate(() => localStorage.getItem('userId'));
        const username = await page.evaluate(() => localStorage.getItem('username'));
        console.log('Auth token exists:', !!authToken);
        console.log('User ID:', userId);
        console.log('Username:', username);

        // Try to navigate explicitly to calendar if we're not there
        if (!currentUrl.includes('/calendar')) {
            console.log('Not on calendar route, trying to navigate...');
            await page.goto('/calendar');
            await page.waitForLoadState('networkidle');
            await page.waitForTimeout(2000);

            const newUrl = page.url();
            console.log('New URL after navigation:', newUrl);

            const calendarAfterNav = await page.locator('.calendar-container').count();
            console.log('Calendar container after navigation:', calendarAfterNav > 0);
        }

        // Wait a bit more to see if anything loads
        await page.waitForTimeout(3000);

        // Take a screenshot to see what's on the page
        await page.screenshot({ path: 'debug-page-load.png', fullPage: true });

        // Log any console messages
        console.log('Console messages:');
        logs.forEach(log => console.log('  ' + log));

        // Check if we can find any React components
        const hasReactComponents = await page.evaluate(() => {
            return window.React !== undefined || document.querySelector('[data-reactroot]') !== null;
        });
        console.log('React components detected:', hasReactComponents);

        // The test should pass regardless - this is just for debugging
        expect(true).toBe(true);
    });
}); 