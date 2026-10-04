import { describe, it, expect } from 'vitest';
import { activeSession, describe as words, plan } from '../src/lib/lockscreen.js';

const at = (h, m = 0) => new Date(2026, 9, 4, h, m).getTime();
const ev = (id, type, start, end = null) => ({ id, type, start_ts: start, end_ts: end });

describe('what the lock screen shows', () => {
  it('picks the newest running sleep or tummy time, nothing else', () => {
    const rows = [ev('t', 'tummy', at(14), at(14, 10)), ev('n', 'night', at(21, 30)), ev('w', 'wet', at(21))];
    expect(activeSession(rows).id).toBe('n');
    expect(activeSession([ev('t', 'tummy', at(14))]).id).toBe('t');
    expect(activeSession([ev('n', 'nap', at(13), at(14))])).toBeNull();
    expect(activeSession([])).toBeNull();
  });
  it('says what is running and since when', () => {
    expect(words(ev('n', 'night', at(21, 30))).title).toBe('😴 Night sleep since 21:30');
    expect(words(ev('p', 'nap', at(13, 5))).title).toBe('😴 Nap since 13:05');
    expect(words(ev('t', 'tummy', at(9))).title).toBe('🤸 Tummy time since 09:00');
  });
});

describe('plan', () => {
  const s = ev('n', 'night', at(21));
  it('posts a running session once', () => {
    expect(plan({ enabled: true, granted: true, session: s, postedId: null })).toBe('post');
    expect(plan({ enabled: true, granted: true, session: s, postedId: 'n' })).toBe('keep');
    expect(plan({ enabled: true, granted: true, session: s, postedId: 'old' })).toBe('post');
  });
  it('clears when the session ends, or the feature or permission is off', () => {
    expect(plan({ enabled: true, granted: true, session: null, postedId: 'n' })).toBe('close');
    expect(plan({ enabled: false, granted: true, session: s, postedId: 'n' })).toBe('close');
    expect(plan({ enabled: true, granted: false, session: s, postedId: 'n' })).toBe('close');
  });
  it('does nothing when nothing is up and nothing should be', () => {
    expect(plan({ enabled: true, granted: true, session: null, postedId: null })).toBe('keep');
    expect(plan({ enabled: false, granted: false, session: s, postedId: null })).toBe('keep');
  });
});
