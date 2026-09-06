// Growth: where a baby sits on the WHO weight-for-age chart, and how that has
// moved. Everything here is derived from the weigh-ins plus two facts the
// parents set once — birth date and sex — so there is no state to go stale.

import { DAY, daysBetween, addDays, localNoon } from './time.js';
import { weighIns } from './weight.js';
import { zScore, weightAtZ, percentile, ordinal, linesCrossed, MAX_AGE_DAYS, BAND_Z } from './who.js';

/** A weigh-in within this many days of birth counts as the birth weight. */
const BIRTH_WINDOW_DAYS = 2;
/** Weigh-in cadence that keeps the curve honest: weekly early, monthly later. */
const DUE_AFTER_DAYS = { early: 14, later: 35 };
const EARLY_UNTIL_DAYS = 183;

export function ageInDays(birthTs, ts) {
  return daysBetween(birthTs, ts);
}

/** A term pregnancy: babies born before this are conventionally age-corrected. */
export const TERM_WEEKS = 37;

/**
 * How early the birth was, in days, and the gestation it implies. A due date
 * marks 40 weeks; being born 17 days early means 37 weeks 4 days.
 */
export function prematurity(birthTs, dueTs) {
  if (!dueTs) return { earlyDays: 0, gestationDays: null, weeks: null, days: null, preterm: false };
  const earlyDays = Math.max(0, daysBetween(birthTs, dueTs));
  const gestationDays = 280 - earlyDays;
  return {
    earlyDays,
    gestationDays,
    weeks: Math.floor(gestationDays / 7),
    days: gestationDays % 7,
    preterm: gestationDays < TERM_WEEKS * 7,
  };
}

/**
 * Weigh-ins with age, z-score and percentile attached. `chartDay` is the age
 * the WHO chart is read at: chronological age, minus the days born early when
 * correcting. A weigh-in before the corrected "day 0" (before the due date)
 * keeps its place on the x-axis but has no percentile — the chart starts at
 * term. Pre-birth rows are dropped.
 */
export function placedWeighIns(events, birthTs, sex, earlyDays = 0) {
  return weighIns(events)
    .map((w) => {
      const ageDays = ageInDays(birthTs, w.start_ts);
      const chartDay = ageDays - earlyDays;
      const z = chartDay >= 0 ? zScore(sex, chartDay, w.amount) : null;
      return { ...w, ageDays, chartDay, z, pct: z == null ? null : percentile(z) };
    })
    .filter((w) => w.ageDays >= 0);
}

/** First day at or after `fromDay` where her curve reaches `grams`, or null within the table. */
export function dayCurveReaches(sex, z, grams, fromDay) {
  for (let d = Math.max(0, fromDay); d <= MAX_AGE_DAYS; d++) {
    const w = weightAtZ(sex, d, z);
    if (w != null && w >= grams) return d;
  }
  return null;
}

/**
 * Trend between the first and latest weigh-in, in the words a health nurse
 * uses: staying on a curve is the norm; crossing two of the printed lines in
 * either direction is what gets mentioned at the next check.
 */
export function trendOf(first, latest) {
  if (!first || !latest || first.id === latest.id || first.z == null || latest.z == null) return null;
  const crossed = linesCrossed(first.z, latest.z);
  const dz = latest.z - first.z;
  const direction = Math.abs(dz) < 0.25 ? 'same' : dz > 0 ? 'up' : 'down';
  return { crossed, direction, fromPct: first.pct, toPct: latest.pct, flag: crossed >= 2 };
}

/**
 * Everything the Growth card shows, in one pass.
 * `birthTs` is any timestamp on the birth day; `sex` is 'girl' | 'boy'.
 */
