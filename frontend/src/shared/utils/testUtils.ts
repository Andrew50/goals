/**
 * Enhanced timezone mocking utilities for testing time conversion functions
 * 
 * IMPORTANT NOTES FOR CI ENVIRONMENT TESTING:
 * 
 * These utilities are designed to provide a consistent testing environment for 
 * timezone-related tests, which are notoriously difficult to make reliable across
 * different CI/CD environments and local development environments.
 * 
 * Key challenges with timezone testing:
 * 1. System timezone differences between environments
 * 2. Inconsistent handling of DST transitions
 * 3. JavaScript Date behavior quirks across environments
 * 4. Ambiguity during DST fall back transitions
 * 
 * Best practices for timezone tests:
 * 1. Test relative differences (time spans) rather than absolute values
 * 2. Use Date.UTC for creating timestamps rather than local Date constructors
 * 3. Mock the Date object and timezone as done in these utilities
 * 4. For DST-specific tests, use hardcoded timestamps rather than trying to simulate transitions
 * 5. Focus on testing round-trip conversions rather than specific time values
 */

/**
 * Creates a controlled test environment for timezone testing.
 * This mocks both Date constructor and getTimezoneOffset to ensure
 * consistent behavior across different environments.
 * 
 * @param fixedOffset Timezone offset in minutes to mock
 * @returns Function to restore original Date behavior
 * 
 * @example
 * // Mock EST timezone (UTC-5)
 * const restore = mockTimezone(300);
 * 
 * // Run tests with consistent timezone behavior
 * const timestamp = Date.UTC(2023, 0, 1, 12, 0, 0);
 * const localTime = toLocalTimestamp(timestamp);
 * 
 * // Clean up after test
 * restore();
 */
export const mockTimezone = (fixedOffset: number) => {
    // Store original implementations
    const OriginalDate = global.Date;
    const originalToString = OriginalDate.prototype.toString;
    const originalGetTime = OriginalDate.prototype.getTime;
    const originalGetTimezoneOffset = OriginalDate.prototype.getTimezoneOffset;

    // Fixed reference date to make tests deterministic
    const REFERENCE_DATE = new Date('2023-01-01T00:00:00Z').getTime();

    // Custom Date implementation
    class MockDate extends OriginalDate {
        constructor(value?: number | string | Date) {
            if (arguments.length === 0) {
                // new Date() - current time
                super(REFERENCE_DATE);
            } else {
                // Pass through other constructors
                super(value as any);
            }
        }

        getTimezoneOffset() {
            return fixedOffset;
        }
    }

    // Replace global Date
    global.Date = MockDate as DateConstructor;

    // Ensure toString preserves expected behavior
    MockDate.prototype.toString = originalToString;
    MockDate.prototype.getTime = originalGetTime;

    // Now and UTC functions
    MockDate.now = () => REFERENCE_DATE;
    MockDate.UTC = OriginalDate.UTC;

    // Return cleanup function
    return () => {
        global.Date = OriginalDate;
        // eslint-disable-next-line no-extend-native
        Date.prototype.getTimezoneOffset = originalGetTimezoneOffset;
    };
};

/**
 * Creates mock dates for testing DST transitions.
 * Provides reliable standard time and DST time with consistent offsets.
 * 
 * NOTE: This is mainly useful for testing "spring forward" DST transitions.
 * For "fall back" transitions (with ambiguous repeated hour), use direct
 * timestamp values and the simpler mockTimezone function.
 * 
 * @param standardOffset Timezone offset in minutes during standard time
 * @param dstOffset Timezone offset in minutes during DST
 * @param dstTransitionDate Date when DST starts (spring forward)
 * @param dstTransitionHour Hour when DST starts
 * @returns An object with date creation and restoration functions
 * 
 * @example
 * // Mock US Eastern Time DST transition (EST->EDT)
 * const { createStandardTimeDate, createDSTDate, restore } = mockDSTTransition(
 *   300, // EST offset = 300 minutes
 *   240, // EDT offset = 240 minutes
 *   new Date(2023, 2, 12), // March 12, 2023
 *   2 // Transition at 2:00 AM
 * );
 * 
 * // Create dates before and after transition
 * const beforeDST = createStandardTimeDate(2023, 2, 12, 1, 30);
 * const afterDST = createDSTDate(2023, 2, 12, 3, 30);
 * 
 * // Test time conversions
 * // ...
 * 
 * // Clean up
 * restore();
 */
export const mockDSTTransition = (
    standardOffset: number,
    dstOffset: number,
    dstTransitionDate: Date = new Date(2023, 2, 12), // Default: March 12, 2023
    dstTransitionHour: number = 2 // Default: 2 AM
) => {
    const OriginalDate = global.Date;
    const originalGetTimezoneOffset = OriginalDate.prototype.getTimezoneOffset;

    // Determine if a date is during DST
    const isDST = (date: Date) => {
        const month = date.getMonth();
        const day = date.getDate();
        const hours = date.getHours();

        const transitionMonth = dstTransitionDate.getMonth();
        const transitionDay = dstTransitionDate.getDate();

        if (month > transitionMonth) return true;
        if (month < transitionMonth) return false;
        if (day > transitionDay) return true;
        if (day < transitionDay) return false;
        return hours >= dstTransitionHour;
    };

    // Override getTimezoneOffset
    // eslint-disable-next-line no-extend-native
    Date.prototype.getTimezoneOffset = function () {
        return isDST(this) ? dstOffset : standardOffset;
    };

    // Track mock dates created
    const createdDates: Date[] = [];

    // Helper to create a date in standard time
    const createStandardTimeDate = (year: number, month: number, day: number, hour: number, minute: number = 0) => {
        // Create the date in standard time
        const date = new Date(year, month, day, hour, minute);
        createdDates.push(date);
        return date;
    };

    // Helper to create a date in DST
    const createDSTDate = (year: number, month: number, day: number, hour: number, minute: number = 0) => {
        // Create the date in DST
        const date = new Date(year, month, day, hour, minute);
        createdDates.push(date);
        return date;
    };

    // Return utility functions
    return {
        createStandardTimeDate,
        createDSTDate,
        restore: () => {
            // eslint-disable-next-line no-extend-native
            Date.prototype.getTimezoneOffset = originalGetTimezoneOffset;
        }
    };
}; 