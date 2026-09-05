import { describe, it, expect } from 'vitest';
import { normalizeBackup, normalizeEntry } from '../src/lib/backup.js';

const HH = 'this-household';

describe('normalizeEntry', () => {
  it('passes a Seli row through, restamped to this household', () => {
    const row = normalizeEntry({ id: 'a', household: 'other', type: 'wet', start_ts: 1000, end_ts: null, amount: null, side: null, descr: null }, HH);
    expect(row).toEqual({ id: 'a', household: HH, type: 'wet', start_ts: 1000, end_ts: null, amount: null, side: null, descr: null });
  });
  it('lifts the original ChEckIn shape (start/end/desc)', () => {
    const row = normalizeEntry({ id: 'b', type: 'nap', start: 1000, end: 4000, amount: null, side: null, desc: '' }, HH);
    expect(row).toEqual({ id: 'b', household: HH, type: 'nap', start_ts: 1000, end_ts: 4000, amount: null, side: null, descr: null });
  });
  it('keeps a note body and a carer name', () => {
    expect(normalizeEntry({ id: 'c', type: 'note', start: 5, desc: 'hiccups' }, HH).descr).toBe('hiccups');
    expect(normalizeEntry({ id: 'd', type: 'vitd', start: 5, side: 'Kay' }, HH).side).toBe('Kay');
  });
  it('rejects entries with no id, no time, or an unknown type', () => {
    expect(normalizeEntry({ type: 'wet', start: 5 }, HH)).toBeNull();
    expect(normalizeEntry({ id: 'e', type: 'wet' }, HH)).toBeNull();
    expect(normalizeEntry({ id: 'f', type: 'unicorn', start: 5 }, HH)).toBeNull();
  });
});

describe('normalizeBackup', () => {
  it('reads a ChEckIn backup file whole', () => {
    const file = { app: 'checker', version: 1, exportedAt: '2026-09-01T00:00:00Z', events: [
      { id: '1', type: 'nurse', start: 10, end: 10, amount: null, side: null, desc: '' },
      { id: '2', type: 'bottle', start: 20, end: null, amount: 90, side: null, desc: '' },
      { id: 'junk', type: 'wet' },
    ] };
    const out = normalizeBackup(file, HH);
    expect(out.source).toBe('ChEckIn');
    expect(out.rows.map((r) => r.id)).toEqual(['1', '2']);
    expect(out.rows.every((r) => r.household === HH)).toBe(true);
    expect(out.skipped).toBe(1);
  });
  it('reads a Seli backup and a bare array', () => {
    const rows = [{ id: 'x', type: 'poop', start_ts: 7 }];
    expect(normalizeBackup({ app: 'Seli', events: rows }, HH).source).toBe('Seli');
    expect(normalizeBackup(rows, HH).rows).toHaveLength(1);
  });
  it('explains an unusable file', () => {
    expect(normalizeBackup({ hello: 1 }, HH).error).toMatch(/not a Seli or ChEckIn backup/);
    expect(normalizeBackup([{ nope: true }], HH).error).toMatch(/No valid entries/);
  });
});
