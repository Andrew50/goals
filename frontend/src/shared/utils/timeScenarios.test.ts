import {
    toLocalTimestamp,
    toUTCTimestamp,
    timestampToInputString,
    inputStringToTimestamp
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

describe('Timezone scenario tests', () => {
    beforeEach(() => {
        //console.log = jest.fn();
    });

    afterEach(() => {
        // Restore console.log if needed
    });

    describe('Positive timezone offset (behind UTC)', () => {
        // Test with PST (-8 hours, +480 minutes offset)
        test('PST timezone conversions', () => {
            const restoreOffset = mockTimezoneOffset(480);

            // January 1, 2023 at 12:00 UTC
            const utcTimestamp = 1672574400000;

            // Should be January 1, 2023 at 04:00 PST
            const localTimestamp = toLocalTimestamp(utcTimestamp);

            // Convert back to UTC
            const backToUTC = toUTCTimestamp(localTimestamp);

            expect(localTimestamp).toBe(utcTimestamp - (480 * 60 * 1000));
            expect(backToUTC).toBe(utcTimestamp);

            restoreOffset();
        });
    });

    describe('Negative timezone offset (ahead of UTC)', () => {
        // Test with IST (+5:30 hours, -330 minutes offset)
        test('IST timezone conversions', () => {
            const restoreOffset = mockTimezoneOffset(-330);

            // January 1, 2023 at 12:00 UTC
            const utcTimestamp = 1672574400000;

            // Should be January 1, 2023 at 17:30 IST
            const localTimestamp = toLocalTimestamp(utcTimestamp);

            // Convert back to UTC
            const backToUTC = toUTCTimestamp(localTimestamp);

            expect(localTimestamp).toBe(utcTimestamp - (-330 * 60 * 1000));
            expect(backToUTC).toBe(utcTimestamp);

            restoreOffset();
        });
    });

    describe('Zero timezone offset (same as UTC)', () => {
        test('UTC timezone conversions', () => {
            const restoreOffset = mockTimezoneOffset(0);

            // January 1, 2023 at 12:00 UTC
            const utcTimestamp = 1672574400000;

            // Should be the same
            const localTimestamp = toLocalTimestamp(utcTimestamp);

            // Convert back to UTC
            const backToUTC = toUTCTimestamp(localTimestamp);

            expect(localTimestamp).toBe(utcTimestamp);
            expect(backToUTC).toBe(utcTimestamp);

            restoreOffset();
        });
    });

    describe('Date boundary scenarios', () => {
        test('Timestamps that cross date boundaries when converted', () => {
            // Mock timezone offset to 300 minutes (5 hours, like EST)
            const restoreOffset = mockTimezoneOffset(300);

            // December 31, 2022 at 22:00 UTC (would be Dec 31, 17:00 EST)
            const beforeMidnightUTC = new Date(Date.UTC(2022, 11, 31, 22, 0, 0)).getTime();

            // January 1, 2023 at 02:00 UTC (would be Dec 31, 21:00 EST - still previous day)
            const afterMidnightUTC = new Date(Date.UTC(2023, 0, 1, 2, 0, 0)).getTime();

            // Convert to local
            const beforeMidnightLocal = toLocalTimestamp(beforeMidnightUTC);
            const afterMidnightLocal = toLocalTimestamp(afterMidnightUTC);

            // Check that before midnight is still Dec 31 in local time
            const beforeLocalDate = new Date(beforeMidnightLocal!);
            expect(beforeLocalDate.getDate()).toBe(31);
            expect(beforeLocalDate.getMonth()).toBe(11); // 0-indexed, so 11 is December

            // Check that after midnight UTC is still Dec 31 in local time
            const afterLocalDate = new Date(afterMidnightLocal!);
            expect(afterLocalDate.getDate()).toBe(31);
            expect(afterLocalDate.getMonth()).toBe(11);

            restoreOffset();
        });
    });

    describe('DST transition scenarios', () => {
        // Mock a function that mimics timezone offset changes during DST
        // eslint-disable-next-line no-extend-native
        const mockDSTOffset = () => {
            const original = Date.prototype.getTimezoneOffset;

            // Mock getTimezoneOffset to return different values based on date
            // March 12, 2023 was DST start in the US
            // eslint-disable-next-line no-extend-native
            Date.prototype.getTimezoneOffset = function () {
                if (this.getMonth() === 2 && this.getDate() >= 12) { // After March 12
                    return 240; // EDT (-4 hours)
                } else {
                    return 300; // EST (-5 hours)
                }
            };

            return () => {
                Date.prototype.getTimezoneOffset = original;
            };
        };

        test('Converting timestamps around DST transition', () => {
            const restoreDST = mockDSTOffset();

            // March 11, 2023 at 18:00 EST (23:00 UTC)
            const beforeDSTTimestamp = new Date(2023, 2, 11, 18, 0).getTime();

            // March 12, 2023 at 18:00 EDT (22:00 UTC)
            const afterDSTTimestamp = new Date(2023, 2, 12, 18, 0).getTime();

            // Convert to UTC
            const beforeDSTUTC = toUTCTimestamp(beforeDSTTimestamp);
            const afterDSTUTC = toUTCTimestamp(afterDSTTimestamp);

            // Convert back to local
            const beforeDSTLocal = toLocalTimestamp(beforeDSTUTC);
            const afterDSTLocal = toLocalTimestamp(afterDSTUTC);

            // Should preserve original timestamps
            expect(beforeDSTLocal).toBe(beforeDSTTimestamp);
            expect(afterDSTLocal).toBe(afterDSTTimestamp);

            restoreDST();
        });
    });

    describe('Input and display formatting across timezones', () => {
        test('Formatting and parsing timestamps consistently across timezones', () => {
            // Test in PST timezone
            const restorePST = mockTimezoneOffset(480);

            // Create a timestamp for noon PST
            const pstNoon = new Date(2023, 0, 15, 12, 0).getTime();

            // Format for input
            const pstDateString = timestampToInputString(pstNoon, 'date');
            const pstTimeString = timestampToInputString(pstNoon, 'time');
            const pstDatetimeString = timestampToInputString(pstNoon, 'datetime');

            // Should format based on local time
            expect(pstDateString).toBe('2023-01-15');
            expect(pstTimeString).toBe('12:00');
            expect(pstDatetimeString).toBe('2023-01-15T12:00');

            // Parse back to timestamp
            const parsedDate = inputStringToTimestamp(pstDateString, 'date');
            const parsedTime = inputStringToTimestamp(pstTimeString, 'time');
            const parsedDatetime = inputStringToTimestamp(pstDatetimeString, 'datetime');

            // Create expected timestamps (time will use today's date)
            const today = new Date();
            today.setHours(12, 0, 0, 0);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const expectedTime = today.getTime();

            // Create a date with the expected day but midnight
            const expectedDate = new Date(2023, 0, 15);
            expectedDate.setHours(0, 0, 0, 0);

            // Create the expected datetime
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const expectedDatetime = new Date(2023, 0, 15, 12, 0, 0, 0).getTime();

            // Verify parsed values (ignoring time for date-only)
            expect(new Date(parsedDate).toDateString()).toBe(expectedDate.toDateString());
            expect(new Date(parsedTime).getHours()).toBe(12);
            expect(new Date(parsedTime).getMinutes()).toBe(0);
            expect(parsedDatetime).toBe(expectedDatetime);

            restorePST();

            // Now test in a different timezone (EST)
            const restoreEST = mockTimezoneOffset(300);

            // The same PST noon timestamp, when viewed in EST
            // would be 3 PM EST (since EST is 3 hours ahead of PST)
            // We don't actually use this, so mark as unused
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const estEquivalent = new Date(pstNoon);

            // Format using the same timestamp but in EST timezone context
            const estDateString = timestampToInputString(pstNoon, 'date');
            const estTimeString = timestampToInputString(pstNoon, 'time');
            const estDatetimeString = timestampToInputString(pstNoon, 'datetime');

            // Still the same date in both timezones
            expect(estDateString).toBe('2023-01-15');
            // But the time appears shifted
            expect(estTimeString).toBe('12:00'); // Still shows 12:00 because times displayed are in local time
            expect(estDatetimeString).toBe('2023-01-15T12:00');

            restoreEST();
        });
    });

    describe('User timezone preference scenarios', () => {
        test('Handles user timezone preference correctly', () => {
            // Mock timezone offset to PST (-8 hours, 480 minutes)
            const restorePST = mockTimezoneOffset(480);

            // Test timestamps with PST
            const utcDateTime = 1630425600000; // 2021-09-01T00:00:00Z
            const localDateTime = toLocalTimestamp(utcDateTime);

            // Should be 2021-08-31T16:00:00 PST
            const pstDate = new Date(localDateTime!);
            expect(pstDate.getDate()).toBe(31);
            expect(pstDate.getMonth()).toBe(7); // August (0-indexed)
            expect(pstDate.getHours()).toBe(16);

            restorePST();

            // Change to IST (+5:30, -330 minutes)
            const restoreIST = mockTimezoneOffset(-330);

            // Same UTC time
            const localDateTimeIST = toLocalTimestamp(utcDateTime);

            // Should be 2021-09-01T05:30:00 IST
            const istDate = new Date(localDateTimeIST!);
            expect(istDate.getDate()).toBe(1);
            expect(istDate.getMonth()).toBe(8); // September (0-indexed)
            expect(istDate.getHours()).toBe(5);
            expect(istDate.getMinutes()).toBe(30);

            restoreIST();

            // No need for estEquivalent variable here
        });
    });
}); 