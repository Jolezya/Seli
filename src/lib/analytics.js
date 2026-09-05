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
  // "diapers", to match the tile labels — the app must not switch dialect
  // between its buttons and its advice.
  return `Only ${wet} wet ${wet === 1 ? 'diaper' : 'diapers'} logged yesterday — worth keeping an eye on.`;
}

export { DAY, HOUR, MINUTE };


// ---------------------------------------------------------------------------
// Overview: "what happened in the last day, and is that normal?"
//
// Everything below works on a rolling window ending now, not on "today". At
// 3am "today" holds three hours of data and answers nothing; the last 24 hours
// is a full picture at any hour, and it compares fairly against whole-day
// averages because both are 24 hours long.
// ---------------------------------------------------------------------------

/** Milliseconds of a timed event that fall inside [from, to). Open sessions run to `now`. */
export function overlapMs(event, from, to, now = Date.now()) {
  const start = event.start_ts;
  const end = event.end_ts ?? now;
  return Math.max(0, Math.min(end, to) - Math.max(start, from));
}

const SLEEP_TYPES = ['nap', 'night'];

/** Totals for an arbitrary window [from, to). */
export function windowTotals(events, from, to, now = Date.now()) {
  const t = { feeds: 0, nurse: 0, bottle: 0, bottleMl: 0, sleepMin: 0, nightMin: 0, napMin: 0, wet: 0, poop: 0, tummyMin: 0, any: false };
  for (const e of events) {
    const inside = e.start_ts >= from && e.start_ts < to;
    if (inside) {
      t.any = true;
      if (e.type === 'nurse') { t.feeds += 1; t.nurse += 1; }
      else if (e.type === 'bottle') { t.feeds += 1; t.bottle += 1; t.bottleMl += Number(e.amount) || 0; }
      else if (e.type === 'wet') t.wet += 1;
      else if (e.type === 'poop') t.poop += 1;
    }
    // Timed events are clipped to the window rather than assigned by start,
    // so a night sleep from 22:00 to 06:00 lands in both days it touches.
    if (SLEEP_TYPES.includes(e.type) || e.type === 'tummy') {
      const ms = overlapMs(e, from, to, now);
      if (ms > 0) {
        t.any = true;
        const min = ms / MINUTE;
        if (e.type === 'night') { t.nightMin += min; t.sleepMin += min; }
        else if (e.type === 'nap') { t.napMin += min; t.sleepMin += min; }
        else t.tummyMin += min;
      }
    }
  }
  return t;
}

/** Local day-start of the earliest event, or null when nothing is logged. */
export function firstTrackedDay(events) {
  let min = Infinity;
  for (const e of events) if (e.start_ts < min) min = e.start_ts;
  return Number.isFinite(min) ? startOfLocalDay(min) : null;
}

/**
 * One row per local day, oldest first, ending today. `tracked` marks days on
 * or after the first logged event — days before that are not "zero feeds",
 * they are "not yet using the app", and must not drag averages down.
 */
export function dailyTotals(events, days, now = Date.now()) {
  const first = firstTrackedDay(events);
  return lastNDays(days, now).map((dayTs) => {
    const end = addDays(dayTs, 1);
    return {
      dayTs,
      key: dayKey(dayTs),
      tracked: first != null && dayTs >= first,
      isToday: dayKey(dayTs) === dayKey(now),
      ...windowTotals(events, dayTs, end, now),
    };
  });
}

/** How many full tracked days a baseline needs before it is worth showing. */
export const BASELINE_MIN_DAYS = 3;

/**
 * "Usually": per-day averages over full tracked days, today excluded because it
 * is partial. Returns null until there are enough days to mean anything.
 */
export function baseline(rows) {
  const full = rows.filter((r) => r.tracked && !r.isToday);
  if (full.length < BASELINE_MIN_DAYS) return { days: full.length, ready: false };
  const avg = (key) => full.reduce((s, r) => s + r[key], 0) / full.length;
  return {
    days: full.length,
    ready: true,
    feeds: avg('feeds'),
    bottleMl: avg('bottleMl'),
    sleepMin: avg('sleepMin'),
    wet: avg('wet'),
    poop: avg('poop'),
    tummyMin: avg('tummyMin'),
  };
}

