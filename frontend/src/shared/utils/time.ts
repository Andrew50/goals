import { Goal } from "../../types/goals";

/**
 * Converts a UTC timestamp to the user's local timezone.
 * 
 * @param timestamp A UTC timestamp in milliseconds since epoch, or null/undefined
 * @returns The equivalent local timestamp in milliseconds, or undefined if input was null/undefined
 */
export const toLocalTimestamp = (timestamp?: number | null): number | undefined => {
    if (!timestamp) return undefined;

    // Create a date object using the UTC timestamp
    const date = new Date(timestamp);

    // Get timezone offset for this specific date (accounts for DST)
    const offset = date.getTimezoneOffset() * 60 * 1000;

    // Convert from UTC to local by subtracting the offset
    const convertedTimestamp = timestamp - offset;

    //console.log(`Converting UTC timestamp ${timestamp} to local: ${convertedTimestamp} (offset: ${offset})`);
    return convertedTimestamp;
};

/**
 * Converts a local timestamp to UTC.
 * 
 * @param timestamp A local timestamp in milliseconds since epoch, or null/undefined
 * @returns The equivalent UTC timestamp in milliseconds, or undefined if input was null/undefined
 */
export const toUTCTimestamp = (timestamp?: number | null): number | undefined => {
    if (!timestamp) return undefined;

    // Create a date object for the local timestamp
    const date = new Date(timestamp);

    // Get timezone offset for this specific date (accounts for DST)
    const offset = date.getTimezoneOffset() * 60 * 1000;

    // Convert from local to UTC by adding the offset
    const convertedTimestamp = timestamp + offset;

    //console.log(`Converting local timestamp ${timestamp} to UTC: ${convertedTimestamp} (offset: ${offset})`);
    return convertedTimestamp;
};

/**
 * Converts all timestamp fields in a Goal from UTC to the user's local timezone.
 * Goal must have _tz='utc' to be converted.
 * 
 * @param goal A Goal object with UTC timestamps and _tz='utc'
 * @returns A new Goal object with local timestamps and _tz='user'
 * @throws Error if goal is already in user timezone
 */
export const goalToLocal = (goal: Goal): Goal => {
    if (goal._tz === 'user') {
        throw new Error('Goal is already in user timezone');
    }

    return {
        ...goal,
        start_timestamp: toLocalTimestamp(goal.start_timestamp),
        end_timestamp: toLocalTimestamp(goal.end_timestamp),
        next_timestamp: toLocalTimestamp(goal.next_timestamp),
        scheduled_timestamp: toLocalTimestamp(goal.scheduled_timestamp),
        routine_time: toLocalTimestamp(goal.routine_time),
        _tz: 'user'
    };
};

/**
 * Converts all timestamp fields in a Goal from local timezone to UTC.
 * Goal must have _tz='user' to be converted.
 * 
 * @param goal A Goal object with local timestamps and _tz='user'
 * @returns A new Goal object with UTC timestamps and _tz='utc'
 * @throws Error if goal is already in UTC timezone
 */
export const goalToUTC = (goal: Goal): Goal => {
    if (goal._tz === undefined || goal._tz === 'utc') {
        throw new Error('Goal is already in UTC timezone');
    }

    return {
        ...goal,
        start_timestamp: toUTCTimestamp(goal.start_timestamp),
        end_timestamp: toUTCTimestamp(goal.end_timestamp),
        next_timestamp: toUTCTimestamp(goal.next_timestamp),
        scheduled_timestamp: toUTCTimestamp(goal.scheduled_timestamp),
        routine_time: toUTCTimestamp(goal.routine_time),
        _tz: 'utc'
    };
};

/**
 * Convert a Date object to a UTC timestamp (milliseconds).
 * This uses the Date.UTC() method which creates a timestamp representation
 * of the provided date components treated as UTC values.
 * 
 * @param date A JavaScript Date object
 * @returns UTC timestamp in milliseconds
 */
export const dateToTimestamp = (date: Date): number => {
    return Date.UTC(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
        date.getSeconds()
    );
};

/**
 * Convert a timestamp to a Date object.
 * The timestamp is treated as-is, without timezone adjustments.
 * 
 * @param timestamp A timestamp in milliseconds (either UTC or local, depending on context)
 * @returns A JavaScript Date object
 */
export const timestampToDate = (timestamp: number): Date => {
    return new Date(timestamp);
};

/**
 * Formats a timestamp for display in input fields.
 * Uses the browser's local timezone settings for formatting.
 * 
 * @param timestamp A timestamp in milliseconds (in the timezone indicated by the goal's _tz property)
 * @param format The desired format ('date', 'datetime', or 'time')
 * @returns A formatted string suitable for HTML input fields, or empty string if timestamp is null/undefined
 */
