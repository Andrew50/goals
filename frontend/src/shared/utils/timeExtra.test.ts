import { toUTCTimestamp, toLocalTimestamp, timestampToInputString, inputStringToTimestamp } from './time';
import { mockTimezone } from './testUtils';

describe('Additional timestamp conversion tests', () => {
  test('toUTCTimestamp returns numeric value unchanged', () => {
    const ts = 1672574400000;
    expect(toUTCTimestamp(ts)).toBe(ts);
  });

  test('toLocalTimestamp handles undefined gracefully', () => {
    expect(toLocalTimestamp(undefined)).toBeUndefined();
  });

  test('round trip input string conversion preserves value', () => {
    const restore = mockTimezone(300); // EST
    const input = '2023-03-25T08:15';
    const date = inputStringToTimestamp(input, 'datetime');
    const back = timestampToInputString(date, 'datetime');
    expect(back).toBe('2023-03-25T08:15');
    restore();
  });
});
