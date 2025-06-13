// time.ts  — v2  (instants ⇄ Date objects, same function names)
// -----------------------------------------------------------------
import { Goal, ApiGoal } from '../../types/goals';

/* ────────────────────────────────────────────────────────── *
 *  1.  Low-level helpers                                     *
 * ────────────────────────────────────────────────────────── */

/** Wrap a UTC ms value (or undefined) into a Date in local zone. */
const msToDate = (ms?: number | null): Date | undefined =>
  ms == null ? undefined : new Date(ms);

/** Extract UTC ms from a Date (or undefined). */
const dateToMs = (d?: Date | null): number | undefined =>
  d == null ? undefined : d.getTime();

/* ────────────────────────────────────────────────────────── *
 *  2.  Former "timestamp conversion" API                     *
 *      (names kept for drop-in compatibility)                *
 * ────────────────────────────────────────────────────────── */

/**
 * API → frontend : UTC ms ➜ Date   (was "toLocalTimestamp").
 * Simply converts a UTC timestamp to a Date object - the Date object will 
 * automatically display in the user's local timezone.
 */
export const toLocalTimestamp = <T extends number | null | undefined>(
  timestamp?: T
): T extends number ? Date : undefined => {
  if (timestamp == null) {
    // @ts-expect-error  (generic return for drop-in)
    return undefined;
  }

  // Simply create a Date from the UTC timestamp - no manual offset needed
  // @ts-expect-error  (generic return for drop-in)
  return new Date(timestamp);
};

/**
 * frontend → API : Date ➜ UTC ms   (was "toUTCTimestamp").
 * Converts a Date to UTC timestamp using getTime().
 */
export const toUTCTimestamp = <T extends Date | number | null | undefined>(
  value?: T
): number | undefined => {
  if (value == null) return undefined;

  if (value instanceof Date) {
    // Date.getTime() already returns UTC milliseconds
    return value.getTime();
  } else {
    // If it's already a number, return as-is
    return value as number;
  }
};

/* ────────────────────────────────────────────────────────── *
 *  3.  Goal-level helpers                                    *
 * ────────────────────────────────────────────────────────── */

// Define a type for the API representation of a Goal with numeric timestamps


/** Converts a Goal-like object from API (numeric timestamps) to frontend Goal (Date objects). */
export const goalToLocal = (apiGoal: ApiGoal): Goal => ({
  ...apiGoal,
  start_timestamp: msToDate(apiGoal.start_timestamp),
  end_timestamp: msToDate(apiGoal.end_timestamp),
  next_timestamp: msToDate(apiGoal.next_timestamp),
  scheduled_timestamp: msToDate(apiGoal.scheduled_timestamp),
  routine_time: msToDate(apiGoal.routine_time),
  due_date: msToDate(apiGoal.due_date),
  start_date: msToDate(apiGoal.start_date),
});

/** Converts a frontend Goal (Date objects) to an API Goal representation (numeric timestamps). */
export const goalToUTC = (goal: Goal): ApiGoal => ({
  ...goal,
  start_timestamp: dateToMs(goal.start_timestamp),
  end_timestamp: dateToMs(goal.end_timestamp),
  next_timestamp: dateToMs(goal.next_timestamp),
  scheduled_timestamp: dateToMs(goal.scheduled_timestamp),
  routine_time: dateToMs(goal.routine_time),
  due_date: dateToMs(goal.due_date),
  start_date: dateToMs(goal.start_date),
});

/* ────────────────────────────────────────────────────────── *
 *  4.  Miscellaneous utilities                               *
 * ────────────────────────────────────────────────────────── */

export const dateToTimestamp = (date: Date): number => date.getTime();

export const timestampToDate = (ts: number | Date): Date =>
  ts instanceof Date ? ts : new Date(ts);