/** Everything drawn on the 24-hour strip, clipped to [from, to). */
export function timelineData(events, from, to, now = Date.now()) {
  const sleeps = [];
  const feeds = [];
  const diapers = [];
  for (const e of events) {
    if (SLEEP_TYPES.includes(e.type)) {
      const start = Math.max(e.start_ts, from);
      const end = Math.min(e.end_ts ?? now, to);
      if (end > start) sleeps.push({ id: e.id, start, end, type: e.type, open: e.end_ts == null });
    } else if (e.start_ts >= from && e.start_ts < to) {
      if (FEED_TYPES.includes(e.type)) feeds.push({ id: e.id, ts: e.start_ts, type: e.type, amount: e.amount });
      else if (e.type === 'wet' || e.type === 'poop') diapers.push({ id: e.id, ts: e.start_ts, type: e.type });
    }
  }
  sleeps.sort((a, b) => a.start - b.start);
  feeds.sort((a, b) => a.ts - b.ts);
  diapers.sort((a, b) => a.ts - b.ts);
  return { sleeps, feeds, diapers };
}

/** The longest single sleep inside a window, clipped to it. */
export function longestSleep(events, from, to, now = Date.now()) {
  let best = null;
  for (const s of timelineData(events, from, to, now).sleeps) {
    const ms = s.end - s.start;
    if (!best || ms > best.ms) best = { start: s.start, end: s.end, ms, open: s.open };
  }
  return best;
}

/** Typical gap between feeds inside a window: median, needs at least 3 feeds. */
export function feedGapInWindow(events, from, to) {
  const feeds = inWindow(events, FEED_TYPES, from, to);
  const gaps = gapsBetween(feeds);
  if (gaps.length < 2) return null;
  return median(gaps);
}

/**
 * This week against last, per metric — only when last week is genuinely
 * populated. Same suppression rule as the pattern summaries: no trend is
 * ever invented from an empty prior window.
 */
export function weekOverWeek(events, now = Date.now()) {
  // 15 rows: seven full days before today, the seven before those, and today
  // itself — which is partial and therefore excluded from both.
  const rows = dailyTotals(events, 15, now);
  const prior = rows.slice(0, 7).filter((r) => r.tracked);
  const recent = rows.slice(7, 14).filter((r) => r.tracked);
  if (prior.length < 4 || recent.length < 3) return null;
  const avg = (list, key) => list.reduce((s, r) => s + r[key], 0) / list.length;
  const metric = (key) => ({ now: avg(recent, key), before: avg(prior, key), delta: avg(recent, key) - avg(prior, key) });
  return {
    priorDays: prior.length,
    recentDays: recent.length,
    feeds: metric('feeds'),
    sleepMin: metric('sleepMin'),
    wet: metric('wet'),
    poop: metric('poop'),
  };
}


// ---------------------------------------------------------------------------
// Periods: a chosen day, or the rolling last 24 hours.
// ---------------------------------------------------------------------------

/**
 * Resolve a period choice to a window.
 *   '24h'       → the rolling last 24 hours, ending now
 *   'today'     → local midnight → now (partial)
 *   'yesterday' → yesterday, midnight to midnight
 *   'date'      → the given local day, midnight to midnight (partial if today)
 */
export function periodRange(kind, now = Date.now(), dateTs = null) {
  if (kind === '24h') return { from: now - DAY, to: now, partial: true, rolling: true };
  let day0;
  if (kind === 'today') day0 = startOfLocalDay(now);
  else if (kind === 'yesterday') day0 = addDays(startOfLocalDay(now), -1);
  else day0 = startOfLocalDay(dateTs ?? now);
  const end = addDays(day0, 1);
  const partial = now < end;
  return { from: day0, to: partial ? Math.max(now, day0) : end, dayEnd: end, partial, rolling: false };
}

/**
 * "Usually, by this time of day": the average over full tracked days of what
 * had happened in the first `elapsedMs` of each. Comparing a half-finished
 * day against whole-day averages would make every morning look alarming.
 */
export function usualByElapsed(events, elapsedMs, now = Date.now()) {
  const rows = dailyTotals(events, 30, now).filter((r) => r.tracked && !r.isToday);
  if (rows.length < BASELINE_MIN_DAYS) return { days: rows.length, ready: false };
  const slices = rows.map((r) => windowTotals(events, r.dayTs, r.dayTs + elapsedMs, now));
  const avg = (key) => slices.reduce((sum, t) => sum + t[key], 0) / slices.length;
  return {
    days: rows.length, ready: true, byTime: true,
    feeds: avg('feeds'), bottleMl: avg('bottleMl'), sleepMin: avg('sleepMin'),
    wet: avg('wet'), poop: avg('poop'), tummyMin: avg('tummyMin'),
  };
}
