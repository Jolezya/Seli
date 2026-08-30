import { describe, it, expect } from 'vitest';
import {
  queueUpsert, queueDelete, pendingUpsertIds, pendingDeleteIds, sanitizeQueue,
} from '../src/lib/queue.js';

const row = (id, over = {}) => ({ id, type: 'wet', start_ts: 1, ...over });

describe('outbound queue', () => {
  it('preserves order across mixed operations', () => {
    let q = [];
    q = queueUpsert(q, row('a'));
    q = queueUpsert(q, row('b'));
    q = queueDelete(q, 'a');
    expect(q.map((op) => op.kind + ':' + (op.id || op.row.id))).toEqual([
      'upsert:a', 'upsert:b', 'delete:a',
    ]);
  });

  it('collapses only an immediately repeated upsert of the same row', () => {
    let q = queueUpsert([], row('a', { amount: 30 }));
    q = queueUpsert(q, row('a', { amount: 60 }));
    expect(q).toHaveLength(1);
    expect(q[0].row.amount).toBe(60);
  });

  it('does not collapse an upsert across an intervening op', () => {
    let q = queueUpsert([], row('a'));
    q = queueUpsert(q, row('b'));
    q = queueUpsert(q, row('a'));
    expect(q).toHaveLength(3);
  });

  it('tracks pending upserts so a refresh cannot erase them', () => {
    let q = queueUpsert([], row('a'));
    q = queueUpsert(q, row('b'));
    expect([...pendingUpsertIds(q)].sort()).toEqual(['a', 'b']);
  });

  it('a later delete clears the pending-upsert claim on that id', () => {
    let q = queueUpsert([], row('a'));
    q = queueDelete(q, 'a');
    expect([...pendingUpsertIds(q)]).toEqual([]);
    expect([...pendingDeleteIds(q)]).toEqual(['a']);
  });

  it('a later upsert clears the pending-delete claim on that id', () => {
    let q = queueDelete([], 'a');
    q = queueUpsert(q, row('a'));
    expect([...pendingDeleteIds(q)]).toEqual([]);
    expect([...pendingUpsertIds(q)]).toEqual(['a']);
  });

  it('drops corrupt entries from a damaged cache', () => {
    expect(sanitizeQueue([null, { kind: 'upsert' }, { kind: 'delete', id: 'x' }, 'nope']))
      .toEqual([{ kind: 'delete', id: 'x' }]);
    expect(sanitizeQueue('not an array')).toEqual([]);
  });
});
