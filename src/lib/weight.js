// Weight tracking maths.
//
// A weigh-in is an event of type 'weight': `amount` in GRAMS, `start_ts` stamped
// at LOCAL NOON of its date so it can never slide across a day boundary. There
// is at most one weigh-in per day — a correction updates that day's row in place
// rather than adding a duplicate (spec §7).

import { DAY, daysBetween, localNoon, dayKey, addDays, startOfLocalDay } from './time.js';

export const DEFAULT_GAIN = 20;   // g/day
export const MIN_GAIN = 5;
export const MAX_GAIN = 60;

export function clampGain(gain) {
  const n = Math.round(Number(gain));
  if (!Number.isFinite(n)) return DEFAULT_GAIN;
  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, n));
}

/** Weigh-ins oldest first, one per day, with invalid rows dropped. */
export function weighIns(events) {
  return events
    // Number(null) is 0, so an explicit null check is required or a weight row
    // with no amount would be read as a 0 g weigh-in.
    .filter((e) => e.type === 'weight' && e.amount != null && e.amount !== '' && Number.isFinite(Number(e.amount)))
    .map((e) => ({ ...e, amount: Number(e.amount) }))
    .sort((a, b) => a.start_ts - b.start_ts);
}

/** The existing weigh-in for a given date, if any — the row an edit updates. */
export function weighInOnDay(events, ts) {
  const key = dayKey(ts);
  return weighIns(events).find((e) => dayKey(e.start_ts) === key) || null;
}

/** Filter to a range chip: 1m / 3m / 6m / all. */
export const RANGES = [
  { key: '1m', label: '1m', days: 30 },
  { key: '3m', label: '3m', days: 90 },
  { key: '6m', label: '6m', days: 180 },
  { key: 'all', label: 'All', days: null },
];

export function inRange(list, rangeKey, now = Date.now()) {
  const range = RANGES.find((r) => r.key === rangeKey);
  if (!range || range.days == null) return list;
  const from = startOfLocalDay(now) - (range.days - 1) * DAY;
  return list.filter((w) => w.start_ts >= from);
}

/** The lowest weigh-in — newborns dip before they climb, so growth is measured from the nadir. */
export function nadir(list) {
  if (!list.length) return null;
  return list.reduce((low, w) => (w.amount < low.amount ? w : low), list[0]);
}

/** Expected weight at `ts` on the straight line from the nadir at `gain` g/day. */
export function expectedAt(nadirPoint, gain, ts) {
  if (!nadirPoint) return null;
  const days = (localNoon(ts) - localNoon(nadirPoint.start_ts)) / DAY;
  return Math.round(nadirPoint.amount + days * gain);
}

/**
 * Observed gain from recent weigh-ins: least-squares slope in g/day over the
 * last `window` points. Needs at least two points spanning at least a day —
 * otherwise the slope is meaningless and this returns null.
 */
export function observedGain(list, window = 5) {
  const points = list.slice(-window);
  if (points.length < 2) return null;
  const spanDays = (points[points.length - 1].start_ts - points[0].start_ts) / DAY;
  if (spanDays < 1) return null;

  const xs = points.map((p) => (p.start_ts - points[0].start_ts) / DAY);
  const ys = points.map((p) => p.amount);
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const yMean = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  if (!den) return null;
  return num / den;
}

/**
 * Everything the weight card needs, in one pass.
 * `gain` is the user's expected g/day; `intervalDays` is how often they weigh in.
 */
export function weightSummary(events, gain = DEFAULT_GAIN, now = Date.now()) {
  const list = weighIns(events);
  if (!list.length) {
    return { list, latest: null, previous: null, change: null, nadirPoint: null, observed: null, projection: null, expected: null };
  }

  const latest = list[list.length - 1];
  const previous = list.length > 1 ? list[list.length - 2] : null;
  const change = previous ? latest.amount - previous.amount : null;
  const nadirPoint = nadir(list);
  const observed = observedGain(list);

  // Next weigh-in projected at the cadence the parents actually keep.
  let projection = null;
  if (observed != null && previous) {
    const gapDays = Math.max(1, Math.round(daysBetween(previous.start_ts, latest.start_ts)) || 1);
    const nextTs = addDays(latest.start_ts, gapDays);
    projection = {
      perDay: observed,
      nextTs,
      nextWeight: Math.round(latest.amount + observed * gapDays),
    };
  }

  // Where the chosen trajectory says she should be by the latest weigh-in.
  const expectedNow = expectedAt(nadirPoint, gain, latest.start_ts);
  const expected = expectedNow == null ? null : {
    at: latest.start_ts,
    weight: expectedNow,
    diff: latest.amount - expectedNow,
    today: expectedAt(nadirPoint, gain, now),
    weighedToday: dayKey(latest.start_ts) === dayKey(now) ? latest.amount : null,
  };

  return { list, latest, previous, change, nadirPoint, observed, projection, expected };
}

/** Points for the dashed expected line: from the nadir to the end of the chart. */
export function expectedLine(nadirPoint, gain, fromTs, toTs) {
  if (!nadirPoint) return [];
  const start = Math.max(fromTs, nadirPoint.start_ts);
  return [
    { ts: start, amount: expectedAt(nadirPoint, gain, start) },
    { ts: toTs, amount: expectedAt(nadirPoint, gain, toTs) },
  ];
}

/** "4,564 g" */
export function formatGrams(g) {
  if (g == null || !Number.isFinite(Number(g))) return '—';
  return `${Math.round(Number(g)).toLocaleString()} g`;
}
