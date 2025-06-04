import { Goal, ApiGoal } from '../../types/goals'; // Import ApiGoal
import {
    goalToLocal,
    goalToUTC,
    toLocalTimestamp,
    toUTCTimestamp
} from './time';

// Helper to mock timezone offset - disable eslint warning for Date prototype extension
// eslint-disable-next-line no-extend-native
const mockTimezoneOffset = (offsetMinutes: number) => {
    const original = Date.prototype.getTimezoneOffset;
    // eslint-disable-next-line no-extend-native
    Date.prototype.getTimezoneOffset = jest.fn(() => offsetMinutes);
    return () => {
        Date.prototype.getTimezoneOffset = original;
    };
};

// Mock API calls 
jest.mock('../utils/api', () => ({
    updateGoal: jest.fn((id, goalData) => Promise.resolve(goalData)),
    fetchGoal: jest.fn((id) => Promise.resolve({ id, _tz: 'utc' })),
    createGoal: jest.fn((goalData) => Promise.resolve({ ...goalData, id: 123 })),
    completeGoal: jest.fn((id, completed) => Promise.resolve(completed)),
}));

describe('Time conversion integration tests', () => {
    beforeEach(() => {
        // Mock //console.log to avoid cluttering test output
        //console.log = jest.fn();
    });

    test('Converting goal from backend (UTC) to frontend (local) and back', async () => {
        // Mock timezone offset to 480 minutes (8 hours, like PST)
        const restoreOffset = mockTimezoneOffset(480);

        // Simulate a goal coming from the backend (API representation with numbers)
        // Cast to ApiGoal to satisfy the type checker for the test setup
        const apiGoal = {
            id: 123,
            name: 'Test Backend Goal',
            goal_type: 'task', // goal_type should match GoalType enum if defined
            start_timestamp: 1672574400000, // 2023-01-01T12:00:00Z
            end_timestamp: 1672660800000,   // 2023-01-02T12:00:00Z
            scheduled_timestamp: 1672617600000, // 2023-01-02T00:00:00Z
            // _tz might not be present
        } as ApiGoal; // Cast ensures the object matches the expected type for goalToLocal

        // Convert to local time for frontend display (Goal with Dates)
        const frontendGoal = goalToLocal(apiGoal);

        // Verify timestamps were converted to Date objects
        expect(frontendGoal.start_timestamp).toEqual(new Date(1672574400000));
        expect(frontendGoal.end_timestamp).toEqual(new Date(1672660800000));
        expect(frontendGoal.scheduled_timestamp).toEqual(new Date(1672617600000));
        // expect(frontendGoal._tz).toBe('user'); // _tz is no longer managed by these functions

        // Simulate user making changes to the local goal
        const updatedFrontendGoal: Goal = {
            ...frontendGoal,
            name: 'Updated Goal Name',
            // Change a date
            end_timestamp: new Date(1672664400000) // 2023-01-02T13:00:00Z
        };

        // Convert back to API representation (numbers)
        const updatedApiGoal = goalToUTC(updatedFrontendGoal);

        // Verify timestamps were converted back to numbers
        expect(updatedApiGoal.start_timestamp).toBe(apiGoal.start_timestamp);
        expect(updatedApiGoal.end_timestamp).toBe(1672664400000); // Check updated value
        expect(updatedApiGoal.scheduled_timestamp).toBe(apiGoal.scheduled_timestamp);
        expect(updatedApiGoal.name).toBe('Updated Goal Name');
        // expect(updatedBackendGoal._tz).toBe('utc'); // _tz is no longer managed

        restoreOffset();
    });

    test('Timestamp roundtrip conversion preserves original value', () => {
        // This test verifies that converting a timestamp from UTC to local and back 
        // results in the original timestamp

        // Mock timezone offset to 60 minutes (1 hour, like many European timezones)
        const restoreOffset = mockTimezoneOffset(60);

        const originalTimestamp = 1672574400000; // 2023-01-01T12:00:00Z

        // Convert to local time
        const localTimestamp = toLocalTimestamp(originalTimestamp);

        // Convert back to UTC
        const roundtripTimestamp = toUTCTimestamp(localTimestamp);

        // Verify we get the original value back
        expect(roundtripTimestamp).toBe(originalTimestamp);

        restoreOffset();
    });

    test('Goal roundtrip through different timezones maintains data integrity', () => {
        // Create a goal in PST (frontend Goal with Dates)
        const restorePST = mockTimezoneOffset(480); // PST: UTC-8

        const originalGoal: Goal = {
            id: 1,
            name: 'Timezone Test Goal',
            goal_type: 'task',
            start_timestamp: new Date(2023, 0, 15, 9, 0), // 9 AM Local (PST for test)
            end_timestamp: new Date(2023, 0, 15, 17, 0),  // 5 PM Local (PST for test)
            scheduled_timestamp: new Date(2023, 0, 15, 10, 0), // 10 AM Local (PST for test)
            // _tz: 'user' // _tz might not be part of Goal type anymore
        };

        // Convert to API representation (numbers)
        const apiGoal = goalToUTC(originalGoal);
        restorePST(); // Restore timezone before next step

        // Expected numeric timestamps (UTC) based on PST (UTC-8) input
        // 9 AM PST = 17:00 UTC
        // 5 PM PST = 01:00 UTC next day (Jan 16)
        // 10 AM PST = 18:00 UTC
        const expectedStartUTC = Date.UTC(2023, 0, 15, 17, 0);
        const expectedEndUTC = Date.UTC(2023, 0, 16, 1, 0); // Note: Day changes
        const expectedScheduledUTC = Date.UTC(2023, 0, 15, 18, 0);

        expect(apiGoal.start_timestamp).toBe(expectedStartUTC);
        expect(apiGoal.end_timestamp).toBe(expectedEndUTC);
        expect(apiGoal.scheduled_timestamp).toBe(expectedScheduledUTC);


        // Now pretend we're in EST
        const restoreEST = mockTimezoneOffset(300); // EST: UTC-5

        // Convert the API goal (numbers) back to local (now EST Goal with Dates)
        const estGoal = goalToLocal(apiGoal);

        // Verify the Date objects represent the correct instant in time
        expect(estGoal.start_timestamp?.getTime()).toBe(expectedStartUTC);
        expect(estGoal.end_timestamp?.getTime()).toBe(expectedEndUTC);
        expect(estGoal.scheduled_timestamp?.getTime()).toBe(expectedScheduledUTC);

        // Verify the displayed times are correct for EST
        // 17:00 UTC = 12:00 PM EST (noon)
        expect(estGoal.start_timestamp?.getHours()).toBe(12);
        // 01:00 UTC Jan 16 = 8:00 PM EST Jan 15
        expect(estGoal.end_timestamp?.getHours()).toBe(20); // 8 PM
        expect(estGoal.end_timestamp?.getDate()).toBe(15); // Should be back to Jan 15 in EST
        // 18:00 UTC = 1:00 PM EST
        expect(estGoal.scheduled_timestamp?.getHours()).toBe(13); // 1 PM

        // Convert back to API representation again
        const backToApi = goalToUTC(estGoal);

        // Should match the original API representation (numeric UTC timestamps)
        expect(backToApi.start_timestamp).toBe(apiGoal.start_timestamp);
        expect(backToApi.end_timestamp).toBe(apiGoal.end_timestamp);
        expect(backToApi.scheduled_timestamp).toBe(apiGoal.scheduled_timestamp);

        restoreEST();
    });
}); 
