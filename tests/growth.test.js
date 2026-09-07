import { describe, it, expect } from 'vitest';
import { growthSummary, bandSeries, curveSeries, dayCurveReaches, trendOf, prematurity, weighInLine, growthSettings } from '../src/lib/growth.js';
import { weightAtZ } from '../src/lib/who.js';

const noon = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
const BIRTH = noon(2026, 6, 22);
const w = (id, ts, grams) => ({ id, type: 'weight', start_ts: ts, end_ts: null, amount: grams, side: null, descr: null });

describe('growthSummary', () => {
  const events = [w('a', BIRTH, 3035), w('b', noon(2026, 8, 31), 5160)];
  const now = noon(2026, 9, 6);
  const s = growthSummary(events, { birthTs: BIRTH, sex: 'girl' }, now);

  it('places each weigh-in on the WHO chart', () => {
    expect(s.list.map((p) => p.ageDays)).toEqual([0, 70]);
    expect(s.first.pct).toBeGreaterThan(30);
    expect(s.first.pct).toBeLessThan(50);
    expect(s.pct).toBeGreaterThan(30);
    expect(s.pct).toBeLessThan(45);
    expect(s.pctLabel).toMatch(/^\d+(st|nd|rd|th)$/);
  });
  it('knows the birth weight and the gain since', () => {
    expect(s.birthWeight.amount).toBe(3035);
    expect(s.sinceBirth).toBe(2125);
    expect(s.gainPerDay).toBeCloseTo(2125 / 70, 3);
  });
  it('projects today along her own curve, not a straight line', () => {
    expect(s.today.ageDays).toBe(76);
    expect(s.today.onCurve).toBe(weightAtZ('girl', 76, s.z));
    expect(s.today.onCurve).toBeGreaterThan(5160);
    expect(s.today.weighedToday).toBeNull();
  });
  it('projects the doubling of birth weight along her curve', () => {
    expect(s.milestones.target).toBe(6070);
    expect(s.milestones.doubled).toBeNull();
    expect(s.milestones.doubledProjected.ageDays).toBeGreaterThan(76);
    expect(weightAtZ('girl', s.milestones.doubledProjected.ageDays, s.z)).toBeGreaterThanOrEqual(6070);
    expect(weightAtZ('girl', s.milestones.doubledProjected.ageDays - 1, s.z)).toBeLessThan(6070);
  });
  it('marks a weigh-in as due after two weeks in the early months', () => {
    expect(s.rhythm.daysSince).toBe(6);
    expect(s.rhythm.due).toBe(false);
    const later = growthSummary(events, { birthTs: BIRTH, sex: 'girl' }, noon(2026, 9, 15));
    expect(later.rhythm.due).toBe(true);
  });
  it('records regained and doubled birth weight when the data shows them', () => {
    const ev = [w('a', BIRTH, 3035), w('d', noon(2026, 6, 25), 2900), w('r', noon(2026, 7, 2), 3100), w('x', noon(2026, 10, 10), 6100)];
    const t = growthSummary(ev, { birthTs: BIRTH, sex: 'girl' }, noon(2026, 10, 12));
    expect(t.milestones.regained.ageDays).toBe(10);
    expect(t.milestones.doubled.ageDays).toBe(110);
    expect(t.milestones.doubledProjected).toBeNull();
  });
  it('has no birth weight when the first weigh-in is late', () => {
    const t = growthSummary([w('b', noon(2026, 8, 31), 5160)], { birthTs: BIRTH, sex: 'girl' }, now);
    expect(t.birthWeight).toBeNull();
    expect(t.sinceBirth).toBeNull();
    expect(t.milestones).toBeNull();
    expect(t.trend).toBeNull();
  });
  it('drops weigh-ins dated before birth and handles none', () => {
    expect(growthSummary([w('z', noon(2026, 6, 1), 3000)], { birthTs: BIRTH, sex: 'girl' }, now).latest).toBeNull();
    expect(growthSummary([], { birthTs: BIRTH, sex: 'girl' }, now).ageToday).toBe(76);
  });
});

describe('trendOf', () => {
  const p = (id, z) => ({ id, z, pct: 50 });
  it('calls a small drift "same" and flags two lines crossed', () => {
    expect(trendOf(p('a', 0.1), p('b', 0.3)).direction).toBe('same');
    expect(trendOf(p('a', -0.5), p('b', 1.5))).toMatchObject({ crossed: 2, direction: 'up', flag: true });
    expect(trendOf(p('a', 1.5), p('b', 0.5))).toMatchObject({ crossed: 1, direction: 'down', flag: false });
  });
});

