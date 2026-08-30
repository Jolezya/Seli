// Analytics. Every number here answers "what rhythm is the baby settling into?"
//
// Governing rule: NEVER fabricate a signal from insufficient data. A brand-new
// user must not see a trend computed against an empty prior window, and a
// next-feed prediction is only offered when the spacing is actually consistent
// (spec §8). Where the data can't support a claim, these functions return null
// and the UI says so plainly.

import { DAY, HOUR, MINUTE, dayKey, lastNDays, localHour, startOfLocalDay, addDays } from './time.js';
import { FEED_TYPES, durationOf, eventsOnDay } from './events.js';

/** Metrics the comparison chart can plot. */
export const METRICS = [
  { key: 'feeds', label: 'Feeds', unit: '', kind: 'count', types: FEED_TYPES },
  { key: 'bottle_ml', label: 'Bottle ml', unit: 'ml', kind: 'sum', types: ['bottle'] },
  { key: 'nap', label: 'Nap time', unit: 'm', kind: 'minutes', types: ['nap'] },
  { key: 'night', label: 'Night sleep', unit: 'm', kind: 'minutes', types: ['night'] },
  { key: 'tummy', label: 'Tummy', unit: 'm', kind: 'minutes', types: ['tummy'] },
  { key: 'wet', label: 'Wet', unit: '', kind: 'count', types: ['wet'] },
  { key: 'poop', label: 'Poop', unit: '', kind: 'count', types: ['poop'] },
];

export function metricByKey(key) {
  return METRICS.find((m) => m.key === key) || METRICS[0];
}

/** Value of one metric for one local day. */
export function metricValueOnDay(events, metric, dayTs, now = Date.now()) {
  const dayEvents = eventsOnDay(events, dayTs).filter((e) => metric.types.includes(e.type));
  if (metric.kind === 'count') return dayEvents.length;
  if (metric.kind === 'sum') {
    return dayEvents.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }
  // minutes
  return Math.round(dayEvents.reduce((sum, e) => sum + durationOf(e, now), 0) / MINUTE);
}

/** A metric bucketed across the last `days` local days, oldest first. */
export function metricSeries(events, metric, days, now = Date.now()) {
  return lastNDays(days, now).map((dayTs) => ({
    dayTs,
    key: dayKey(dayTs),
    value: metricValueOnDay(events, metric, dayTs, now),
  }));
}

