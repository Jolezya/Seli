import { describe, it, expect } from 'vitest';
import { bathSchedule, bathHint, toggleDay, DEFAULT_BATH_DAYS } from '../src/lib/bath.js';

// 2026-09-06 is a Sunday; 09-05 Saturday; 09-02 Wednesday.
const at = (d, h = 12) => new Date(2026, 8, d, h, 0, 0, 0).getTime();
const bath = (id, ts) => ({ id, type: 'bath', start_ts: ts, end_ts: null });

describe('bathSchedule', () => {
  it('defaults to Wednesday and Saturday', () => {
    expect(DEFAULT_BATH_DAYS).toEqual([3, 6]);
  });
  it('knows a bath day, and whether it is done', () => {
    const sat = bathSchedule([], DEFAULT_BATH_DAYS, at(5, 10));
    expect(sat.isBathDay).toBe(true);
    expect(sat.doneToday).toBeNull();
    expect(bathHint(sat)).toBe('bath day today');
    const done = bathSchedule([bath('a', at(5, 21))], DEFAULT_BATH_DAYS, at(5, 22));
    expect(done.doneToday.id).toBe('a');
    expect(bathHint(done)).toBe('next Wed');
  });
  it('names the next scheduled day', () => {
    const sun = bathSchedule([bath('a', at(5, 21))], DEFAULT_BATH_DAYS, at(6));
    expect(sun.isBathDay).toBe(false);
    expect(sun.next.label).toBe('Wed');
    expect(bathHint(sun)).toBe('next Wed');
  });
  it('flags the most recent scheduled day that was missed', () => {
    const sun = bathSchedule([bath('a', at(2, 21))], DEFAULT_BATH_DAYS, at(6));
    expect(sun.missed.label).toBe('Sat');
    expect(bathHint(sun)).toBe('missed Sat · next Wed');
  });
  it('clears the missed flag once a bath is logged afterwards', () => {
    const sun = bathSchedule([bath('a', at(6, 9))], DEFAULT_BATH_DAYS, at(6, 10));
    expect(sun.missed).toBeNull();
    expect(bathHint(sun)).toBe('next Wed');
  });
  it('never calls today missed while today is still going', () => {
    const sat = bathSchedule([], DEFAULT_BATH_DAYS, at(5, 23));
    expect(sat.missed.label).toBe('Wed');
    expect(bathHint(sat)).toBe('bath day today');
  });
  it('handles an empty schedule quietly', () => {
    const s = bathSchedule([], [], at(6));
    expect(s.isBathDay).toBe(false);
    expect(s.next).toBeNull();
    expect(bathHint(s)).toBeNull();
  });
});

describe('toggleDay', () => {
  it('adds and removes, sorted', () => {
    expect(toggleDay([3, 6], 0)).toEqual([0, 3, 6]);
    expect(toggleDay([3, 6], 3)).toEqual([6]);
  });
});
