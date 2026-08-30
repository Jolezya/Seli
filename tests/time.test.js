import { describe, it, expect } from 'vitest';
import {
  dayKey, isSameLocalDay, isToday, timeAgo, daysBetween, lastNDays,
  localNoon, formatDuration, fromDatetimeLocal, toDatetimeLocal, fromDateInput,
} from '../src/lib/time.js';

describe('local-day grouping', () => {
  it('groups an after-midnight event under the new local day, not the UTC day', () => {
    // 00:30 local. In many timezones this is still "yesterday" in UTC — the bug
    // that made just-after-midnight feeds vanish from Today.
    const justAfterMidnight = new Date(2026, 7, 30, 0, 30).getTime();
    const laterSameDay = new Date(2026, 7, 30, 14, 0).getTime();
    expect(dayKey(justAfterMidnight)).toBe('2026-08-30');
    expect(isSameLocalDay(justAfterMidnight, laterSameDay)).toBe(true);
    expect(isToday(justAfterMidnight, laterSameDay)).toBe(true);
  });

  it('separates 23:59 from 00:01 the next day', () => {
    const before = new Date(2026, 7, 29, 23, 59).getTime();
    const after = new Date(2026, 7, 30, 0, 1).getTime();
    expect(isSameLocalDay(before, after)).toBe(false);
    expect(daysBetween(before, after)).toBe(1);
  });

  it('stamps weigh-ins at local noon', () => {
    const ts = localNoon(new Date(2026, 7, 30, 3, 15).getTime());
    expect(new Date(ts).getHours()).toBe(12);
    expect(dayKey(ts)).toBe('2026-08-30');
  });

  it('lastNDays ends on today and is ordered oldest first', () => {
    const now = new Date(2026, 7, 30, 9, 0).getTime();
    const days = lastNDays(7, now);
    expect(days).toHaveLength(7);
    expect(dayKey(days[6])).toBe('2026-08-30');
    expect(dayKey(days[0])).toBe('2026-08-24');
    expect(days[0]).toBeLessThan(days[6]);
  });
});

describe('timeAgo', () => {
  const now = new Date(2026, 7, 30, 12, 0).getTime();
  it('says "just now" under 45s', () => {
    expect(timeAgo(now - 30 * 1000, now)).toBe('just now');
  });
  it('shows minutes then hours+minutes under 48h', () => {
    expect(timeAgo(now - 5 * 60000, now)).toBe('5m ago');
    expect(timeAgo(now - (2 * 3600000 + 5 * 60000), now)).toBe('2h 5m ago');
    expect(timeAgo(now - 3 * 3600000, now)).toBe('3h ago');
  });
  it('collapses to whole days past 48h so the tile never overflows', () => {
    expect(timeAgo(now - 226 * 3600000, now)).toBe('9d ago');
    expect(timeAgo(now - 49 * 3600000, now)).toBe('2d ago');
  });
});

describe('duration + input round-trips', () => {
  it('formats durations compactly', () => {
    expect(formatDuration(45 * 60000)).toBe('45m');
    expect(formatDuration(65 * 60000)).toBe('1h 05m');
  });
  it('round-trips a datetime-local value in LOCAL time', () => {
    const ts = new Date(2026, 7, 30, 14, 30).getTime();
    expect(fromDatetimeLocal(toDatetimeLocal(ts))).toBe(ts);
  });
  it('parses a date input to local noon', () => {
    const ts = fromDateInput('2026-08-30');
    expect(new Date(ts).getHours()).toBe(12);
    expect(dayKey(ts)).toBe('2026-08-30');
  });
});
