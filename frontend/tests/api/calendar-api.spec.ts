import { test, expect } from '@playwright/test';
import * as jwt from 'jsonwebtoken';

// Base URL for your backend API
const API_URL = 'http://localhost:5057';

// Generate a valid JWT token for testing
function generateTestToken() {
    // Use the same secret that's used in the backend (default_secret if not set)
    const secret = process.env.JWT_SECRET || 'default_secret';

    // Create a payload that matches the Claims struct in middleware.rs
    const payload = {
        user_id: 1,
        username: 'testuser',
        exp: Math.floor(Date.now() / 1000) + (60 * 60), // 1 hour expiration
    };

    // Sign the token
    return jwt.sign(payload, secret);
}

test.describe('Calendar API Tests', () => {
    test('GET /calendar should return calendar data', async ({ request }) => {
        // Create a valid test token for authentication
        const testToken = generateTestToken();

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
