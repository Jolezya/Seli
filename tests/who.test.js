import { describe, it, expect } from 'vitest';
import { lmsAt, zScore, weightAtZ, percentile, ordinal, linesCrossed, MAX_AGE_DAYS } from '../src/lib/who.js';

describe('WHO weight-for-age tables', () => {
  it('carry the published medians at birth', () => {
    expect(lmsAt('girl', 0)[1]).toBe(3.2322);
    expect(lmsAt('boy', 0)[1]).toBe(3.3464);
  });
  it('match the WHO monthly table to within rounding', () => {
    // WHO girls: month 2 = 5.1282 kg, month 12 = 8.9481 kg (ages in months × 30.4375 days).
    expect(lmsAt('girl', 61)[1]).toBeCloseTo(5.1282, 1);
    expect(lmsAt('girl', 365)[1]).toBeCloseTo(8.9481, 1);
  });
  it('clamp to the table edges and reject an unknown sex', () => {
    expect(lmsAt('girl', -5)).toEqual(lmsAt('girl', 0));
    expect(lmsAt('girl', 9999)).toEqual(lmsAt('girl', MAX_AGE_DAYS));
    expect(lmsAt('cat', 10)).toBeNull();
  });
});

describe('z-scores and percentiles', () => {
  it('put the median at z = 0 and the 50th percentile', () => {
    const z = zScore('girl', 0, 3232.2);
    expect(Math.abs(z)).toBeLessThan(1e-6);
    expect(percentile(z)).toBeCloseTo(50, 5);
  });
  it('round-trip weight → z → weight', () => {
    for (const [sex, day, g] of [['girl', 70, 5160], ['boy', 10, 3400], ['girl', 400, 9200]]) {
      const z = zScore(sex, day, g);
      expect(weightAtZ(sex, day, z)).toBe(g);
    }
  });
  it('land the WHO printed ±2 SD lines at birth (girls 2.4 / 4.2 kg)', () => {
    expect(weightAtZ('girl', 0, -2)).toBeCloseTo(2400, -2);
    expect(weightAtZ('girl', 0, 2)).toBeCloseTo(4200, -2);
  });
  it('return null for nonsense', () => {
    expect(zScore('girl', 10, 0)).toBeNull();
    expect(zScore('girl', 10, null)).toBeNull();
  });
});

describe('labels', () => {
  it('ordinal suffixes', () => {
    expect(ordinal(72)).toBe('72nd');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(50.4)).toBe('50th');
    expect(ordinal(0.4)).toBe('<1st');
    expect(ordinal(99.7)).toBe('>99th');
  });
  it('count major lines crossed between two z-scores', () => {
    expect(linesCrossed(0.3, 0.6)).toBe(0);
    expect(linesCrossed(0.3, 1.2)).toBe(1);
    expect(linesCrossed(-0.5, 1.5)).toBe(2);
    expect(linesCrossed(null, 1)).toBe(0);
  });
});
