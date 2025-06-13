import { defineConfig, devices } from '@playwright/test';

import path from 'path'; // Import path module
import dotenv from 'dotenv'; // Import dotenv

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// Load environment variables from the root .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
    testDir: './tests',
    /* Run tests in files in parallel */
    fullyParallel: true,
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    forbidOnly: !!process.env.CI,
    /* Retry on CI only */
    retries: process.env.CI ? 2 : 0,
    /* Enable multiple workers with proper isolation */
    workers: process.env.CI ? 4 : undefined, // Change from 1 to 4 workers
    /* Reporter to use. See https://playwright.dev/docs/test-reporters */
    reporter: 'html',
    /* Path to the global setup file. */
    globalSetup: require.resolve('./tests/global-setup'),

    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        /* Base URL will be dynamically set per worker */
        baseURL: process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${3031 + (parseInt(process.env.TEST_WORKER_INDEX || '0'))}`,
        /* Use the saved storage state for authentication. */
        storageState: 'tests/.auth/storageState.json',
        /* Default locale */
        locale: 'en-US',
        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: 'on-first-retry',
        /* Add video recording for failed tests */
        video: 'retain-on-failure',
        /* Add screenshot on failure */
        screenshot: 'only-on-failure',
        /* Increase timeout for CI environment */
        actionTimeout: process.env.CI ? 30000 : 30000,
        navigationTimeout: process.env.CI ? 60000 : 30000,
    },

    /* Configure projects for major browsers */
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'chromium-new-york',
            use: {
                ...devices['Desktop Chrome'],
                timezoneId: 'America/New_York',
            },
        },
        {
            name: 'chromium-london',
            use: {
                ...devices['Desktop Chrome'],
                timezoneId: 'Europe/London',
            },
        },
        {
            name: 'chromium-tokyo',
            use: {
                ...devices['Desktop Chrome'],
                timezoneId: 'Asia/Tokyo',
            },
        },

        // We're only using Chrome for CI to keep things faster
        // Firefox and WebKit tests are commented out
        /*
        {
          name: 'firefox',
          use: { ...devices['Desktop Firefox'] },
        },
    
        {
          name: 'webkit',
          use: { ...devices['Desktop Safari'] },
        },
        */
    ],

    /* Run the frontend server in CI - disabled in favor of external setup */
    // webServer: {
    //     command: 'npm run start',
    //     url: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3031',
    //     reuseExistingServer: true,
    //     timeout: 120 * 1000, // 2 minutes
    //     env: {
    //         REACT_APP_API_URL: process.env.REACT_APP_API_URL || 'http://localhost:5057',
    //     },
    // },
});