/** Format for HTML inputs – accepts Date or ms. */
export const timestampToInputString = (
  value: number | Date | null | undefined,
  format: 'date' | 'datetime' | 'time'
): string => {
  if (value == null) return '';
  const d = value instanceof Date ? value : new Date(value);

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');

  switch (format) {
    case 'date':
      return `${y}-${m}-${day}`;
    case 'time':
      return `${hh}:${mm}`;
    default:
      return `${y}-${m}-${day}T${hh}:${mm}`;
  }
};

/** Parse value from input fields – always returns *local* Date. */
export const inputStringToTimestamp = (
  str: string,
  format: 'date' | 'datetime' | 'time' | 'end-date'
): Date => {
  // Return Epoch date for empty/invalid string instead of 0
  if (!str) return new Date(0);
  const today = new Date();

  try {
    let d = new Date(today); // start from today to preserve Y-M-D when parsing 'time'
    switch (format) {
      case 'date': {
        const parts = str.split('-');
        if (parts.length !== 3) return new Date(0);
        const [y, m, dd] = parts.map(Number);
        // Validate the input values
        if (isNaN(y) || isNaN(m) || isNaN(dd) ||
          y < 1000 || y > 9999 || m < 1 || m > 12 || dd < 1 || dd > 31) {
          return new Date(0);
        }
        d = new Date(y, m - 1, dd, 0, 0, 0, 0);
        // Check if the date components actually match what we set
        if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== dd) {
          return new Date(0);
        }
        break;
      }
      case 'end-date': {
        const parts = str.split('-');
        if (parts.length !== 3) return new Date(0);
        const [y, m, dd] = parts.map(Number);
        // Validate the input values
        if (isNaN(y) || isNaN(m) || isNaN(dd) ||
          y < 1000 || y > 9999 || m < 1 || m > 12 || dd < 1 || dd > 31) {
          return new Date(0);
        }
        d = new Date(y, m - 1, dd, 23, 59, 59, 999);
        // Check if the date components actually match what we set
        if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== dd) {
          return new Date(0);
        }
        break;
      }
      case 'time': {
        const parts = str.split(':');
        if (parts.length !== 2) return new Date(0);
        const [hh, mm] = parts.map(Number);
        // Validate the input values
        if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
          return new Date(0);
        }
        d.setHours(hh, mm, 0, 0);
        break;
      }
      case 'datetime':
      default: {
        const mainParts = str.split('T');
        if (mainParts.length !== 2) return new Date(0);
        const [datePart, timePart] = mainParts;

        const dateParts = datePart.split('-');
        const timeParts = timePart.split(':');
        if (dateParts.length !== 3 || timeParts.length !== 2) return new Date(0);

        const [y, m, dd] = dateParts.map(Number);
        const [hh, mm] = timeParts.map(Number);

        // Validate all values
        if (isNaN(y) || isNaN(m) || isNaN(dd) || isNaN(hh) || isNaN(mm) ||
          y < 1000 || y > 9999 || m < 1 || m > 12 || dd < 1 || dd > 31 ||
          hh < 0 || hh > 23 || mm < 0 || mm > 59) {
          return new Date(0);
        }

        d = new Date(y, m - 1, dd, hh, mm, 0, 0);
        // Check if the date components actually match what we set
        if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== dd) {
          return new Date(0);
        }
      }
    }
    // Ensure the parsed date is valid before returning
    return isNaN(d.getTime()) ? new Date(0) : d;
  } catch (e) {
    // Return Epoch date on parsing error
    return new Date(0);
  }
};

/** Localised display helper – unchanged semantics. */
export const timestampToDisplayString = (
  value?: number | Date | null,
  format: 'date' | 'datetime' | 'time' = 'datetime'
): string => {
  if (value == null) return '';
  const d = value instanceof Date ? value : new Date(value);

  const opts: Intl.DateTimeFormatOptions =
    format === 'time'
      ? { hour: 'numeric', minute: '2-digit' }
      : format === 'date'
        ? { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }
        : {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        };

  return d.toLocaleString(undefined, opts);
};

