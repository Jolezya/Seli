import { describe, it, expect } from 'vitest';
import {
  mergeById, reconcile, removeById, sortEvents, totalDurationOnDay,
  openSession, durationOf, eventsOnDay, isValidEvent, matchEvents,
} from '../src/lib/events.js';

const ev = (id, over = {}) => ({
  id, household: 'h', type: 'wet', start_ts: 1000, end_ts: null,
  amount: null, side: null, descr: null, ...over,
});

describe('mergeById', () => {
  it('inserts new rows and replaces existing ones by id', () => {
    const local = [ev('a'), ev('b')];
    const merged = mergeById(local, [ev('b', { amount: 60 }), ev('c')]);
    expect(merged.map((e) => e.id).sort()).toEqual(['a', 'b', 'c']);
    expect(merged.find((e) => e.id === 'b').amount).toBe(60);
  });

  it('never drops a local row that is absent from the incoming batch', () => {
    const local = [ev('local-only')];
    expect(mergeById(local, [ev('remote')]).map((e) => e.id).sort())
      .toEqual(['local-only', 'remote']);
  });

  it('ignores structurally invalid rows rather than corrupting state', () => {
    const merged = mergeById([ev('a')], [null, {}, { id: 'x' }, ev('b')]);
    expect(merged.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });
});

describe('reconcile — a server snapshot must never eat un-synced local work', () => {
  it('keeps a locally-logged row that is still in the outbound queue', () => {
    // The acceptance test from spec §5.4: tap Wet offline, refresh, it stays.
    const local = [ev('fresh-wet', { start_ts: 5000 })];
    const server = [ev('old', { start_ts: 1000 })];
    const out = reconcile(local, server, new Set(['fresh-wet']));
    expect(out.map((e) => e.id).sort()).toEqual(['fresh-wet', 'old']);
  });

  it('drops a local row deleted on the other phone once it is not pending', () => {
    const local = [ev('deleted-elsewhere')];
    const out = reconcile(local, [], new Set());
    expect(out).toHaveLength(0);
  });

  it('does not resurrect a row whose delete has not flushed yet', () => {
    const local = [];
    const server = [ev('being-deleted')];
    const out = reconcile(local, server, new Set(), new Set(['being-deleted']));
    expect(out).toHaveLength(0);
  });

  it('takes the server version for rows that are not pending locally', () => {
    const local = [ev('a', { amount: 30 })];
    const out = reconcile(local, [ev('a', { amount: 90 })], new Set());
    expect(out[0].amount).toBe(90);
  });

  it('keeps the local version for rows that ARE pending', () => {
    const local = [ev('a', { amount: 30 })];
    const out = reconcile(local, [ev('a', { amount: 90 })], new Set(['a']));
    expect(out[0].amount).toBe(30);
  });
});

describe('deletion', () => {
  it('removes exactly one id and nothing else', () => {
    const out = removeById([ev('a'), ev('b')], 'a');
    expect(out.map((e) => e.id)).toEqual(['b']);
  });
});

describe('sessions and durations', () => {
  it('finds an open timed session but never treats a one-tap event as one', () => {
    const events = sortEvents([
      ev('wet1', { type: 'wet', end_ts: null }),
      ev('nap1', { type: 'nap', end_ts: null }),
    ]);
    expect(openSession(events, 'nap').id).toBe('nap1');
    // wet/poop/vitd/note also have end_ts === null. They are NOT sessions, and
    // any cleanup keyed on "end is null" would have deleted them.
    expect(openSession(events, 'wet')).toBe(null);
  });

  it('counts an open session up to now', () => {
    const now = 10_000;
    expect(durationOf(ev('x', { type: 'nap', start_ts: 4000, end_ts: null }), now)).toBe(6000);
    expect(durationOf(ev('y', { type: 'nap', start_ts: 4000, end_ts: 7000 }), now)).toBe(3000);
  });

  it('sums tummy minutes for the goal on a local day', () => {
    const day = new Date(2026, 7, 30, 12, 0).getTime();
    const events = [
      ev('t1', { type: 'tummy', start_ts: new Date(2026, 7, 30, 9, 0).getTime(), end_ts: new Date(2026, 7, 30, 9, 5).getTime() }),
      ev('t2', { type: 'tummy', start_ts: new Date(2026, 7, 30, 15, 0).getTime(), end_ts: new Date(2026, 7, 30, 15, 3).getTime() }),
      ev('t3', { type: 'tummy', start_ts: new Date(2026, 7, 29, 15, 0).getTime(), end_ts: new Date(2026, 7, 29, 15, 30).getTime() }),
    ];
    expect(totalDurationOnDay(events, 'tummy', day) / 60000).toBe(8);
  });

  it('groups events by local day', () => {
    const day = new Date(2026, 7, 30, 0, 30).getTime();
    const events = [ev('a', { start_ts: day }), ev('b', { start_ts: new Date(2026, 7, 29, 23, 30).getTime() })];
    expect(eventsOnDay(events, day).map((e) => e.id)).toEqual(['a']);
  });

  it('validates rows', () => {
    expect(isValidEvent(ev('a'))).toBe(true);
    expect(isValidEvent({ id: 'a', type: 'wet' })).toBe(false);
  });
});

describe('matchEvents — the clear-data predicate', () => {
  const at = (d, h) => new Date(2026, 8, d, h).getTime();
  const rows = [
    ev('n1', { type: 'nap',   start_ts: at(1, 10) }),
    ev('n2', { type: 'nap',   start_ts: at(3, 14) }),
    ev('s1', { type: 'night', start_ts: at(2, 22) }),
    ev('t1', { type: 'tummy', start_ts: at(3, 11) }),
    ev('w1', { type: 'wet',   start_ts: at(3, 9) }),
  ];
  it('filters by any of several types', () => {
    expect(matchEvents(rows, { types: ['nap', 'tummy'] }).map((e) => e.id).sort()).toEqual(['n1', 'n2', 't1']);
  });
  it('filters by a start-time range, from inclusive and to exclusive', () => {
    const hit = matchEvents(rows, { from: at(3, 0), to: at(3, 12) });
    expect(hit.map((e) => e.id).sort()).toEqual(['t1', 'w1']);
    expect(matchEvents(rows, { from: at(3, 11), to: at(3, 11) })).toHaveLength(0);
  });
  it('combines type and range, and matches everything with no filter', () => {
    expect(matchEvents(rows, { types: ['nap'], from: at(2, 0) }).map((e) => e.id)).toEqual(['n2']);
    expect(matchEvents(rows, {})).toHaveLength(5);
    expect(matchEvents(rows)).toHaveLength(5);
  });
});
