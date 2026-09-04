import { describe, it, expect } from 'vitest';
import { sleepTypeFor, openSleep, lastSleep, sortEvents } from '../src/lib/events.js';

const at = (h, m = 0) => new Date(2026, 8, 4, h, m).getTime();
let n = 0;
const ev = (type, start_ts, end_ts = null) => ({
  id: `s${n++}`, household: 'h', type, start_ts, end_ts, amount: null, side: null, descr: null,
});

describe('night or nap, by the clock', () => {
  // The household's rule, exactly as stated: 21:00–06:00 night, 06:01–20:59 nap.
  it('calls the boundaries the way they were written', () => {
    expect(sleepTypeFor(at(21, 0))).toBe('night');
    expect(sleepTypeFor(at(20, 59))).toBe('nap');
    expect(sleepTypeFor(at(6, 0))).toBe('night');
    expect(sleepTypeFor(at(6, 1))).toBe('nap');
  });

  it('treats the small hours as night and the middle of the day as nap', () => {
    expect(sleepTypeFor(at(0, 30))).toBe('night');
    expect(sleepTypeFor(at(3, 15))).toBe('night');
    expect(sleepTypeFor(at(23, 45))).toBe('night');
    expect(sleepTypeFor(at(10, 0))).toBe('nap');
    expect(sleepTypeFor(at(13, 30))).toBe('nap');
    expect(sleepTypeFor(at(19, 45))).toBe('nap');
  });
});

describe('the merged sleep tile reads both kinds', () => {
  it('finds a running sleep whichever kind it is', () => {
    const events = sortEvents([ev('nap', at(13, 30)), ev('nurse', at(14, 0), at(14, 0))]);
    expect(openSleep(events).type).toBe('nap');
    const night = sortEvents([ev('night', at(21, 30))]);
    expect(openSleep(night).type).toBe('night');
  });

  it('ignores a one-tap event that also has no end', () => {
    // wet/poop/vitd have end_ts null too; they are not sleeps.
    expect(openSleep(sortEvents([ev('wet', at(9, 0))]))).toBe(null);
  });

  it('picks the most recent sleep of either kind as "last"', () => {
    const events = sortEvents([
      ev('night', at(0, 30), at(5, 0)),
      ev('nap', at(10, 0), at(11, 0)),
      ev('tummy', at(12, 0), at(12, 15)),
    ]);
    expect(lastSleep(events).type).toBe('nap');
  });
});
