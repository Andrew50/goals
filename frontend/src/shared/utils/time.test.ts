import {
    toLocalTimestamp,
    toUTCTimestamp,
    goalToLocal,
    goalToUTC,
    timestampToInputString,
    inputStringToTimestamp,
    dateToTimestamp,
    timestampToDate,
    timestampToDisplayString
} from './time';
import { Goal, ApiGoal } from '../../types/goals'; // Import ApiGoal
import { mockTimezone } from './testUtils';

// Old helper to mock timezone offset - kept for backward compatibility
// eslint-disable-next-line no-extend-native
const mockTimezoneOffset = (offsetMinutes: number) => {
    const original = Date.prototype.getTimezoneOffset;
    // eslint-disable-next-line no-extend-native
    Date.prototype.getTimezoneOffset = jest.fn(() => offsetMinutes);
    return () => {
        Date.prototype.getTimezoneOffset = original;
    };
};

describe('Time conversion utilities', () => {
    beforeEach(() => {
        // Mock console.log to avoid cluttering test output
        //console.log = jest.fn();
    });

    afterEach(() => {
        // Restore console.log if needed
    });

    describe('toLocalTimestamp and toUTCTimestamp', () => {
        test('should convert UTC timestamp to local time', () => {
            // Mock timezone offset to -300 minutes (-5 hours, like EST)
            const restoreOffset = mockTimezoneOffset(300);

            // Test with a known UTC timestamp (2023-01-01T12:00:00Z)
            const utcTimestamp = 1672574400000;

            // Expected local timestamp would be 5 hours earlier
            const expectedLocalTimestamp = utcTimestamp - (300 * 60 * 1000);

            expect(toLocalTimestamp(utcTimestamp)).toBe(expectedLocalTimestamp);

            restoreOffset();
        });

        test('should convert local timestamp to UTC', () => {
            // Mock timezone offset to -300 minutes (-5 hours, like EST)
            const restoreOffset = mockTimezoneOffset(300);

            // Test with a known local timestamp (2023-01-01T07:00:00 EST)
            const localTimestamp = 1672574400000 - (300 * 60 * 1000);

            // Expected UTC timestamp would be 5 hours later
            const expectedUTCTimestamp = localTimestamp + (300 * 60 * 1000);

            expect(toUTCTimestamp(localTimestamp)).toBe(expectedUTCTimestamp);

            restoreOffset();
        });

        test('should handle null or undefined', () => {
            expect(toLocalTimestamp(null)).toBeUndefined();
            expect(toLocalTimestamp(undefined)).toBeUndefined();
            expect(toUTCTimestamp(null)).toBeUndefined();
            expect(toUTCTimestamp(undefined)).toBeUndefined();
        });

        test('should handle leap year dates correctly', () => {
            // Use the new robust mockTimezone with consistent offset of 5 hours
            const restoreMock = mockTimezone(300); // EST: UTC-5

            // February 29, 2020 (leap year) at noon UTC
            const leapYearUTC = Date.UTC(2020, 1, 29, 12, 0, 0, 0);

            // Convert to local time
            const leapYearLocal = toLocalTimestamp(leapYearUTC);

            // Verify local time is correct by checking the offset difference
            // UTC-to-local conversion subtracts the timezone offset in milliseconds
            const expectedOffset = 300 * 60 * 1000; // 5 hours in milliseconds
            // Compare timestamps using getTime()
            expect(leapYearUTC - leapYearLocal!.getTime()).toBe(expectedOffset);

            // Verify day and month are preserved
            // No need to wrap leapYearLocal in new Date() again, it's already a Date
            const localDate = leapYearLocal!;
            expect(localDate.getMonth()).toBe(1); // February (0-indexed)
            expect(localDate.getDate()).toBe(29);

            // Convert back to UTC and verify roundtrip conversion
            const backToUTC = toUTCTimestamp(leapYearLocal);
            expect(backToUTC).toBe(leapYearUTC);

            restoreMock();
        });

        test('should handle half-hour timezone offsets correctly', () => {
            // Use the new robust mockTimezone with offset of -330 minutes (UTC+5:30)
            const restoreMock = mockTimezone(-330); // IST: UTC+5:30

            // Noon UTC
            const noonUTC = Date.UTC(2023, 0, 15, 12, 0, 0, 0);

            // Convert to local time (IST)
            const localTimestamp = toLocalTimestamp(noonUTC);

            // Verify the conversion by checking the offset difference
            // UTC-to-local conversion subtracts the timezone offset
            const expectedOffset = -330 * 60 * 1000; // -5.5 hours in milliseconds
            // Compare timestamps using getTime()
            expect(noonUTC - localTimestamp!.getTime()).toBe(expectedOffset);

            // Verify minutes are preserved for half-hour offset
            // No need to wrap localTimestamp in new Date() again
            const localDate = localTimestamp!;
            expect(localDate.getMinutes()).toBe(30);

            // Convert back to UTC and verify roundtrip conversion
            const backToUTC = toUTCTimestamp(localTimestamp);
            expect(backToUTC).toBe(noonUTC);

            restoreMock();
        });

        test('should handle quarter-hour timezone offsets correctly', () => {
            // Use the new robust mockTimezone with offset of -345 minutes (UTC+5:45)
            const restoreMock = mockTimezone(-345); // Nepal Time: UTC+5:45

            // Noon UTC
            const noonUTC = Date.UTC(2023, 0, 15, 12, 0, 0, 0);

            // Convert to local time (Nepal)
            const localTimestamp = toLocalTimestamp(noonUTC);

            // Verify the conversion by checking the offset difference
            // UTC-to-local conversion subtracts the timezone offset
            const expectedOffset = -345 * 60 * 1000; // -5.75 hours in milliseconds
            // Compare timestamps using getTime()
            expect(noonUTC - localTimestamp!.getTime()).toBe(expectedOffset);

            // Verify minutes are preserved for quarter-hour offset
            // No need to wrap localTimestamp in new Date() again
            const localDate = localTimestamp!;
            expect(localDate.getMinutes()).toBe(45);

            // Convert back to UTC and verify roundtrip conversion
            const backToUTC = toUTCTimestamp(localTimestamp);
            expect(backToUTC).toBe(noonUTC);

            restoreMock();
        });
    });

    describe('goalToLocal and goalToUTC', () => {
        test('should convert all timestamp fields in a goal from UTC to local', () => {
            // Mock timezone offset to -300 minutes (-5 hours, like EST)
            const restoreOffset = mockTimezoneOffset(300);

            // This represents the data structure coming *from* the API (using numbers)
            // Cast to ApiGoal to satisfy the type checker for the test setup
            const apiGoal = {
                id: 1,
                name: 'Test Goal',
                goal_type: 'task', // goal_type should match GoalType enum if defined, using 'task' here
                start_timestamp: 1672574400000, // 2023-01-01T12:00:00Z
                end_timestamp: 1672578000000,   // 2023-01-01T13:00:00Z
                next_timestamp: 1672581600000,  // 2023-01-01T14:00:00Z
                scheduled_timestamp: 1672585200000, // 2023-01-01T15:00:00Z
                routine_time: 1672588800000,    // 2023-01-01T16:00:00Z
                _tz: 'utc' // Assuming API provides this, though goalToLocal doesn't use it
            } as ApiGoal; // Cast ensures the object matches the expected type for goalToLocal

            // This is the expected frontend Goal object (using Dates)
            const expected: Goal = {
                id: 1,
                name: 'Test Goal',
                goal_type: 'task',
                start_timestamp: new Date(1672574400000),
                end_timestamp: new Date(1672578000000),
                next_timestamp: new Date(1672581600000),
                scheduled_timestamp: new Date(1672585200000),
                routine_time: new Date(1672588800000),
                _tz: 'utc' // goalToLocal preserves other fields
            };

            // Pass the API-like object to goalToLocal
            expect(goalToLocal(apiGoal)).toEqual(expected);

            restoreOffset();
        });

        test('should convert all timestamp fields in a goal from local to UTC', () => {
            // Mock timezone offset to -300 minutes (-5 hours, like EST)
            const restoreOffset = mockTimezoneOffset(300);

            // This is the frontend Goal object (using Dates)
            const localGoal: Goal = {
                id: 1,
                name: 'Test Goal',
                goal_type: 'task',
                start_timestamp: new Date(1672556400000), // 2023-01-01T07:00:00 Local (assuming EST for test)
                end_timestamp: new Date(1672560000000),   // 2023-01-01T08:00:00 Local
                next_timestamp: new Date(1672563600000),  // 2023-01-01T09:00:00 Local
                scheduled_timestamp: new Date(1672567200000), // 2023-01-01T10:00:00 Local
                routine_time: new Date(1672570800000),    // 2023-01-01T11:00:00 Local
                _tz: 'user' // Assuming this field exists on the Goal type
            };

            // This is the expected API representation (using numbers)
            const expectedApiGoal = {
                id: 1,
                name: 'Test Goal',
                goal_type: 'task',
                start_timestamp: 1672556400000,
                end_timestamp: 1672560000000,
                next_timestamp: 1672563600000,
                scheduled_timestamp: 1672567200000,
                routine_time: 1672570800000,
                _tz: 'user' // goalToUTC preserves other fields
            };

            expect(goalToUTC(localGoal)).toEqual(expectedApiGoal);

            restoreOffset();
        });

        // Removed tests checking _tz field as goalToLocal/goalToUTC no longer manage it
        // test('should throw error if goal is already in the target timezone', () => {
        //     expect(() => goalToLocal({ _tz: 'user' } as Goal)).toThrow('Goal is already in user timezone');
        //     expect(() => goalToUTC({ _tz: 'utc' } as Goal)).toThrow('Goal is already in UTC timezone');
        // });

        test('should convert all timestamp fields including optional ones', () => {
            const restoreOffset = mockTimezoneOffset(300); // EST timezone

            // API representation (numbers)
            // Cast to ApiGoal to satisfy the type checker for the test setup
            const completeApiGoal = {
                id: 1,
                name: 'Complete Test Goal',
                goal_type: 'task', // goal_type should match GoalType enum if defined
                start_timestamp: 1672574400000, // 2023-01-01T12:00:00Z
                end_timestamp: 1672578000000,   // 2023-01-01T13:00:00Z
                next_timestamp: 1672581600000,  // 2023-01-01T14:00:00Z
                scheduled_timestamp: 1672585200000, // 2023-01-01T15:00:00Z
                routine_time: 1672588800000,    // 2023-01-01T16:00:00Z
                duration: 60,
                // _tz field might not be present in API representation
            } as ApiGoal; // Cast ensures the object matches the expected type for goalToLocal

            // Convert to local (frontend Goal with Dates)
            const localGoal = goalToLocal(completeApiGoal);

            // Verify all timestamp fields are converted to Date objects
            expect(localGoal.start_timestamp).toEqual(new Date(1672574400000));
            expect(localGoal.end_timestamp).toEqual(new Date(1672578000000));
            expect(localGoal.next_timestamp).toEqual(new Date(1672581600000));
            expect(localGoal.scheduled_timestamp).toEqual(new Date(1672585200000));
            expect(localGoal.routine_time).toEqual(new Date(1672588800000));
            expect(localGoal.duration).toBe(60); // Other fields preserved

            // Convert back to API representation (numbers)
            const backToApi = goalToUTC(localGoal);

            // Verify all timestamp fields are restored to original numeric values
            expect(backToApi.start_timestamp).toBe(completeApiGoal.start_timestamp);
            expect(backToApi.end_timestamp).toBe(completeApiGoal.end_timestamp);
            expect(backToApi.next_timestamp).toBe(completeApiGoal.next_timestamp);
            expect(backToApi.scheduled_timestamp).toBe(completeApiGoal.scheduled_timestamp);
            expect(backToApi.routine_time).toBe(completeApiGoal.routine_time);
            expect(backToApi.duration).toBe(60);

            restoreOffset();
        });

        test('should handle undefined timestamp fields gracefully', () => {
            const restoreOffset = mockTimezoneOffset(300); // EST timezone

            // API representation with missing fields
            // Cast to ApiGoal to satisfy the type checker for the test setup
            const partialApiGoal = {
                id: 1,
                name: 'Partial Test Goal',
                goal_type: 'task', // goal_type should match GoalType enum if defined
                start_timestamp: 1672574400000, // Only this timestamp is defined
                // _tz might not be present
            } as ApiGoal; // Cast ensures the object matches the expected type for goalToLocal

            // Convert to local (frontend Goal with Dates)
            const localGoal = goalToLocal(partialApiGoal);

            // Verify defined timestamp is converted and undefined ones remain undefined
            expect(localGoal.start_timestamp).toEqual(new Date(1672574400000));
            expect(localGoal.end_timestamp).toBeUndefined();
            expect(localGoal.next_timestamp).toBeUndefined();
            expect(localGoal.scheduled_timestamp).toBeUndefined();
            expect(localGoal.routine_time).toBeUndefined();
            expect(localGoal.name).toBe('Partial Test Goal'); // Other fields preserved

            // Convert back to API representation (numbers)
            const backToApi = goalToUTC(localGoal);

            // Verify only the defined timestamp is restored to original numeric value
            expect(backToApi.start_timestamp).toBe(partialApiGoal.start_timestamp);
            expect(backToApi.end_timestamp).toBeUndefined();
            expect(backToApi.next_timestamp).toBeUndefined();
            expect(backToApi.scheduled_timestamp).toBeUndefined();
            expect(backToApi.routine_time).toBeUndefined();
            expect(backToApi.name).toBe('Partial Test Goal');

            restoreOffset();
        });
    });

    describe('timestampToInputString and inputStringToTimestamp', () => {
        test('should format timestamp to date string', () => {
            // Use a fixed date to avoid timezone issues in tests
            const timestamp = new Date(2023, 0, 15, 10, 30).getTime(); // Jan 15, 2023, 10:30 AM

            expect(timestampToInputString(timestamp, 'date')).toBe('2023-01-15');
        });

        test('should format timestamp to time string', () => {
            const timestamp = new Date(2023, 0, 15, 10, 30).getTime(); // Jan 15, 2023, 10:30 AM

            expect(timestampToInputString(timestamp, 'time')).toBe('10:30');
        });

        test('should format timestamp to datetime string', () => {
            const timestamp = new Date(2023, 0, 15, 10, 30).getTime(); // Jan 15, 2023, 10:30 AM

            expect(timestampToInputString(timestamp, 'datetime')).toBe('2023-01-15T10:30');
        });

        test('should handle undefined or null timestamps', () => {
            expect(timestampToInputString(undefined, 'date')).toBe('');
            expect(timestampToInputString(null, 'time')).toBe('');
        });

        test('should parse date string to timestamp', () => {
            const dateString = '2023-01-15';
            const date = new Date(2023, 0, 15, 0, 0, 0, 0); // Jan 15, 2023, 00:00:00.000 Local
            const expected = date; // Expect a Date object

            expect(inputStringToTimestamp(dateString, 'date')).toEqual(expected);
        });

        test('should parse end-date string to timestamp at end of day', () => {
            const dateString = '2023-01-15';
            const date = new Date(2023, 0, 15, 23, 59, 59, 999); // Jan 15, 2023, 23:59:59.999 Local
            const expected = date; // Expect a Date object

            expect(inputStringToTimestamp(dateString, 'end-date')).toEqual(expected);
        });

        test('should parse time string to timestamp', () => {
            // This will set the time on the current date
            const timeString = '10:30';
            const date = new Date(); // Today's date
            date.setHours(10, 30, 0, 0); // Set time
            const expected = date; // Expect a Date object

            // Compare getTime() for robustness against object identity
            expect(inputStringToTimestamp(timeString, 'time').getTime()).toBe(expected.getTime());
        });

        test('should parse datetime string to timestamp', () => {
            const datetimeString = '2023-01-15T10:30';
            const date = new Date(2023, 0, 15, 10, 30, 0, 0); // Jan 15, 2023, 10:30:00.000 Local
            const expected = date; // Expect a Date object

            expect(inputStringToTimestamp(datetimeString, 'datetime')).toEqual(expected);
        });

        test('should handle empty string input', () => {
            const epochDate = new Date(0);
            expect(inputStringToTimestamp('', 'date')).toEqual(epochDate);
            expect(inputStringToTimestamp('', 'time')).toEqual(epochDate);
            expect(inputStringToTimestamp('', 'datetime')).toEqual(epochDate);
        });

        test('should handle midnight boundary cases', () => {
            // Test timestamps exactly at midnight
            const midnightTimestamp = new Date(2023, 0, 15, 0, 0, 0, 0).getTime(); // Midnight

            // Midnight should format to 00:00 for time and the correct date
            expect(timestampToInputString(midnightTimestamp, 'date')).toBe('2023-01-15');
            expect(timestampToInputString(midnightTimestamp, 'time')).toBe('00:00');
            expect(timestampToInputString(midnightTimestamp, 'datetime')).toBe('2023-01-15T00:00');

            // Parse back to timestamp (Date object)
            const parsedMidnightDate = inputStringToTimestamp('00:00', 'time');
            // const midnightDate = new Date(parsedMidnight); // No longer needed
            expect(parsedMidnightDate.getHours()).toBe(0);
            expect(parsedMidnightDate.getMinutes()).toBe(0);

            // Test just before midnight
            const beforeMidnightTimestamp = new Date(2023, 0, 15, 23, 59, 59, 999).getTime();
            expect(timestampToInputString(beforeMidnightTimestamp, 'time')).toBe('23:59');

            // Test just after midnight
            const afterMidnightTimestamp = new Date(2023, 0, 16, 0, 0, 0, 1).getTime();
            expect(timestampToInputString(afterMidnightTimestamp, 'date')).toBe('2023-01-16');
        });

        test('should handle invalid input strings gracefully', () => {
            const epochDate = new Date(0);
            // Test with malformed date strings - should return Epoch Date
            expect(inputStringToTimestamp('not-a-date', 'date')).toEqual(epochDate);
            // Invalid dates might parse to something unexpected or NaN, check against Epoch
            expect(inputStringToTimestamp('2023-13-32', 'date')).toEqual(epochDate); // Should now return Epoch for invalid date parts

            // Test with malformed time strings - should return Epoch Date
            // Note: setHours can handle wrapping, but invalid formats should fail
            expect(inputStringToTimestamp('25:70', 'time')).toEqual(epochDate); // Should now return Epoch for invalid time parts
            expect(inputStringToTimestamp('not-a-time', 'time')).toEqual(epochDate);

            // Test with malformed datetime strings - should return Epoch Date
            expect(inputStringToTimestamp('2023-01-15Tnot-a-time', 'datetime')).toEqual(epochDate);
            expect(inputStringToTimestamp('not-a-dateT12:30', 'datetime')).toEqual(epochDate);
        });
    });

    describe('dateToTimestamp and timestampToDate', () => {
        test('should convert Date object to UTC timestamp', () => {
            // Create a date object for a specific time
            const date = new Date(2023, 0, 15, 10, 30, 0); // Local time

            // dateToTimestamp should return the epoch milliseconds value of the Date object
            const expected = date.getTime();

            expect(dateToTimestamp(date)).toBe(expected);
        });

        test('should convert timestamp to Date object', () => {
            // Test with a known timestamp
            const timestamp = 1673778600000; // 2023-01-15T10:30:00.000Z
            const date = timestampToDate(timestamp);

            expect(date).toBeInstanceOf(Date);
            expect(date.getTime()).toBe(timestamp);
        });
    });

    describe('timestampToDisplayString', () => {
        test('should format timestamp for date display', () => {
            // Test with a known timestamp in UTC
            const timestamp = 1673778600000; // 2023-01-15T10:30:00.000Z
            const display = timestampToDisplayString(timestamp, 'date');

            // The exact format may depend on locale, so we just check some basic patterns
            expect(display).toContain('2023');
            expect(display).toMatch(/Jan|January/);
            expect(display).toContain('15');
        });

        test('should format timestamp for time display', () => {
            // Test with a known timestamp in UTC
            const timestamp = 1673778600000; // 2023-01-15T10:30:00.000Z
            const display = timestampToDisplayString(timestamp, 'time');

            // The exact format depends on locale, but should include hours and minutes
            expect(display).toMatch(/10:30|10:30 AM/i);
        });

        test('should format timestamp for datetime display', () => {
            // Test with a known timestamp in UTC
            const timestamp = 1673778600000; // 2023-01-15T10:30:00.000Z
            const display = timestampToDisplayString(timestamp);

            // Check for both date and time components
            expect(display).toContain('2023');
            expect(display).toMatch(/Jan|January/);
            expect(display).toContain('15');
            expect(display).toMatch(/10:30|10:30 AM/i);
        });

        test('should handle undefined or null timestamp', () => {
            expect(timestampToDisplayString(undefined)).toBe('');
            expect(timestampToDisplayString(null)).toBe('');
        });
    });
}); 