/** Mean of an array, or 0 when empty. */
export function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Standard deviation (population). */
export function stdDev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/** Coefficient of variation — spread relative to size. Lower = steadier. */
export function coefficientOfVariation(values) {
  const m = mean(values);
  if (!m) return null;
  return stdDev(values) / m;
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The exclusive upper bound for every analytics window: the end of the current
 * local day, NOT `now`.
 *
 * `now` is a React state snapshot that only ticks every 20s, so bounding at it
 * would silently drop an event the parent logged seconds ago — the tile would
 * show the feed while Patterns pretended it never happened.
 */
export function windowEnd(now = Date.now()) {
  return startOfLocalDay(now) + DAY;
}

/** Events of the given types inside a window, oldest first. */
export function inWindow(events, types, fromTs, toTs) {
  return events
    .filter((e) => types.includes(e.type) && e.start_ts >= fromTs && e.start_ts < toTs)
    .sort((a, b) => a.start_ts - b.start_ts);
}

/** Gaps in ms between consecutive events. */
export function gapsBetween(sortedEvents) {
  const gaps = [];
  for (let i = 1; i < sortedEvents.length; i++) {
    gaps.push(sortedEvents[i].start_ts - sortedEvents[i - 1].start_ts);
  }
  return gaps;
}

/** Threshold below which feed spacing counts as consistent enough to predict from. */
export const RHYTHM_CV_THRESHOLD = 0.33;

/**
 * The feed-rhythm banner: typical gap between feeds this week, whether spacing
 * got steadier than last week, and — only when the spacing is genuinely
 * consistent — the likely time of the next feed.
 */
export function feedRhythm(events, now = Date.now()) {
  const weekStart = now - 7 * DAY;
  const priorStart = now - 14 * DAY;

  const recent = inWindow(events, FEED_TYPES, weekStart, windowEnd(now));
  const prior = inWindow(events, FEED_TYPES, priorStart, weekStart);

  const recentGaps = gapsBetween(recent);
  if (recentGaps.length < 3) {
    return {
      hasData: false,
      typicalGapMs: null,
      cv: null,
      steadiness: null,
      prediction: null,
      message: 'Not enough feeds logged yet to read a rhythm.',
    };
  }

  const typicalGapMs = median(recentGaps);
  const cv = coefficientOfVariation(recentGaps);

  // Week-over-week steadiness, only when the prior week has a real basis.
  const priorGaps = gapsBetween(prior);
  const priorCv = priorGaps.length >= 3 ? coefficientOfVariation(priorGaps) : null;
  let steadiness = null;
  if (priorCv != null && cv != null) {
    const delta = cv - priorCv;
    if (Math.abs(delta) < 0.05) steadiness = 'same';
    else steadiness = delta < 0 ? 'steadier' : 'more varied';
  }

  const lastFeed = recent[recent.length - 1];
  let prediction = null;
  if (cv != null && cv <= RHYTHM_CV_THRESHOLD && lastFeed) {
    prediction = lastFeed.start_ts + typicalGapMs;
  }

  return {
    hasData: true,
    typicalGapMs,
    cv,
    steadiness,
    prediction,
    lastFeedTs: lastFeed ? lastFeed.start_ts : null,
    message: prediction
      ? null
      : 'Rhythm still settling — no reliable next-feed time yet.',
  };
}

/** "2h55" from a gap in ms. */
export function formatGap(ms) {
  if (!ms || ms < 0) return '—';
  const totalMin = Math.round(ms / MINUTE);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

/** Heatmap rows: how often each activity happens in each hour of the day. */
export const PATTERN_ROWS = [
  { key: 'feeds', label: 'Feeds', types: FEED_TYPES },
  { key: 'sleep', label: 'Sleep', types: ['nap', 'night'] },
  { key: 'wet', label: 'Wet', types: ['wet'] },
  { key: 'poop', label: 'Poop', types: ['poop'] },
];

/** 24-slot histogram of local hours for the given types within the window. */
export function hourlyHistogram(events, types, days, now = Date.now()) {
  const from = startOfLocalDay(addDays(now, -(days - 1)));
  const counts = new Array(24).fill(0);
  for (const e of events) {
    if (!types.includes(e.type)) continue;
    if (e.start_ts < from || e.start_ts >= windowEnd(now)) continue;
    counts[localHour(e.start_ts)] += 1;
  }
  return counts;
}

/**
 * Per-metric summary line: per-day rate, peak hour, and a trend vs the prior
 * window — where the trend is SUPPRESSED unless the prior window genuinely has
 * data. A new user with nothing before today must never see "↑7.8 vs prior".
 */
export function patternSummary(events, types, days, now = Date.now()) {
  const windowMs = days * DAY;
  const from = startOfLocalDay(addDays(now, -(days - 1)));
  const priorFrom = from - windowMs;

  const current = inWindow(events, types, from, windowEnd(now));
  const prior = inWindow(events, types, priorFrom, from);

  const perDay = current.length / days;
  const hist = hourlyHistogram(events, types, days, now);
  const peakCount = Math.max(...hist);
  const peakHour = peakCount > 0 ? hist.indexOf(peakCount) : null;

  // The prior window must have real substance: at least 3 events, spanning at
  // least half the window. Anything less and the comparison is noise.
  let trend = null;
  if (prior.length >= 3) {
    const span = prior[prior.length - 1].start_ts - prior[0].start_ts;
    if (span >= windowMs / 2) {
      const priorPerDay = prior.length / days;
      trend = {
        priorPerDay,
        delta: perDay - priorPerDay,
        direction: perDay > priorPerDay ? 'up' : perDay < priorPerDay ? 'down' : 'flat',
      };
    }
  }

  return { count: current.length, perDay, peakHour, trend };
}

/**
 * Tile prediction: the likely time of the next event of a type, from the mean
 * gap between recent ones. Returns null unless there are enough recent events
 * AND their spacing is consistent enough to mean anything.
 */
export function predictNext(events, types, now = Date.now(), { minEvents = 4, maxCv = 0.45 } = {}) {
  const recent = inWindow(events, types, now - 7 * DAY, windowEnd(now));
  if (recent.length < minEvents) return null;
  const gaps = gapsBetween(recent);
  if (gaps.length < minEvents - 1) return null;
  const cv = coefficientOfVariation(gaps);
  if (cv == null || cv > maxCv) return null;
  const typical = median(gaps);
  if (!typical || typical < 5 * MINUTE || typical > 2 * DAY) return null;
  return recent[recent.length - 1].start_ts + typical;
}

/** A gentle watch note when diaper counts look low for the last full day. */
export function diaperWatch(events, now = Date.now()) {
  const yesterday = addDays(startOfLocalDay(now), -1);
  const wet = eventsOnDay(events, yesterday).filter((e) => e.type === 'wet').length;
  const anyYesterday = eventsOnDay(events, yesterday).length;
  if (!anyYesterday) return null; // nothing logged — silence, not alarm
  if (wet >= 5) return null;
  return `Only ${wet} wet ${wet === 1 ? 'nappy' : 'nappies'} logged yesterday — worth keeping an eye on.`;
}

export { DAY, HOUR, MINUTE };
