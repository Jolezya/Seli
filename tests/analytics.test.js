import { describe, it, expect } from 'vitest';
import {
  feedRhythm, patternSummary, predictNext, metricSeries, metricByKey,
  coefficientOfVariation, gapsBetween, hourlyHistogram,
} from '../src/lib/analytics.js';
import { FEED_TYPES } from '../src/lib/events.js';
import { HOUR, DAY } from '../src/lib/time.js';

const NOW = new Date(2026, 7, 30, 12, 0).getTime();
let n = 0;
const feed = (ts, type = 'nurse') => ({
  id: `f${n++}`, household: 'h', type, start_ts: ts, end_ts: ts,
  amount: null, side: null, descr: null,
});

/** Feeds every `gapH` hours going back `days` days. */
function regularFeeds(gapH, days, now = NOW) {
  const out = [];
  for (let t = now - days * DAY; t <= now; t += gapH * HOUR) out.push(feed(t));
  return out;
}

describe('feed rhythm', () => {
  it('refuses to predict without enough feeds', () => {
    const r = feedRhythm([feed(NOW - HOUR), feed(NOW)], NOW);
    expect(r.hasData).toBe(false);
    expect(r.prediction).toBe(null);
    expect(r.message).toMatch(/not enough/i);
  });

  it('reads a typical gap and predicts when spacing is consistent', () => {
    const r = feedRhythm(regularFeeds(3, 7), NOW);
    expect(r.hasData).toBe(true);
    expect(Math.round(r.typicalGapMs / HOUR)).toBe(3);
    expect(r.cv).toBeLessThan(0.33);
    expect(r.prediction).toBe(NOW + 3 * HOUR);
  });

  it('refuses to predict when spacing is erratic', () => {
    const chaotic = [0.2, 9, 0.4, 7, 0.3, 11, 0.5, 6].reduce(
      (acc, gap) => { acc.t += gap * HOUR; acc.list.push(feed(acc.t)); return acc; },
      { t: NOW - 5 * DAY, list: [] },
    ).list;
    const r = feedRhythm(chaotic, NOW);
    expect(r.hasData).toBe(true);
    expect(r.cv).toBeGreaterThan(0.33);
    expect(r.prediction).toBe(null);
    expect(r.message).toMatch(/still settling/i);
  });

  it('reports week-over-week steadiness only when the prior week has feeds', () => {
    expect(feedRhythm(regularFeeds(3, 5), NOW).steadiness).toBe(null);
    expect(feedRhythm(regularFeeds(3, 13), NOW).steadiness).not.toBe(null);
  });
});

