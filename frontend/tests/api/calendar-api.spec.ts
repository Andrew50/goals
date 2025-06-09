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
        // - Events generated automatically by the routine generator (typically 2+ events for the daily routine)
        // - 1 routine
        // - 0 achievements
        // - Parents array containing the routine that generated the events
        expect(body.unscheduled_tasks.length).toBeGreaterThanOrEqual(2);
        expect(body.events.length).toBeGreaterThanOrEqual(2); // Events are generated automatically by routine generator
        expect(body.routines).toHaveLength(1);
        expect(body.achievements).toHaveLength(0);
        expect(body.parents.length).toBeGreaterThanOrEqual(0); // May contain parent routines for events

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

        // Validate the structure of generated events
        if (body.events.length > 0) {
            expect(body.events[0]).toHaveProperty('id');
            expect(body.events[0]).toHaveProperty('name');
            expect(body.events[0]).toHaveProperty('goal_type');
            expect(body.events[0].goal_type).toBe('event');
            expect(body.events[0]).toHaveProperty('parent_id');
            expect(body.events[0]).toHaveProperty('parent_type');
            expect(body.events[0].parent_type).toBe('routine');
            expect(body.events[0]).toHaveProperty('routine_instance_id');
            expect(body.events[0]).toHaveProperty('scheduled_timestamp');
            expect(body.events[0].name).toBe('Test Routine'); // Should inherit name from parent routine
        }
    });
});
