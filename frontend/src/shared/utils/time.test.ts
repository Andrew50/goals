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
import { Goal } from '../../types/goals';

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
    });

    describe('goalToLocal and goalToUTC', () => {
        test('should convert all timestamp fields in a goal from UTC to local', () => {
            // Mock timezone offset to -300 minutes (-5 hours, like EST)
            const restoreOffset = mockTimezoneOffset(300);

            const utcGoal: Goal = {
                id: 1,
                name: 'Test Goal',
                goal_type: 'task',
                start_timestamp: 1672574400000, // 2023-01-01T12:00:00Z
                end_timestamp: 1672578000000,   // 2023-01-01T13:00:00Z
                next_timestamp: 1672581600000,  // 2023-01-01T14:00:00Z
                scheduled_timestamp: 1672585200000, // 2023-01-01T15:00:00Z
                routine_time: 1672588800000,    // 2023-01-01T16:00:00Z
                _tz: 'utc'
            };

            const expected: Goal = {
                ...utcGoal,
                start_timestamp: utcGoal.start_timestamp! - (300 * 60 * 1000),
                end_timestamp: utcGoal.end_timestamp! - (300 * 60 * 1000),
                next_timestamp: utcGoal.next_timestamp! - (300 * 60 * 1000),
                scheduled_timestamp: utcGoal.scheduled_timestamp! - (300 * 60 * 1000),
                routine_time: utcGoal.routine_time! - (300 * 60 * 1000),
                _tz: 'user'
            };

            expect(goalToLocal(utcGoal)).toEqual(expected);

            restoreOffset();
        });

        test('should convert all timestamp fields in a goal from local to UTC', () => {
            // Mock timezone offset to -300 minutes (-5 hours, like EST)
            const restoreOffset = mockTimezoneOffset(300);

            const localGoal: Goal = {
                id: 1,
                name: 'Test Goal',
                goal_type: 'task',
                start_timestamp: 1672556400000, // 2023-01-01T07:00:00 EST
                end_timestamp: 1672560000000,   // 2023-01-01T08:00:00 EST
                next_timestamp: 1672563600000,  // 2023-01-01T09:00:00 EST
                scheduled_timestamp: 1672567200000, // 2023-01-01T10:00:00 EST
                routine_time: 1672570800000,    // 2023-01-01T11:00:00 EST
                _tz: 'user'
            };

            const expected: Goal = {
                ...localGoal,
                start_timestamp: localGoal.start_timestamp! + (300 * 60 * 1000),
                end_timestamp: localGoal.end_timestamp! + (300 * 60 * 1000),
                next_timestamp: localGoal.next_timestamp! + (300 * 60 * 1000),
                scheduled_timestamp: localGoal.scheduled_timestamp! + (300 * 60 * 1000),
                routine_time: localGoal.routine_time! + (300 * 60 * 1000),
                _tz: 'utc'
            };

            expect(goalToUTC(localGoal)).toEqual(expected);

            restoreOffset();
        });

        test('should throw error if goal is already in the target timezone', () => {
            expect(() => goalToLocal({ _tz: 'user' } as Goal)).toThrow('Goal is already in user timezone');
            expect(() => goalToUTC({ _tz: 'utc' } as Goal)).toThrow('Goal is already in UTC timezone');
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
            const date = new Date();
            date.setFullYear(2023, 0, 15);
            date.setHours(0, 0, 0, 0);
            const expected = date.getTime();

            expect(inputStringToTimestamp(dateString, 'date')).toBe(expected);
        });

        test('should parse end-date string to timestamp at end of day', () => {
            const dateString = '2023-01-15';
            const date = new Date();
            date.setFullYear(2023, 0, 15);
            date.setHours(23, 59, 59, 999);
            const expected = date.getTime();

            expect(inputStringToTimestamp(dateString, 'end-date')).toBe(expected);
        });

        test('should parse time string to timestamp', () => {
            // This will set the time on the current date
            const timeString = '10:30';
            const date = new Date();
            date.setHours(10, 30, 0, 0);
            const expected = date.getTime();

            expect(inputStringToTimestamp(timeString, 'time')).toBe(expected);
        });

        test('should parse datetime string to timestamp', () => {
            const datetimeString = '2023-01-15T10:30';
            const date = new Date();
            date.setFullYear(2023, 0, 15);
            date.setHours(10, 30, 0, 0);
            const expected = date.getTime();

            expect(inputStringToTimestamp(datetimeString, 'datetime')).toBe(expected);
        });

        test('should handle empty string input', () => {
            expect(inputStringToTimestamp('', 'date')).toBe(0);
            expect(inputStringToTimestamp('', 'time')).toBe(0);
            expect(inputStringToTimestamp('', 'datetime')).toBe(0);
        });
    });

    describe('dateToTimestamp and timestampToDate', () => {
        test('should convert Date object to UTC timestamp', () => {
            // Create a date object for a specific time
            const date = new Date(2023, 0, 15, 10, 30, 0); // Local time

            // The UTC timestamp should be adjusted for timezone
            const expected = Date.UTC(2023, 0, 15, 10, 30, 0);

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