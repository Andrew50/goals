import { formatFrequency } from './frequency';

describe('formatFrequency', () => {
    test('returns "Not set" for undefined', () => {
        expect(formatFrequency(undefined)).toBe('Not set');
    });

    test('returns "Not set" for empty string', () => {
        expect(formatFrequency('')).toBe('Not set');
    });

    test('formats daily frequency correctly', () => {
        expect(formatFrequency('1D')).toBe('Every 1 day');
        expect(formatFrequency('2D')).toBe('Every 2 days');
        expect(formatFrequency('7D')).toBe('Every 7 days');
    });

    test('formats weekly frequency correctly', () => {
        expect(formatFrequency('1W')).toBe('Every 1 week');
        expect(formatFrequency('2W')).toBe('Every 2 weeks');
        expect(formatFrequency('1W:0')).toBe('Every 1 week on Sunday');
        expect(formatFrequency('1W:1')).toBe('Every 1 week on Monday');
        expect(formatFrequency('1W:0,1,2')).toBe('Every 1 week on Sunday, Monday, Tuesday');
        expect(formatFrequency('2W:5,6')).toBe('Every 2 weeks on Friday, Saturday');
    });

    test('formats monthly frequency correctly', () => {
        expect(formatFrequency('1M')).toBe('Every 1 month');
        expect(formatFrequency('3M')).toBe('Every 3 months');
        expect(formatFrequency('6M')).toBe('Every 6 months');
    });

    test('formats yearly frequency correctly', () => {
        expect(formatFrequency('1Y')).toBe('Every 1 year');
        expect(formatFrequency('2Y')).toBe('Every 2 years');
    });

    test('returns original string for invalid format', () => {
        expect(formatFrequency('invalid')).toBe('invalid');
        expect(formatFrequency('XYZ')).toBe('XYZ');
        expect(formatFrequency('123')).toBe('123');
    });

    test('handles edge cases', () => {
        expect(formatFrequency('0D')).toBe('Every 0 days'); // 0 !== '1', so uses plural
        expect(formatFrequency('100D')).toBe('Every 100 days');
    });
});

