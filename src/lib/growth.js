// Growth: where a baby sits on the WHO charts — weight, length and head for
// age — and how that has moved. Everything is derived from the measurements
// plus the facts the parents set once — birth date, sex, due date — so there
// is no state to go stale.

import { DAY, daysBetween, addDays, localNoon, fromDateInput, shortDate } from './time.js';
import {
  zScore, weightAtZ, zOf, valueAt, percentile, ordinal, linesCrossed, MAX_AGE_DAYS, BAND_Z,
} from './who.js';

/**
 * The three measurements and how each is stored. `amount` is an integer
 * column, so weight is kept in grams and length and head in millimetres;
 * `toTable` / `fromTable` convert to the WHO tables' kg and cm.
 */
export const MEASURES = {
  weight: {
    key: 'weight', type: 'weight', indicator: 'wfa', label: 'Weight',
    toTable: (g) => g / 1000, fromTable: (kg) => Math.round(kg * 1000), scale: 1000,
    minSpan: 200, min: 500, max: 20000,
  },
  length: {
    key: 'length', type: 'length', indicator: 'lhfa', label: 'Length',
    toTable: (mm) => mm / 10, fromTable: (cm) => Math.round(cm * 10), scale: 10,
    minSpan: 20, min: 350, max: 1000,
  },
  head: {
    key: 'head', type: 'head', indicator: 'hcfa', label: 'Head',
    toTable: (mm) => mm / 10, fromTable: (cm) => Math.round(cm * 10), scale: 10,
    minSpan: 10, min: 250, max: 550,
  },
};
export const MEASURE_KEYS = Object.keys(MEASURES);

/** "5,570 g" / "61.2 cm" */
export function formatMeasure(key, amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return '—';
  if (key === 'weight') return `${Math.round(Number(amount)).toLocaleString()} g`;
  return `${(Number(amount) / 10).toFixed(1)} cm`;
}

/** The number alone, for chart labels: "5,570" / "61.2". */
export function formatMeasureShort(key, amount) {
  if (key === 'weight') return Math.round(amount).toLocaleString();
  return (amount / 10).toFixed(1);
}

/** "+410 g" / "−0.5 cm" */
export function formatChange(key, delta) {
  const sign = delta >= 0 ? '+' : '−';
  if (key === 'weight') return `${sign}${Math.abs(Math.round(delta)).toLocaleString()} g`;
  return `${sign}${(Math.abs(delta) / 10).toFixed(1)} cm`;
}

/**
 * Parse what was typed into a stored amount, or null. Weight in grams;
 * length and head in centimetres, with a comma or a point — a Norwegian
 * keyboard offers only the comma.
 */
