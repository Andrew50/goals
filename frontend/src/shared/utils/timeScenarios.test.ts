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

        test('Handling timestamps exactly during DST transition hour', () => {
            const restoreDST = mockDSTOffset();

            // Spring forward transition in the US: March 12, 2023, 2:00 AM -> 3:00 AM
            // Times in the non-existent hour should be handled gracefully

            // 1:59 AM EST on March 12, 2023 - right before DST
            const justBeforeDST = new Date(2023, 2, 12, 1, 59, 0).getTime();

            // 3:01 AM EDT on March 12, 2023 - right after DST
            const justAfterDST = new Date(2023, 2, 12, 3, 1, 0).getTime();

            // Convert to UTC - should account for correct timezone offsets
            const justBeforeDST_UTC = toUTCTimestamp(justBeforeDST);
            const justAfterDST_UTC = toUTCTimestamp(justAfterDST);

            // 1:59 AM EST is UTC-5, so add 5 hours
            expect(new Date(justBeforeDST_UTC!).getUTCHours()).toBe(6); // 1:59 AM EST + 5h = 6:59 AM UTC

            // 3:01 AM EDT is UTC-4, so add 4 hours
            expect(new Date(justAfterDST_UTC!).getUTCHours()).toBe(7); // 3:01 AM EDT + 4h = 7:01 AM UTC

            // Convert back to local
            const backToLocalBefore = toLocalTimestamp(justBeforeDST_UTC);
            const backToLocalAfter = toLocalTimestamp(justAfterDST_UTC);

            // Should get original timestamps back
            expect(backToLocalBefore).toBe(justBeforeDST);
            expect(backToLocalAfter).toBe(justAfterDST);

            restoreDST();
        });

        test('Handling event that spans across DST transition', () => {
            const restoreDST = mockDSTOffset();

            // Create an event that starts before DST and ends after DST
            // Spring forward: March 12, 2023, 2:00 AM -> 3:00 AM

            // Event starts at 1:30 AM EST and is scheduled for 2 hours
            // This should end at 4:30 AM EDT (not 3:30 AM, because an hour is lost during DST)
            const eventStartLocal = new Date(2023, 2, 12, 1, 30, 0).getTime();

            // Convert start time to UTC
            const eventStartUTC = toUTCTimestamp(eventStartLocal);

            // Calculate what the end time should be in local time: 2 hours later in clock time
            const expectedEndLocal = new Date(2023, 2, 12, 4, 30, 0).getTime();

            // Convert expected end to UTC
            const expectedEndUTC = toUTCTimestamp(expectedEndLocal);

            // The difference between the UTC times should be 3 hours (120 + 60 minutes)
            // because the missing hour during DST transition is still real time
            expect(expectedEndUTC! - eventStartUTC!).toBe(3 * 60 * 60 * 1000);

            // Convert the UTC times back to local and verify
            const backToLocalStart = toLocalTimestamp(eventStartUTC);
            const backToLocalEnd = toLocalTimestamp(expectedEndUTC);

            // Local times should match original
            expect(backToLocalStart).toBe(eventStartLocal);
            expect(backToLocalEnd).toBe(expectedEndLocal);

            // Local time difference should be 3 hours in clock time (1:30 AM -> 4:30 AM)
            expect(backToLocalEnd! - backToLocalStart!).toBe(3 * 60 * 60 * 1000);

            restoreDST();
        });

        test('Handling fall back DST transition (duplicate hour)', () => {
            // Mock a function for the fall DST change
            const mockFallDSTOffset = () => {
                const original = Date.prototype.getTimezoneOffset;

                // Mock for fall back DST transition: Nov 5, 2023 in the US (2:00 AM -> 1:00 AM)
                // eslint-disable-next-line no-extend-native
                Date.prototype.getTimezoneOffset = function () {
                    if (this.getMonth() === 10 && this.getDate() >= 5) { // After Nov 5
                        return 300; // Back to EST (-5 hours)
                    } else {
                        return 240; // Still on EDT (-4 hours)
                    }
                };

                return () => {
                    Date.prototype.getTimezoneOffset = original;
                };
            };

            const restoreFallDST = mockFallDSTOffset();

            // 1:30 AM EDT on Nov 5, 2023 - before DST fall back
            const firstPass = new Date(2023, 10, 5, 1, 30, 0).getTime();

            // 1:30 AM EST on Nov 5, 2023 - after DST fall back (same local time, different UTC)
            // To simulate this, we'll create a timestamp 1 hour later, but it has the same clock time
            const secondPass = firstPass + (60 * 60 * 1000);

            // Convert to UTC
            const firstPassUTC = toUTCTimestamp(firstPass);
            const secondPassUTC = toUTCTimestamp(secondPass);

            // The UTC times should be 2 hours apart (1 hour from real time + 1 hour from timezone change)
            expect(secondPassUTC! - firstPassUTC!).toBe(2 * 60 * 60 * 1000);

            // First pass is EDT (UTC-4)
            expect(new Date(firstPassUTC!).getUTCHours()).toBe(5); // 1:30 AM EDT + 4h = 5:30 AM UTC

            // Second pass is EST (UTC-5)
            expect(new Date(secondPassUTC!).getUTCHours()).toBe(6); // 1:30 AM EST + 5h = 6:30 AM UTC (1h later)

            // Convert back to local
            const backToLocalFirst = toLocalTimestamp(firstPassUTC);
            const backToLocalSecond = toLocalTimestamp(secondPassUTC);

            // Should get original timestamps back
            expect(backToLocalFirst).toBe(firstPass);
            expect(backToLocalSecond).toBe(secondPass);

            restoreFallDST();
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