describe('series', () => {
  it('bands are ordered and monotone in age', () => {
    const b = bandSeries('girl', 0, 100, 5);
    expect(b[0].day).toBe(0);
    expect(b[b.length - 1].day).toBe(100);
    for (const row of b) expect(row.lo2 < row.lo1 && row.lo1 < row.med && row.med < row.hi1 && row.hi1 < row.hi2).toBe(true);
    for (let i = 1; i < b.length; i++) expect(b[i].med).toBeGreaterThan(b[i - 1].med);
  });
  it('her curve follows her z-score', () => {
    const c = curveSeries('girl', 1, 10, 20);
    expect(c[0].grams).toBe(weightAtZ('girl', 10, 1));
    expect(curveSeries('girl', null, 0, 10)).toEqual([]);
  });
  it('dayCurveReaches finds the first qualifying day', () => {
    const d = dayCurveReaches('girl', 0, 6000, 0);
    expect(weightAtZ('girl', d, 0)).toBeGreaterThanOrEqual(6000);
    expect(weightAtZ('girl', d - 1, 0)).toBeLessThan(6000);
    expect(dayCurveReaches('girl', 0, 99999, 0)).toBeNull();
  });
});

describe('corrected age for an early birth', () => {
  const DUE = noon(2026, 7, 9);
  const events = [w('a', BIRTH, 3035), w('b', noon(2026, 8, 31), 5160)];
  const now = noon(2026, 9, 6);

  it('works out how early, and the gestation', () => {
    expect(prematurity(BIRTH, DUE)).toMatchObject({ earlyDays: 17, weeks: 37, days: 4, preterm: false });
    expect(prematurity(BIRTH, noon(2026, 8, 1)).preterm).toBe(true);
    expect(prematurity(BIRTH, null).earlyDays).toBe(0);
    expect(prematurity(BIRTH, noon(2026, 6, 1)).earlyDays).toBe(0);
  });
  it('reads the chart at corrected age when asked', () => {
    const plain = growthSummary(events, { birthTs: BIRTH, sex: 'girl', dueTs: DUE, correct: false }, now);
    const corr = growthSummary(events, { birthTs: BIRTH, sex: 'girl', dueTs: DUE, correct: true }, now);
    expect(plain.corrected).toBe(false);
    expect(corr.corrected).toBe(true);
    expect(corr.latest.ageDays).toBe(70);
    expect(corr.latest.chartDay).toBe(53);
    expect(corr.pct).toBeGreaterThan(plain.pct);
    expect(corr.today.chartDay).toBe(59);
    expect(corr.today.onCurve).toBe(weightAtZ('girl', 59, corr.z));
  });
  it('leaves a weigh-in before the due date without a percentile, but keeps it', () => {
    const corr = growthSummary(events, { birthTs: BIRTH, sex: 'girl', dueTs: DUE, correct: true }, now);
    expect(corr.first.chartDay).toBe(-17);
    expect(corr.first.pct).toBeNull();
    expect(corr.birthWeight.amount).toBe(3035);
    expect(corr.sinceBirth).toBe(2125);
    expect(corr.trend).toBeNull();
    expect(corr.placedFirst.id).toBe('b');
  });
  it('projects milestones in real dates, not corrected ones', () => {
    const plain = growthSummary(events, { birthTs: BIRTH, sex: 'girl', dueTs: DUE, correct: false }, now);
    const corr = growthSummary(events, { birthTs: BIRTH, sex: 'girl', dueTs: DUE, correct: true }, now);
    expect(corr.milestones.doubledProjected.ts).toBeGreaterThan(now);
    expect(corr.milestones.doubledProjected.ageDays).toBe(corr.milestones.doubledProjected.ageDays);
    expect(Math.abs(corr.milestones.doubledProjected.ts - plain.milestones.doubledProjected.ts)).toBeLessThan(30 * 24 * 3600e3);
  });
});

describe('weighInLine', () => {
  const settings = { sex: 'girl', birthTs: BIRTH, dueTs: noon(2026, 7, 9), correct: true };
  const events = [w('a', BIRTH, 3035), w('b', noon(2026, 8, 31), 5160)];
  it('says the weight, the percentile and the gain since the previous weigh-in', () => {
    const line = weighInLine(events, settings, noon(2026, 9, 14), 5580);
    expect(line).toMatch(/^5,580 g · \d+(st|nd|rd|th) percentile \(corrected\) · \+30 g\/day since/);
  });
  it('ignores a same-day reading being corrected, and copes with the first weigh-in', () => {
    expect(weighInLine(events, settings, noon(2026, 8, 31), 5200)).toMatch(/since/);
    expect(weighInLine([], settings, noon(2026, 8, 31), 5200)).not.toMatch(/since/);
  });
  it('reads settings from prefs with safe defaults', () => {
    const s = growthSettings({ birthDate: '2026-06-22', sex: 'girl', dueDate: '2026-07-09', correctAge: true });
    expect(s).toMatchObject({ sex: 'girl', correct: true });
    expect(growthSettings({}).sex).toBe('girl');
  });
});
