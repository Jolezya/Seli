import { describe, it, expect } from 'vitest';
import { msLeftInDay, leftLabel, taskTone, NUDGE_MS } from '../src/lib/tasks.js';
import { HOUR, MINUTE } from '../src/lib/time.js';

const at = (h, m = 0) => { const d = new Date(2026, 8, 5, h, m, 0, 0); return d.getTime(); };

describe('msLeftInDay', () => {
  it('counts to the next local midnight', () => {
    expect(msLeftInDay(at(9, 30))).toBe(14 * HOUR + 30 * MINUTE);
    expect(msLeftInDay(at(23, 59))).toBe(MINUTE);
  });
  it('is a full day right after midnight', () => {
    expect(msLeftInDay(at(0, 0))).toBe(24 * HOUR);
  });
});

describe('leftLabel', () => {
  it('reads in hours and minutes, never seconds', () => {
    expect(leftLabel(14 * HOUR + 30 * MINUTE)).toBe('14h 30m left');
    expect(leftLabel(45 * MINUTE)).toBe('45m left');
    expect(leftLabel(20 * 1000)).toBe('under a minute');
  });
});

describe('taskTone', () => {
  it('is calm in the morning with tasks open', () => {
    expect(taskTone({ allDone: false, now: at(9) })).toBe('calm');
  });
  it('warms after noon', () => {
    expect(taskTone({ allDone: false, now: at(12) })).toBe('warn');
    expect(taskTone({ allDone: false, now: at(18) })).toBe('warn');
  });
  it('nudges in the last two hours of the day', () => {
    expect(taskTone({ allDone: false, now: at(22, 1) })).toBe('nudge');
    expect(taskTone({ allDone: false, now: at(21, 59) })).toBe('warn');
    expect(NUDGE_MS).toBe(2 * HOUR);
  });
  it('is done whenever every task is ticked, whatever the hour', () => {
    expect(taskTone({ allDone: true, now: at(23, 30) })).toBe('done');
  });
});
