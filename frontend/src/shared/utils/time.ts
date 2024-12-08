import { Goal } from "../../types/goals";

export const toLocalTimestamp = (timestamp?: number | null): number | undefined => {
    if (!timestamp) return undefined;
    return timestamp + new Date().getTimezoneOffset() * 60 * 1000;
};

export const toUTCTimestamp = (timestamp?: number | null): number | undefined => {
    if (!timestamp) return undefined;
    return timestamp - new Date().getTimezoneOffset() * 60 * 1000;
};

// Goal conversion utilities
export const goalToLocal = (goal: Goal): Goal => {
    if (goal._tz === 'user') {
        throw new Error('Goal is already in user timezone');
    }
    console.trace()
    console.log(goal.scheduled_timestamp, toLocalTimestamp(goal.scheduled_timestamp))
    console.log(goal.routine_time, toLocalTimestamp(goal.routine_time))

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
    timestamp: number | undefined,
    format: 'date' | 'datetime' | 'time'
): string => {
    if (!timestamp) return '';
    const isoString = new Date(timestamp).toISOString();

    switch (format) {
        case 'date':
            return isoString.slice(0, 10);
        case 'time':
            return isoString.slice(11, 16);
        default: // datetime
            return isoString.slice(0, 16);
    }
};

// Parse a datetime-local input string to UTC timestamp
export const inputStringToTimestamp = (
    dateString: string,
    format: 'date' | 'datetime' | 'time' | 'end-date'
): number => {
    let fullDateString = dateString;

    switch (format) {
        case 'date':
            fullDateString = `${dateString}T00:00:00`;
            break;
        case 'end-date':
            fullDateString = `${dateString}T23:59:59.999`;
            break;
        case 'time':
            fullDateString = `1970-01-01T${dateString}`;
            break;
        // datetime case uses the full string as-is
    }

    return dateToTimestamp(new Date(fullDateString));
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


