import { Goal } from '../../types/goals';
import {
    goalToLocal,
    goalToUTC,
    toLocalTimestamp,
    toUTCTimestamp
} from './time';

// Helper to mock timezone offset
const mockTimezoneOffset = (offsetMinutes: number) => {
    const original = Date.prototype.getTimezoneOffset;
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

        // Simulate a goal coming from the backend (in UTC)
        const backendGoal: Goal = {
            id: 123,
            name: 'Test Backend Goal',
            goal_type: 'task',
            start_timestamp: 1672574400000, // 2023-01-01T12:00:00Z
            end_timestamp: 1672660800000,   // 2023-01-02T12:00:00Z
            scheduled_timestamp: 1672617600000, // 2023-01-02T00:00:00Z
            _tz: 'utc'
        };

        // Convert to local time for frontend display
        const frontendGoal = goalToLocal(backendGoal);

        // Verify timestamps were adjusted by 8 hours (480 minutes)
        expect(frontendGoal.start_timestamp).toBe(backendGoal.start_timestamp! - (480 * 60 * 1000));
        expect(frontendGoal.end_timestamp).toBe(backendGoal.end_timestamp! - (480 * 60 * 1000));
        expect(frontendGoal.scheduled_timestamp).toBe(backendGoal.scheduled_timestamp! - (480 * 60 * 1000));
        expect(frontendGoal._tz).toBe('user');

        // Simulate user making changes to the local goal
        const updatedFrontendGoal: Goal = {
            ...frontendGoal,
            name: 'Updated Goal Name',
            // No changes to timestamps
        };

        // Convert back to UTC for sending to backend
        const updatedBackendGoal = goalToUTC(updatedFrontendGoal);

        // Verify timestamps were adjusted back to UTC
        expect(updatedBackendGoal.start_timestamp).toBe(backendGoal.start_timestamp);
        expect(updatedBackendGoal.end_timestamp).toBe(backendGoal.end_timestamp);
        expect(updatedBackendGoal.scheduled_timestamp).toBe(backendGoal.scheduled_timestamp);
        expect(updatedBackendGoal._tz).toBe('utc');

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
        // Create a goal in PST
        const restorePST = mockTimezoneOffset(480); // PST: UTC-8

        const originalGoal: Goal = {
            id: 1,
            name: 'Timezone Test Goal',
            goal_type: 'task',
            start_timestamp: new Date(2023, 0, 15, 9, 0).getTime(), // 9 AM PST
            end_timestamp: new Date(2023, 0, 15, 17, 0).getTime(),  // 5 PM PST
            scheduled_timestamp: new Date(2023, 0, 15, 10, 0).getTime(), // 10 AM PST
            _tz: 'user' // Local timezone (PST)
        };

        // Convert to UTC for storage
        const utcGoal = goalToUTC(originalGoal);
        restorePST();

        // Now pretend we're in EST
        const restoreEST = mockTimezoneOffset(300); // EST: UTC-5

        // Convert the UTC goal back to local (now EST)
        const estGoal = goalToLocal(utcGoal);

        // Verify the displayed times are correct for EST
        // 9 AM PST = 12 PM EST
        const estDate = new Date(estGoal.start_timestamp!);
        expect(estDate.getHours()).toBe(12);

        // Convert back to UTC again
        const backToUTC = goalToUTC(estGoal);

        // Should match the original UTC goal
        expect(backToUTC.start_timestamp).toBe(utcGoal.start_timestamp);
        expect(backToUTC.end_timestamp).toBe(utcGoal.end_timestamp);
        expect(backToUTC.scheduled_timestamp).toBe(utcGoal.scheduled_timestamp);

        restoreEST();
    });
}); 