export function parseMeasure(key, input) {
  const m = MEASURES[key];
  if (!m || input == null || String(input).trim() === '') return null;
  const n = Number(String(input).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const amount = key === 'weight' ? Math.round(n) : Math.round(n * 10);
  return amount >= m.min && amount <= m.max ? amount : null;
}

/** Measurements of one type, oldest first, malformed rows dropped. */
export function measurements(events, type) {
  return events
    // Number(null) is 0, so an explicit null check is required or a row with
    // no amount would read as a measurement of zero.
    .filter((e) => e.type === type && e.amount != null && e.amount !== '' && Number.isFinite(Number(e.amount)))
    .map((e) => ({ ...e, amount: Number(e.amount) }))
    .sort((a, b) => a.start_ts - b.start_ts);
}

function zFor(m, sex, day, amount) {
  return zOf(m.indicator, sex, day, m.toTable(amount));
}

function amountAtZ(m, sex, day, z) {
  const v = valueAt(m.indicator, sex, day, z);
  return v == null ? null : m.fromTable(v);
}

/**
 * The same, unrounded, for drawing: whole millimetres are visible steps on a
 * length or head chart, which would turn a smooth curve into a staircase.
 */
function exactAtZ(m, sex, day, z) {
  const v = valueAt(m.indicator, sex, day, z);
  return v == null ? null : v * m.scale;
}

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
export function placedMeasurements(events, key, birthTs, sex, earlyDays = 0) {
  const m = MEASURES[key];
  return measurements(events, m.type)
    .map((w) => {
      const ageDays = ageInDays(birthTs, w.start_ts);
      const chartDay = ageDays - earlyDays;
      const z = chartDay >= 0 ? zFor(m, sex, chartDay, w.amount) : null;
      return { ...w, ageDays, chartDay, z, pct: z == null ? null : percentile(z) };
    })
    .filter((w) => w.ageDays >= 0);
}

export function placedWeighIns(events, birthTs, sex, earlyDays = 0) {
  return placedMeasurements(events, 'weight', birthTs, sex, earlyDays);
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
 * What one tab of the Growth card shows, for any of the three measurements.
 * `birthTs` is any timestamp on the birth day; `sex` is 'girl' | 'boy'.
 */
export function measureSummary(events, key, { birthTs, sex, dueTs = null, correct = false }, now = Date.now()) {
  const m = MEASURES[key];
  const early = prematurity(birthTs, dueTs);
  const earlyDays = correct ? early.earlyDays : 0;
  const list = placedMeasurements(events, key, birthTs, sex, earlyDays);
  const ageToday = ageInDays(birthTs, now);
  const chartToday = ageToday - earlyDays;
  const base = { key, measure: m, ageToday, chartToday, earlyDays, early, corrected: earlyDays > 0 };
  if (!list.length) {
    return {
      ...base, list, latest: null, first: null, placedFirst: null, previous: null, change: null,
      atBirth: null, sinceBirth: null, z: null, pct: null, pctLabel: null, trend: null, today: null,
    };
  }

  const first = list[0];
  const placedFirst = list.find((w) => w.z != null) || null;
  const latest = list[list.length - 1];
  const previous = list.length > 1 ? list[list.length - 2] : null;
  const atBirth = first.ageDays <= BIRTH_WINDOW_DAYS ? first : null;
  const z = latest.z;
  const pct = latest.pct;
  const measuredToday = latest.ageDays === ageToday ? latest.amount : null;

  const today = z == null || chartToday < 0 ? null : {
    ageDays: ageToday,
    chartDay: chartToday,
    onCurve: amountAtZ(m, sex, chartToday, z),
    median: amountAtZ(m, sex, chartToday, 0),
    measuredToday,
    weighedToday: measuredToday,
  };

  return {
    ...base, list, latest, first, placedFirst, previous,
    change: previous ? latest.amount - previous.amount : null,
    atBirth, sinceBirth: atBirth ? latest.amount - atBirth.amount : null,
    z, pct, pctLabel: pct == null ? null : ordinal(pct),
    trend: trendOf(placedFirst, latest), today,
  };
}

/**
 * Everything the Weight tab and tile show: the general summary plus the
 * weight-only parts — birth weight, gain per day, the milestones parents
 * remember, and the weigh-in rhythm.
 */
export function growthSummary(events, settings, now = Date.now()) {
  const g = measureSummary(events, 'weight', settings, now);
  const { birthTs, sex } = settings;
  if (!g.latest) return { ...g, birthWeight: null, gainPerDay: null, milestones: null, rhythm: null };

  const { list, latest, previous, z, chartToday, earlyDays, ageToday } = g;
  const birthWeight = g.atBirth;
  const gainPerDay = previous && latest.ageDays > previous.ageDays
    ? (latest.amount - previous.amount) / (latest.ageDays - previous.ageDays)
    : null;

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

  return { ...g, birthWeight, gainPerDay, milestones, rhythm };
}

/** Weigh-ins this far from a length still pair with it for weight-for-length. */
const WFL_PAIR_DAYS = 7;

/**
 * Weight for length: is she in proportion? The latest length paired with the
 * weigh-in closest to it in time, read off the WHO weight-for-length table.
 * Indexed by length, not age, so corrected age plays no part. Within the
 * 3rd–97th it reads "in proportion"; outside, light or heavy for her length.
 */
export function weightForLength(events, sex) {
  const lengths = measurements(events, 'length');
  if (!lengths.length) return null;
  const length = lengths[lengths.length - 1];
  let best = null;
  for (const w of measurements(events, 'weight')) {
    const gap = Math.abs(daysBetween(w.start_ts, length.start_ts));
    if (gap <= WFL_PAIR_DAYS && (!best || gap < best.gap)) best = { w, gap };
  }
  if (!best) return null;
  const cm = length.amount / 10;
  if (cm < 45 || cm > 110) return null;
  const z = zOf('wfl', sex, cm, best.w.amount / 1000);
  if (z == null) return null;
  const pct = percentile(z);
  return {
    z, pct, pctLabel: ordinal(pct),
    verdict: z < -2 ? 'light' : z > 2 ? 'heavy' : 'proportion',
    length, weight: best.w, gapDays: best.gap,
  };
}

/**
 * The reference bands for the chart, sampled every `step` days from
 * `fromDay` to `toDay`: outer = 3rd–97th (±2 SD), inner = 15th–85th (±1 SD),
 * plus the median. Values in the measure's stored unit (g or mm).
 */
export function bandSeries(sex, fromDay, toDay, step = 1, key = 'weight') {
  const m = MEASURES[key];
  const row = (d) => ({
    day: d,
    lo2: exactAtZ(m, sex, d, -BAND_Z.outer),
    lo1: exactAtZ(m, sex, d, -BAND_Z.inner),
    med: exactAtZ(m, sex, d, 0),
    hi1: exactAtZ(m, sex, d, BAND_Z.inner),
    hi2: exactAtZ(m, sex, d, BAND_Z.outer),
  });
  const out = [];
  const start = Math.max(0, Math.floor(fromDay));
  const end = Math.min(MAX_AGE_DAYS, Math.ceil(toDay));
  for (let d = start; d <= end; d += step) out.push(row(d));
  if (out.length && out[out.length - 1].day !== end) out.push(row(end));
  return out;
}

/** Her own curve — the latest z-score carried forward — sampled like the bands. */
export function curveSeries(sex, z, fromDay, toDay, step = 1, key = 'weight') {
  if (z == null) return [];
  const m = MEASURES[key];
  const out = [];
  const start = Math.max(0, Math.floor(fromDay));
  const end = Math.min(MAX_AGE_DAYS, Math.ceil(toDay));
  for (let d = start; d <= end; d += step) out.push({ day: d, value: exactAtZ(m, sex, d, z) });
  if (out.length && out[out.length - 1].day !== end) out.push({ day: end, value: exactAtZ(m, sex, end, z) });
  return out;
}

export { DAY };

/** The chart settings as the card and the tile both read them from prefs. */
export function growthSettings(prefs = {}, now = Date.now()) {
  const sex = prefs.sex === 'boy' ? 'boy' : 'girl';
  const birthTs = fromDateInput(prefs.birthDate) ?? localNoon(now);
  const dueTs = fromDateInput(prefs.dueDate);
  return { sex, birthTs, dueTs, correct: Boolean(prefs.correctAge) };
}

/**
 * The one-line confirmation after a weigh-in is saved:
 * "5,420 g · 66th percentile · +19 g/day since 31 Aug". Built from the
 * events as they were BEFORE the save plus the new reading, so the caller
 * need not wait for state to settle.
 */
export function weighInLine(events, settings, ts, grams, now = Date.now()) {
  const g = Math.round(Number(grams));
  const day = localNoon(ts);
  const before = placedWeighIns(events, settings.birthTs, settings.sex, settings.correct ? prematurity(settings.birthTs, settings.dueTs).earlyDays : 0)
    .filter((w) => localNoon(w.start_ts) !== day);
  const previous = [...before].reverse().find((w) => w.start_ts < day) || null;
  const earlyDays = settings.correct ? prematurity(settings.birthTs, settings.dueTs).earlyDays : 0;
  const chartDay = ageInDays(settings.birthTs, day) - earlyDays;
  const z = chartDay >= 0 ? zScore(settings.sex, chartDay, g) : null;
  const parts = [`${g.toLocaleString()} g`];
  if (z != null) parts.push(`${ordinal(percentile(z))} percentile${earlyDays ? ' (corrected)' : ''}`);
  if (previous) {
    const days = daysBetween(previous.start_ts, day);
    if (days > 0) {
      const perDay = Math.round((g - previous.amount) / days);
      parts.push(`${perDay >= 0 ? '+' : '−'}${Math.abs(perDay)} g/day since ${shortDate(previous.start_ts)}`);
    }
  }
  return parts.join(' · ');
}

/**
 * The confirmation after a visit is saved: each measurement with its
 * percentile — "5,580 g (66th) · 61.5 cm (58th) · 40.2 cm (70th)".
 */
export function visitLine(settings, ts, amounts) {
  const early = settings.correct ? prematurity(settings.birthTs, settings.dueTs).earlyDays : 0;
  const chartDay = ageInDays(settings.birthTs, localNoon(ts)) - early;
  const parts = [];
  for (const key of MEASURE_KEYS) {
    const amount = amounts[key];
    if (amount == null) continue;
    const z = chartDay >= 0 ? zFor(MEASURES[key], settings.sex, chartDay, amount) : null;
    parts.push(`${formatMeasure(key, amount)}${z == null ? '' : ` (${ordinal(percentile(z))})`}`);
  }
  return parts.join(' · ');
}
