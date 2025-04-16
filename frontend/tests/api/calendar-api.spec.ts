import { test, expect } from '@playwright/test';
import { generateTestToken } from '../helpers/auth'; // Import from helper

// Base URL for your backend API
const API_URL = 'http://localhost:5057';

test.describe('Calendar API Tests', () => {
    test('GET /calendar should return calendar data', async ({ request }) => {
        // Create a valid test token for authentication using the helper
        // The helper defaults to username 'testuser{userId}' if not provided
        const testToken = generateTestToken(1); // Use userId 1

        // Make the request to the calendar endpoint
        const response = await request.get(`${API_URL}/calendar`, {
            headers: {
                'Authorization': `Bearer ${testToken}`
            }
        });

        // Check if the response is successful
        expect(response.ok()).toBeTruthy();

        // Parse the response body
        const body = await response.json();

        // Validate the structure of the response
        expect(body).toHaveProperty('unscheduled_tasks');
        expect(body).toHaveProperty('scheduled_tasks');
        expect(body).toHaveProperty('routines');
        expect(body).toHaveProperty('achievements');

        // Now that we fixed our seed data, validate content
        expect(body.scheduled_tasks).toHaveLength(1);
        expect(body.unscheduled_tasks).toHaveLength(1);
        expect(body.routines).toHaveLength(1);
        expect(body.achievements).toHaveLength(1);
    });
});
