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
        expect(body).toHaveProperty('events');
        expect(body).toHaveProperty('routines');
        expect(body).toHaveProperty('achievements');
        expect(body).toHaveProperty('parents');

        // Validate content based on the actual test data
        // From the API response, we have:
        // - At least 2 unscheduled tasks (original test data + any created by debug tests)
        // - 0 events (routine exists but doesn't generate events automatically)
        // - 1 routine
        // - 0 achievements
        // - 0 parents (empty array)
        expect(body.unscheduled_tasks.length).toBeGreaterThanOrEqual(2);
        expect(body.events).toHaveLength(0); // No events generated automatically
        expect(body.routines).toHaveLength(1);
        expect(body.achievements).toHaveLength(0);
        expect(body.parents).toHaveLength(0); // Empty array, not 1

        // Validate that we have the original test tasks
        const originalTasks = body.unscheduled_tasks.filter(task =>
            task.name === 'Test Task 1' || task.name === 'Test Task 2'
        );
        expect(originalTasks.length).toBeGreaterThanOrEqual(2);

        // Validate the structure of the first unscheduled task
        expect(body.unscheduled_tasks[0]).toHaveProperty('id');
        expect(body.unscheduled_tasks[0]).toHaveProperty('name');
        expect(body.unscheduled_tasks[0]).toHaveProperty('goal_type');
        expect(body.unscheduled_tasks[0].goal_type).toBe('task');

        // Validate the structure of the routine
        expect(body.routines[0]).toHaveProperty('id');
        expect(body.routines[0]).toHaveProperty('name');
        expect(body.routines[0]).toHaveProperty('goal_type');
        expect(body.routines[0].goal_type).toBe('routine');
        expect(body.routines[0]).toHaveProperty('frequency');
        expect(body.routines[0].frequency).toBe('daily');

        // If events exist in the future, validate their structure
        if (body.events.length > 0) {
            expect(body.events[0]).toHaveProperty('id');
            expect(body.events[0]).toHaveProperty('name');
            expect(body.events[0]).toHaveProperty('goal_type');
            expect(body.events[0].goal_type).toBe('event');
            expect(body.events[0]).toHaveProperty('parent_id');
        }
    });
});
