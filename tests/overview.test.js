import { describe, it, expect } from 'vitest';
import {
  overlapMs, windowTotals, dailyTotals, baseline, timelineData, longestSleep,
  feedGapInWindow, weekOverWeek, BASELINE_MIN_DAYS, periodRange, usualByElapsed,
} from '../src/lib/analytics.js';
import { HOUR, DAY, MINUTE } from '../src/lib/time.js';

const at = (d, h, m = 0) => new Date(2026, 8, d, h, m).getTime();   // September 2026
let n = 0;
const ev = (type, start_ts, over = {}) => ({
  id: `e${n++}`, household: 'h', type, start_ts, end_ts: null, amount: null, side: null, descr: null, ...over,
});

describe('clipping timed events to a window', () => {
  it('splits a night sleep across the midnight it crosses', () => {
    const sleep = ev('night', at(1, 22, 0), { end_ts: at(2, 6, 0) });      // 22:00 → 06:00
    expect(overlapMs(sleep, at(1, 0), at(2, 0)) / HOUR).toBe(2);           // 2h on the 1st
    expect(overlapMs(sleep, at(2, 0), at(3, 0)) / HOUR).toBe(6);           // 6h on the 2nd
  });

  it('runs an open session up to now, not to infinity', () => {
    const sleep = ev('night', at(2, 1, 0));                                // still asleep
    const now = at(2, 3, 30);
    expect(overlapMs(sleep, at(2, 0), at(3, 0), now) / HOUR).toBe(2.5);
  });
});

describe('daily totals', () => {
  const events = [
    ev('nurse', at(1, 8), { end_ts: at(1, 8) }), ev('bottle', at(1, 12), { amount: 90 }),
    ev('wet', at(1, 9)), ev('poop', at(1, 9, 5)),
    ev('night', at(1, 22), { end_ts: at(2, 6) }),
    ev('nurse', at(2, 7), { end_ts: at(2, 7) }),
  ];
  const now = at(2, 12);

  it('counts point events by their day and clips sleep by overlap', () => {
    const rows = dailyTotals(events, 3, now);
    const [aug31, sep1, sep2] = rows;
    expect(sep1.feeds).toBe(2);
    expect(sep1.bottleMl).toBe(90);
    expect(sep1.wet).toBe(1);
    expect(sep1.poop).toBe(1);
    expect(sep1.sleepMin / 60).toBe(2);       // 22:00–24:00
    expect(sep2.sleepMin / 60).toBe(6);       // 00:00–06:00
    expect(sep2.feeds).toBe(1);
    expect(aug31.feeds).toBe(0);
  });

  it('marks days before the first entry as untracked, not as zero', () => {
    const rows = dailyTotals(events, 3, now);
    expect(rows[0].tracked).toBe(false);      // 31 Aug — app not in use yet
    expect(rows[1].tracked).toBe(true);
    expect(rows[2].isToday).toBe(true);
  });
});

describe('baseline ("usually")', () => {
  const regular = (days) => {
    const out = [];
    for (let d = 1; d <= days; d++) {
      for (let h = 6; h < 24; h += 3) out.push(ev('nurse', at(d, h), { end_ts: at(d, h) }));   // 6 feeds/day
      out.push(ev('wet', at(d, 10)), ev('wet', at(d, 15)));
    }
    return out;
  };

  it('refuses to state a baseline from too few full days', () => {
    const now = at(3, 12);   // days 1 and 2 are full, day 3 is today
    const rows = dailyTotals(regular(3), 7, now);
    const b = baseline(rows);
    expect(b.ready).toBe(false);
    expect(b.days).toBe(2);
    expect(BASELINE_MIN_DAYS).toBe(3);
  });

  it('averages only full tracked days, never today or pre-tracking days', () => {
    const now = at(5, 12);   // days 1–4 full, day 5 today
    const rows = dailyTotals(regular(5), 14, now);
    const b = baseline(rows);
    expect(b.ready).toBe(true);
    expect(b.days).toBe(4);
    expect(b.feeds).toBe(6);
    expect(b.wet).toBe(2);
  });
});