describe('pattern summaries — no fabricated trends', () => {
  it('shows NO trend for a brand-new user with no prior window', () => {
    // Every feed is inside the current window; the prior window is empty.
    const events = regularFeeds(3, 6);
    const s = patternSummary(events, FEED_TYPES, 7, NOW);
    expect(s.count).toBeGreaterThan(0);
    expect(s.trend).toBe(null); // must not invent "↑7.8 vs prior 7d"
  });

  it('shows no trend when the prior window has only a couple of stray events', () => {
    const events = [...regularFeeds(3, 6), feed(NOW - 9 * DAY), feed(NOW - 9 * DAY + HOUR)];
    expect(patternSummary(events, FEED_TYPES, 7, NOW).trend).toBe(null);
  });

  it('shows a trend once the prior window genuinely has data spanning it', () => {
    const s = patternSummary(regularFeeds(3, 14), FEED_TYPES, 7, NOW);
    expect(s.trend).not.toBe(null);
    expect(s.trend.priorPerDay).toBeGreaterThan(0);
  });

  it('finds the peak hour, and none when there is no data', () => {
    const events = [feed(new Date(2026, 7, 29, 3, 0).getTime()), feed(new Date(2026, 7, 30, 3, 30).getTime())];
    expect(patternSummary(events, FEED_TYPES, 7, NOW).peakHour).toBe(3);
    expect(patternSummary([], FEED_TYPES, 7, NOW).peakHour).toBe(null);
  });

  it('buckets the hourly histogram by local hour', () => {
    const hist = hourlyHistogram([feed(new Date(2026, 7, 30, 3, 0).getTime())], FEED_TYPES, 7, NOW);
    expect(hist[3]).toBe(1);
    expect(hist.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('tile prediction', () => {
  it('predicts from a steady cadence', () => {
    expect(predictNext(regularFeeds(3, 3), FEED_TYPES, NOW)).toBe(NOW + 3 * HOUR);
  });
  it('stays silent with too few events', () => {
    expect(predictNext([feed(NOW - HOUR), feed(NOW)], FEED_TYPES, NOW)).toBe(null);
  });
  it('stays silent when the cadence is noisy', () => {
    const noisy = [0.1, 8, 0.2, 9, 0.1, 7].reduce(
      (acc, gap) => { acc.t += gap * HOUR; acc.list.push(feed(acc.t)); return acc; },
      { t: NOW - 3 * DAY, list: [] },
    ).list;
    expect(predictNext(noisy, FEED_TYPES, NOW)).toBe(null);
  });
});

describe('comparison series', () => {
  it('counts feeds per local day, oldest first, ending today', () => {
    const events = [
      feed(new Date(2026, 7, 30, 1, 0).getTime()),
      feed(new Date(2026, 7, 30, 5, 0).getTime()),
      feed(new Date(2026, 7, 29, 5, 0).getTime()),
    ];
    const series = metricSeries(events, metricByKey('feeds'), 7, NOW);
    expect(series).toHaveLength(7);
    expect(series[6].value).toBe(2);
    expect(series[5].value).toBe(1);
    expect(series[0].value).toBe(0);
  });

  it('sums bottle ml and totals sleep minutes', () => {
    const events = [
      { ...feed(NOW - HOUR, 'bottle'), amount: 60 },
      { ...feed(NOW - 2 * HOUR, 'bottle'), amount: 90 },
      { ...feed(NOW - 5 * HOUR, 'nap'), end_ts: NOW - 4 * HOUR },
    ];
    expect(metricSeries(events, metricByKey('bottle_ml'), 7, NOW)[6].value).toBe(150);
    expect(metricSeries(events, metricByKey('nap'), 7, NOW)[6].value).toBe(60);
  });
});

describe('statistics helpers', () => {
  it('computes gaps and CV', () => {
    expect(gapsBetween([{ start_ts: 0 }, { start_ts: 10 }, { start_ts: 30 }])).toEqual([10, 20]);
    expect(coefficientOfVariation([5, 5, 5])).toBe(0);
    expect(coefficientOfVariation([])).toBe(null);
  });
});

describe('a just-logged event is never invisible to analytics', () => {
  // The UI clock is a state snapshot that ticks every 20s, so an event can
  // carry a timestamp slightly AHEAD of the `now` the card is rendering with.
  // Bounding a window at `now` would drop it and show "0.0/day" next to a tile
  // that says "just now".
  const staleNow = NOW - 15 * 1000;
  const events = [...regularFeeds(3, 8), feed(NOW)];

  it('counts it in the pattern summary', () => {
    const fresh = patternSummary(events, FEED_TYPES, 7, staleNow);
    const without = patternSummary(regularFeeds(3, 8), FEED_TYPES, 7, staleNow);
    expect(fresh.count).toBe(without.count + 1);
  });

  it('counts it in the hourly heatmap', () => {
    const hist = hourlyHistogram([feed(NOW)], FEED_TYPES, 7, staleNow);
    expect(hist.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('counts it in the feed rhythm', () => {
    expect(feedRhythm(events, staleNow).lastFeedTs).toBe(NOW);
  });

  it('counts it in the tile prediction', () => {
    expect(predictNext(events, FEED_TYPES, staleNow)).toBe(NOW + 3 * HOUR);
  });
});
