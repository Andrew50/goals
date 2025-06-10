import { test, expect } from '@playwright/test';

test.describe('Debug Authentication', () => {
    test('debug auth state and page content', async ({ page }) => {
        console.log('Starting auth debug test...');

        // Check storage state before navigation
        console.log('=== Storage State Check ===');

        // First, let's navigate to the home page to see if localStorage is being set
        await page.goto('/');

        // Wait for the page to load completely
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1000);

        // Check localStorage right after page load
        const authTokenInitial = await page.evaluate(() => localStorage.getItem('authToken'));
        const userIdInitial = await page.evaluate(() => localStorage.getItem('userId'));
        const usernameInitial = await page.evaluate(() => localStorage.getItem('username'));

        console.log('After home page load:');
        console.log('  Auth token exists:', !!authTokenInitial);
        console.log('  User ID:', userIdInitial);
        console.log('  Username:', usernameInitial);

        if (authTokenInitial) {
            console.log('  Token (first 50 chars):', authTokenInitial.substring(0, 50));
        }

        // Now navigate to calendar
        console.log('=== Navigating to Calendar ===');
        await page.goto('/calendar');

        // Wait a bit for any redirects to complete
        await page.waitForTimeout(2000);

        // Check current URL
        const currentUrl = page.url();
        console.log('Current URL:', currentUrl);

        // Check localStorage again
        const authToken = await page.evaluate(() => localStorage.getItem('authToken'));
        const userId = await page.evaluate(() => localStorage.getItem('userId'));
        const username = await page.evaluate(() => localStorage.getItem('username'));

        console.log('After calendar navigation:');
        console.log('  Auth token exists:', !!authToken);
        console.log('  User ID:', userId);
        console.log('  Username:', username);

        if (authToken) {
            console.log('  Token (first 50 chars):', authToken.substring(0, 50));
        }

        // Check all localStorage items
        const allLocalStorage = await page.evaluate(() => {
            const items = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key) {
                    items[key] = localStorage.getItem(key);
                }
            }
            return items;
        });
        console.log('All localStorage items:', allLocalStorage);

        // Check for auth-related elements
        const hasSignInForm = await page.locator('form, .login, .signin').count();
        const hasCalendarContainer = await page.locator('.calendar-container').count();
        const hasAuthButton = await page.locator('button:has-text("Sign In")').count();

        console.log('Sign-in form elements found:', hasSignInForm);
        console.log('Calendar container found:', hasCalendarContainer);
        console.log('Sign In button found:', hasAuthButton);

        // Get page title
        const title = await page.title();
        console.log('Page title:', title);

        // Check for any error messages
        const errorElements = await page.locator('.error, .alert, [role="alert"]').allTextContents();
        if (errorElements.length > 0) {
            console.log('Error messages found:', errorElements);
        }

        // Check if React is loaded
        const reactLoaded = await page.evaluate(() => typeof window.React !== 'undefined' || typeof (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined');
        console.log('React loaded:', reactLoaded);

        // Take a screenshot
        await page.screenshot({ path: 'debug-auth-state.png', fullPage: true });

        // Check if we're on signin page
        if (currentUrl.includes('/signin')) {
            console.log('Test is being redirected to signin page');

            // Try to check why authentication is failing
            // Let's see if there's any specific error
            const pageContent = await page.textContent('body');
            console.log('Page content preview:', pageContent?.substring(0, 500));
        }

        // Just make sure we understand what's happening
        expect(currentUrl).toBeDefined();
        expect(title).toBeDefined();
    });
}); 