describe('the 24-hour strip', () => {
  const now = at(2, 9);
  const from = now - 24 * HOUR;
  const events = [
    ev('night', at(1, 21), { end_ts: at(2, 5) }),
    ev('nap', at(2, 7, 30)),                                             // still going
    ev('nurse', at(1, 20), { end_ts: at(1, 20) }), ev('bottle', at(2, 5, 10), { amount: 60 }),
    ev('nurse', at(1, 8), { end_ts: at(1, 8) }),                         // outside: 25h ago
    ev('wet', at(2, 5, 15)), ev('poop', at(2, 8)),
  ];

  it('clips sleeps to the window and marks a running one as open', () => {
    const { sleeps } = timelineData(events, from, now, now);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1].open).toBe(true);
    expect(sleeps[1].end).toBe(now);
  });

  it('drops point events outside the window', () => {
    const { feeds, diapers } = timelineData(events, from, now, now);
    expect(feeds.map((f) => f.type)).toEqual(['nurse', 'bottle']);
    expect(diapers.map((d) => d.type)).toEqual(['wet', 'poop']);
  });

  it('finds the longest sleep', () => {
    const best = longestSleep(events, from, now, now);
    expect(best.ms / HOUR).toBe(8);
    expect(best.open).toBe(false);
  });

  it('needs three feeds for a typical gap', () => {
    expect(feedGapInWindow(events, from, now)).toBe(null);
    const more = [...events, ev('nurse', at(2, 2), { end_ts: at(2, 2) })];
    expect(feedGapInWindow(more, from, now)).toBeGreaterThan(0);
  });
});

describe('week over week', () => {
  const feedsPerDay = (day, count) => Array.from({ length: count }, (_, i) => ev('nurse', at(day, 6 + i * 2), { end_ts: at(day, 6 + i * 2) }));

  it('is null when last week is not genuinely populated', () => {
    // Only 4 days of data in total: recent week has 3 full days, prior week has none.
    const events = [1, 2, 3, 4].flatMap((d) => feedsPerDay(d, 6));
    expect(weekOverWeek(events, at(4, 12))).toBe(null);
  });

  it('compares full weeks once both exist', () => {
    // 15 days: days 1–7 at 5 feeds, days 8–14 at 7 feeds, day 15 today.
    const events = [
      ...[1, 2, 3, 4, 5, 6, 7].flatMap((d) => feedsPerDay(d, 5)),
      ...[8, 9, 10, 11, 12, 13, 14].flatMap((d) => feedsPerDay(d, 7)),
      ...feedsPerDay(15, 2),
    ];
    const w = weekOverWeek(events, at(15, 12));
    expect(w).not.toBe(null);
    expect(w.feeds.before).toBe(5);
    expect(w.feeds.now).toBe(7);
    expect(w.feeds.delta).toBe(2);
  });
});

describe('window totals sums bottle volume and both sleep types', () => {
  it('adds ml and minutes', () => {
    const now = at(2, 12);
    const events = [
      ev('bottle', at(2, 8), { amount: 60 }), ev('bottle', at(2, 11), { amount: 90 }),
      ev('nap', at(2, 9), { end_ts: at(2, 9, 45) }), ev('night', at(1, 23), { end_ts: at(2, 6) }),
    ];
    const t = windowTotals(events, at(2, 0), at(3, 0), now);
    expect(t.bottleMl).toBe(150);
    expect(t.napMin).toBe(45);
    expect(t.nightMin).toBe(6 * 60);
    expect(t.sleepMin).toBe(45 + 360);
    expect(t.feeds).toBe(2);
  });
});

describe('period ranges and the by-this-time baseline', () => {
  it('resolves today, yesterday, a date and the rolling day', () => {
    const now = at(4, 7, 15);   // 4 Sept, 07:15
    const today = periodRange('today', now);
    expect(today.from).toBe(at(4, 0));
    expect(today.to).toBe(now);
    expect(today.partial).toBe(true);
    expect(today.dayEnd).toBe(at(5, 0));

    const yesterday = periodRange('yesterday', now);
    expect(yesterday.from).toBe(at(3, 0));
    expect(yesterday.to).toBe(at(4, 0));
    expect(yesterday.partial).toBe(false);

    const picked = periodRange('date', now, at(1, 13));
    expect(picked.from).toBe(at(1, 0));
    expect(picked.to).toBe(at(2, 0));

    const rolling = periodRange('24h', now);
    expect(rolling.rolling).toBe(true);
    expect(rolling.to - rolling.from).toBe(DAY);
  });

  it('compares a partial day against what earlier days had reached by the same time', () => {
    // Four full days with feeds at 02:00, 05:00, 09:00, 14:00; today it is 07:15.
    const events = [];
    for (let d = 1; d <= 4; d++) for (const h of [2, 5, 9, 14]) events.push(ev('nurse', at(d, h), { end_ts: at(d, h) }));
    events.push(ev('nurse', at(5, 3), { end_ts: at(5, 3) }));
    const now = at(5, 7, 15);
    const byNow = usualByElapsed(events, now - at(5, 0), now);
    expect(byNow.ready).toBe(true);
    expect(byNow.byTime).toBe(true);
    expect(byNow.feeds).toBe(2);          // 02:00 and 05:00 had happened by 07:15
    const fullDay = baseline(dailyTotals(events, 30, now));
    expect(fullDay.feeds).toBe(4);        // the whole-day figure it must NOT be compared to
  });
});
