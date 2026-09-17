import { describe, it, expect } from 'vitest';
import { toTenths, formatTemp, readings, lastReading, recentReadings, isFever } from '../src/lib/temp.js';
import { HOUR } from '../src/lib/time.js';

const t = (id, ts, amount) => ({ id, type: 'temp', start_ts: ts, amount });

describe('temperature', () => {
  it('parses a reading in tenths, accepting a comma, rejecting nonsense', () => {
    expect(toTenths('38.2')).toBe(382);
    expect(toTenths('37,6')).toBe(376);
    expect(toTenths(36.85)).toBe(369);
    expect(toTenths('abc')).toBeNull();
    expect(toTenths('50')).toBeNull();
    expect(toTenths('')).toBeNull();
  });
  it('formats with one decimal', () => {
    expect(formatTemp(382)).toBe('38.2 °C');
    expect(formatTemp(370)).toBe('37.0 °C');
    expect(formatTemp(null)).toBe('—');
  });
  it('orders readings oldest first and finds the last', () => {
    const list = readings([t('b', 2000, 381), t('a', 1000, 372), { id: 'x', type: 'temp', start_ts: 1500, amount: null }]);
    expect(list.map((r) => r.id)).toEqual(['a', 'b']);
    expect(list[0].c).toBe(37.2);
    expect(lastReading([t('b', 2000, 381), t('a', 1000, 372)]).id).toBe('b');
    expect(lastReading([])).toBeNull();
  });
  it('keeps only the last three days as recent', () => {
    const now = 100 * HOUR;
    const list = recentReadings([t('old', now - 80 * HOUR, 370), t('new', now - 5 * HOUR, 383)], now);
    expect(list.map((r) => r.id)).toEqual(['new']);
  });
  it('calls 38.0 and above a fever', () => {
    expect(isFever(380)).toBe(true);
    expect(isFever(379)).toBe(false);
    expect(isFever(null)).toBe(false);
  });
});