export const timestampToInputString = (
    timestamp: number | undefined | null,
    format: 'date' | 'datetime' | 'time'
): string => {
    if (!timestamp) return '';

    // Create a date from the timestamp (which should already be in the correct timezone based on _tz)
    // Note: We don't adjust for timezone here since that should already be handled
    const date = new Date(timestamp);

    // Log for debugging
    //console.log(`timestampToInputString: input timestamp=${timestamp}, format=${format}, date=${date.toString()}`);

    // Format the date according to the required format
    let result = '';

    switch (format) {
        case 'date':
            result = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            break;
        case 'time':
            result = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
            break;
        default: // datetime
            result = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    //console.log(`timestampToInputString: output=${result}`);
    return result;
};

/**
 * Parses an input string into a timestamp.
 * The resulting timestamp is in the local timezone, without any UTC adjustments.
 * 
 * @param dateString The string from an input field ('YYYY-MM-DD', 'HH:MM', or 'YYYY-MM-DDTHH:MM')
 * @param format The format of the input ('date', 'datetime', 'time', or 'end-date')
 * @returns A timestamp in milliseconds in the local timezone, or 0 if the input is empty/invalid
 */
export const inputStringToTimestamp = (
    dateString: string,
    format: 'date' | 'datetime' | 'time' | 'end-date'
): number => {
    if (!dateString) return 0;

    //console.log(`inputStringToTimestamp: input dateString=${dateString}, format=${format}`);

    const date = new Date();

    try {
        switch (format) {
            case 'date':
                // Set just the date part, keep time at 00:00:00
                const [dateYear, dateMonth, dateDay] = dateString.split('-').map(Number);
                if (isNaN(dateYear) || isNaN(dateMonth) || isNaN(dateDay)) return 0;
                date.setFullYear(dateYear, dateMonth - 1, dateDay);
                date.setHours(0, 0, 0, 0);
                break;

            case 'end-date':
                // Set date to end of day (23:59:59.999)
                const [endYear, endMonth, endDay] = dateString.split('-').map(Number);
                if (isNaN(endYear) || isNaN(endMonth) || isNaN(endDay)) return 0;
                date.setFullYear(endYear, endMonth - 1, endDay);
                date.setHours(23, 59, 59, 999);
                break;

            case 'time':
                // Set just the time part, keep date as is
                const [hours, minutes] = dateString.split(':').map(Number);
                if (isNaN(hours) || isNaN(minutes)) return 0;
                date.setHours(hours, minutes, 0, 0);
                break;

            case 'datetime':
                // Parse the full datetime string
                const parts = dateString.split('T');
                if (parts.length !== 2) return 0;

                const [datePart, timePart] = parts;
                const [dtYear, dtMonth, dtDay] = datePart.split('-').map(Number);
                const [dtHours, dtMinutes] = timePart.split(':').map(Number);

                if (isNaN(dtYear) || isNaN(dtMonth) || isNaN(dtDay) ||
                    isNaN(dtHours) || isNaN(dtMinutes)) return 0;

                date.setFullYear(dtYear, dtMonth - 1, dtDay);
                date.setHours(dtHours, dtMinutes, 0, 0);
                break;
        }

        // Get timestamp directly from the date without any timezone adjustments
        // since we're already working in the local timezone
        const timestamp = date.getTime();

        //console.log(`inputStringToTimestamp: output timestamp=${timestamp}, date=${date.toString()}`);
        return timestamp;
    } catch (error) {
        return 0; // Return 0 for any parsing errors
    }
};

/**
 * Formats a timestamp for display using a localized format.
 * The timestamp is interpreted as a UTC value for consistent display.
 * 
 * @param timestamp A timestamp in milliseconds, or null/undefined
 * @param format The desired format ('date', 'datetime', or 'time')
 * @returns A formatted string for display, or empty string if timestamp is null/undefined
 */
export const timestampToDisplayString = (timestamp?: number | null, format: 'date' | 'datetime' | 'time' = 'datetime'): string => {
    if (!timestamp) return '';
    const date = new Date(timestamp);

    const options: Intl.DateTimeFormatOptions = {
        timeZone: 'UTC',
        hour12: true,
    };

    switch (format) {
        case 'date':
            options.weekday = 'short';
            options.year = 'numeric';
            options.month = 'short';
            options.day = 'numeric';
            break;
        case 'time':
            options.hour = 'numeric';
            options.minute = '2-digit';
            break;
        default: // datetime
            options.weekday = 'short';
            options.year = 'numeric';
            options.month = 'short';
            options.day = 'numeric';
            options.hour = 'numeric';
            options.minute = '2-digit';
    }

    return date.toLocaleString('en-US', options);
};