export function growthSummary(events, { birthTs, sex, dueTs = null, correct = false }, now = Date.now()) {
  const early = prematurity(birthTs, dueTs);
  const earlyDays = correct ? early.earlyDays : 0;
  const list = placedWeighIns(events, birthTs, sex, earlyDays);
  const ageToday = ageInDays(birthTs, now);
  const chartToday = ageToday - earlyDays;
  const empty = {
    list, latest: null, first: null, placedFirst: null, birthWeight: null, sinceBirth: null, gainPerDay: null,
    z: null, pct: null, pctLabel: null, trend: null, today: null, milestones: null, rhythm: null,
    ageToday, chartToday, earlyDays, early, corrected: earlyDays > 0,
  };
  if (!list.length) return empty;

  const first = list[0];
  const placedFirst = list.find((w) => w.z != null) || null;
  const latest = list[list.length - 1];
  const previous = list.length > 1 ? list[list.length - 2] : null;
  const birthWeight = first.ageDays <= BIRTH_WINDOW_DAYS ? first : null;

  const z = latest.z;
  const pct = latest.pct;

  const sinceBirth = birthWeight ? latest.amount - birthWeight.amount : null;
  const gainPerDay = previous && latest.ageDays > previous.ageDays
    ? (latest.amount - previous.amount) / (latest.ageDays - previous.ageDays)
    : null;

  const today = z == null || chartToday < 0 ? null : {
    ageDays: ageToday,
    chartDay: chartToday,
    onCurve: weightAtZ(sex, chartToday, z),
    median: weightAtZ(sex, chartToday, 0),
    weighedToday: latest.ageDays === ageToday ? latest.amount : null,
  };

  // Milestones. "Regained" needs a dip below birth weight and a later climb
  // back; "doubled" is either a date already reached or a projection along
  // her own curve.
  let milestones = null;
  if (birthWeight) {
    const target = birthWeight.amount * 2;
    const dipped = list.find((w) => w.amount < birthWeight.amount);
    const regained = dipped ? list.find((w) => w.start_ts > dipped.start_ts && w.amount >= birthWeight.amount) : null;
    const doubled = list.find((w) => w.amount >= target);
    let doubledProjected = null;
    if (!doubled && z != null) {
      const day = dayCurveReaches(sex, z, target, Math.max(0, chartToday));
      if (day != null) doubledProjected = { ts: addDays(localNoon(birthTs), day + earlyDays), ageDays: day + earlyDays };
    }
    milestones = {
      target,
      regained: regained ? { ts: regained.start_ts, ageDays: regained.ageDays } : null,
      dipped: Boolean(dipped),
      doubled: doubled ? { ts: doubled.start_ts, ageDays: doubled.ageDays } : null,
      doubledProjected,
    };
  }

  const daysSince = ageToday - latest.ageDays;
  const limit = ageToday < EARLY_UNTIL_DAYS ? DUE_AFTER_DAYS.early : DUE_AFTER_DAYS.later;
  const rhythm = { daysSince, due: daysSince >= limit, limit };

  return {
    list, latest, first, placedFirst, birthWeight, sinceBirth, gainPerDay,
    z, pct, pctLabel: pct == null ? null : ordinal(pct),
    trend: trendOf(placedFirst, latest), today, milestones, rhythm,
    ageToday, chartToday, earlyDays, early, corrected: earlyDays > 0,
  };
}

/**
 * The reference bands for the chart, sampled every `step` days from
 * `fromDay` to `toDay`: outer = 3rd–97th (±2 SD), inner = 15th–85th (±1 SD),
 * plus the median.
 */
export function bandSeries(sex, fromDay, toDay, step = 1) {
  const out = [];
  const start = Math.max(0, Math.floor(fromDay));
  const end = Math.min(MAX_AGE_DAYS, Math.ceil(toDay));
  for (let d = start; d <= end; d += step) {
    out.push({
      day: d,
      lo2: weightAtZ(sex, d, -BAND_Z.outer),
      lo1: weightAtZ(sex, d, -BAND_Z.inner),
      med: weightAtZ(sex, d, 0),
      hi1: weightAtZ(sex, d, BAND_Z.inner),
      hi2: weightAtZ(sex, d, BAND_Z.outer),
    });
  }
  if (out.length && out[out.length - 1].day !== end) {
    out.push({ day: end, lo2: weightAtZ(sex, end, -2), lo1: weightAtZ(sex, end, -1), med: weightAtZ(sex, end, 0), hi1: weightAtZ(sex, end, 1), hi2: weightAtZ(sex, end, 2) });
  }
  return out;
}

/** Her own curve — the latest z-score carried forward — sampled like the bands. */
export function curveSeries(sex, z, fromDay, toDay, step = 1) {
  if (z == null) return [];
  const out = [];
  const start = Math.max(0, Math.floor(fromDay));
  const end = Math.min(MAX_AGE_DAYS, Math.ceil(toDay));
  for (let d = start; d <= end; d += step) out.push({ day: d, grams: weightAtZ(sex, d, z) });
  if (out.length && out[out.length - 1].day !== end) out.push({ day: end, grams: weightAtZ(sex, end, z) });
  return out;
}

export { DAY };
