import { Goal } from "../../types/goals";

export const toLocalTimestamp = (timestamp?: number | null): number | undefined => {
    if (!timestamp) return undefined;

    // Log the conversion for debugging
    const offset = new Date().getTimezoneOffset() * 60 * 1000;
    const convertedTimestamp = timestamp - offset;

    //console.log(`Converting UTC timestamp ${timestamp} to local: ${convertedTimestamp} (offset: ${offset})`);
    return convertedTimestamp;
};

export const toUTCTimestamp = (timestamp?: number | null): number | undefined => {
    if (!timestamp) return undefined;

    // Log the conversion for debugging
    const offset = new Date().getTimezoneOffset() * 60 * 1000;
    const convertedTimestamp = timestamp + offset;

    //console.log(`Converting local timestamp ${timestamp} to UTC: ${convertedTimestamp} (offset: ${offset})`);
    return convertedTimestamp;
};

// Goal conversion utilities
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

// Convert a Date object to a UTC timestamp (milliseconds)
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

// Convert a timestamp to a Date object (preserving UTC)
export const timestampToDate = (timestamp: number): Date => {
    return new Date(timestamp);
};

// Format a timestamp for datetime-local input (YYYY-MM-DDTHH:mm)
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

// Parse a datetime-local input string to timestamp
export const inputStringToTimestamp = (
    dateString: string,
    format: 'date' | 'datetime' | 'time' | 'end-date'
): number => {
    if (!dateString) return 0;

    //console.log(`inputStringToTimestamp: input dateString=${dateString}, format=${format}`);

    const date = new Date();

    switch (format) {
        case 'date':
            // Set just the date part, keep time at 00:00:00
            const [dateYear, dateMonth, dateDay] = dateString.split('-').map(Number);
            date.setFullYear(dateYear, dateMonth - 1, dateDay);
            date.setHours(0, 0, 0, 0);
            break;

        case 'end-date':
            // Set date to end of day (23:59:59.999)
            const [endYear, endMonth, endDay] = dateString.split('-').map(Number);
            date.setFullYear(endYear, endMonth - 1, endDay);
            date.setHours(23, 59, 59, 999);
            break;

        case 'time':
            // Set just the time part, keep date as is
            const [hours, minutes] = dateString.split(':').map(Number);
            date.setHours(hours, minutes, 0, 0);
            break;

        case 'datetime':
            // Parse the full datetime string
            const [datePart, timePart] = dateString.split('T');
            const [dtYear, dtMonth, dtDay] = datePart.split('-').map(Number);
            const [dtHours, dtMinutes] = timePart.split(':').map(Number);

            date.setFullYear(dtYear, dtMonth - 1, dtDay);
            date.setHours(dtHours, dtMinutes, 0, 0);
            break;
    }

    // Get timestamp directly from the date without any timezone adjustments
    // since we're already working in the local timezone
    const timestamp = date.getTime();

    //console.log(`inputStringToTimestamp: output timestamp=${timestamp}, date=${date.toString()}`);
    return timestamp;
};

// Format timestamp for display (using UTC)
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


