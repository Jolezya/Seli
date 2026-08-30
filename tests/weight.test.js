import { describe, it, expect } from 'vitest';
import {
  weighIns, weighInOnDay, weightSummary, expectedAt, observedGain,
  clampGain, nadir, formatGrams, inRange,
} from '../src/lib/weight.js';
import { localNoon, DAY, dayKey } from '../src/lib/time.js';

const NOW = new Date(2026, 7, 30, 15, 0).getTime();
const w = (dayOffset, grams) => ({
  id: `w${dayOffset}`, household: 'h', type: 'weight',
  start_ts: localNoon(NOW + dayOffset * DAY), end_ts: null,
  amount: grams, side: null, descr: null,
});

describe('weigh-ins', () => {
  it('keeps only valid weight rows, oldest first', () => {
    const list = weighIns([w(0, 4500), w(-2, 4400), { type: 'wet', id: 'x', start_ts: 1 }, { ...w(-1, null) }]);
    expect(list.map((e) => e.amount)).toEqual([4400, 4500]);
  });

  it('finds an existing weigh-in for a day so a correction updates in place', () => {
    const events = [w(0, 4500)];
    const existing = weighInOnDay(events, NOW);
    expect(existing.id).toBe('w0');
    expect(dayKey(existing.start_ts)).toBe(dayKey(NOW));
    expect(weighInOnDay(events, NOW - 3 * DAY)).toBe(null);
  });

  it('finds the nadir, which is where growth is measured from', () => {
    expect(nadir([w(-4, 4200), w(-2, 4000), w(0, 4300)]).amount).toBe(4000);
  });
});

describe('projection', () => {
  it('projects the expected line forward from the nadir at the chosen g/day', () => {
    const n = w(-10, 4000);
    expect(expectedAt(n, 20, localNoon(NOW))).toBe(4200); // 10 days x 20g
    expect(expectedAt(n, 30, localNoon(NOW))).toBe(4300);
    expect(expectedAt(null, 20, NOW)).toBe(null);
  });

  it('measures observed gain as g/day from recent weigh-ins', () => {
    const gain = observedGain([w(-8, 4000), w(-4, 4100), w(0, 4200)]);
    expect(gain).toBeCloseTo(25, 5);
  });

  it('returns no observed gain from a single point or a single day', () => {
    expect(observedGain([w(0, 4200)])).toBe(null);
    expect(observedGain([w(0, 4200), w(0, 4250)])).toBe(null);
  });

  it('summarises current weight, change and expected-vs-actual', () => {
    const s = weightSummary([w(-10, 4000), w(-5, 4150), w(0, 4300)], 20, NOW);
    expect(s.latest.amount).toBe(4300);
    expect(s.change).toBe(150);
    expect(s.nadirPoint.amount).toBe(4000);
    expect(s.expected.weight).toBe(4200);   // nadir + 10 days x 20g
    expect(s.expected.diff).toBe(100);      // 100g ahead of the line
    expect(s.expected.weighedToday).toBe(4300);
    expect(s.projection.nextTs).toBeGreaterThan(s.latest.start_ts);
  });

  it('handles an empty history without throwing', () => {
    const s = weightSummary([], 20, NOW);
    expect(s.latest).toBe(null);
    expect(s.projection).toBe(null);
    expect(s.expected).toBe(null);
  });
});

describe('inputs and formatting', () => {
  it('clamps the expected-gain stepper to a sane range', () => {
    expect(clampGain(20)).toBe(20);
    expect(clampGain(2)).toBe(5);
    expect(clampGain(999)).toBe(60);
    expect(clampGain('nonsense')).toBe(20);
  });
  it('filters to a range chip', () => {
    const list = weighIns([w(-100, 4000), w(-10, 4200), w(0, 4300)]);
    expect(inRange(list, '1m', NOW)).toHaveLength(2);
    expect(inRange(list, 'all', NOW)).toHaveLength(3);
  });
  it('formats grams with a thousands separator', () => {
    expect(formatGrams(4564)).toMatch(/4.564 g/);
    expect(formatGrams(null)).toBe('—');
  });
});
