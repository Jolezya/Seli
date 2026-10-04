import { describe, it, expect, vi } from 'vitest';
import { SyncEngine, STATUS, describeError } from '../src/lib/sync.js';

/** A stand-in for the Supabase client that records calls and can be made to fail. */
function fakeClient() {
  const calls = [];
  let failure = null;
  return {
    calls,
    fail(err) { failure = err; },
    succeed() { failure = null; },
    from() {
      return {
        upsert: async (row, opts) => {
          calls.push({ kind: 'upsert', id: row.id, onConflict: opts?.onConflict });
          return { error: failure };
        },
        delete: () => ({
          eq: async (_col, id) => {
            calls.push({ kind: 'delete', id });
            return { error: failure };
          },
        }),
      };
    },
  };
}

function engineWith(client) {
  const engine = new SyncEngine();
  engine.client = client;         // pretend Supabase is configured
  engine.queue = [];
  return engine;
}

const row = (id) => ({ id, household: 'h', type: 'wet', start_ts: 1, end_ts: null, amount: null, side: null, descr: null });

describe('sync engine', () => {
  it('upserts on the primary key so a replayed queue cannot duplicate rows', async () => {
    const client = fakeClient();
    const engine = engineWith(client);
    engine.upsert(row('a'));
    await engine.flush();
    expect(client.calls[0].onConflict).toBe('id');
  });

  it('only reports synced once the server has acknowledged', async () => {
    const client = fakeClient();
    const engine = engineWith(client);
    engine.upsert(row('a'));
    expect(engine.status().state).toBe(STATUS.SYNCING); // optimistic local write is NOT "synced"
    await engine.flush();
    expect(engine.status().state).toBe(STATUS.SYNCED);
    expect(engine.status().pending).toBe(0);
  });

  it('stops at the first failure, keeps every item, and preserves order', async () => {
    const client = fakeClient();
    client.fail({ message: 'new row violates row-level security policy for table "events"' });
    const engine = engineWith(client);
    engine.upsert(row('a'));
    engine.upsert(row('b'));
    engine.remove('a');

    await engine.flush();
    const status = engine.status();
    expect(status.state).toBe(STATUS.ERROR);
    expect(status.pending).toBe(3);                 // nothing dropped
    expect(status.error).toMatch(/row-level security/);
    expect(status.error).toMatch(/RLS policy/);     // tells the user where to look

    // Back online: the queue drains in its original order.
    client.succeed();
    await engine.flush();
    expect(client.calls.map((c) => `${c.kind}:${c.id}`).slice(-3))
      .toEqual(['upsert:a', 'upsert:b', 'delete:a']);
    expect(engine.status().state).toBe(STATUS.SYNCED);
    expect(engine.status().pending).toBe(0);
  });

  it('surfaces pending ids so a refresh cannot erase un-synced work', () => {
    const engine = engineWith(fakeClient());
    engine.upsert(row('a'));
    engine.remove('b');
    expect([...engine.pendingIds()]).toEqual(['a']);
    expect([...engine.pendingDeletes()]).toEqual(['b']);
  });

  it('reports local-only when Supabase is not configured', () => {
    const engine = new SyncEngine();
    engine.client = null;
    expect(engine.status().state).toBe(STATUS.LOCAL_ONLY);
  });

  it('notifies status changes so the header dot stays honest', async () => {
    const onStatus = vi.fn();
    const engine = new SyncEngine({ onStatus });
    engine.client = fakeClient();
    engine.queue = [];
    engine.upsert(row('a'));
    await engine.flush();
    expect(onStatus).toHaveBeenCalled();
    expect(onStatus.mock.calls.at(-1)[0].state).toBe(STATUS.SYNCED);
  });

  it('a failed pull returns null rather than an empty list', async () => {
    const engine = engineWith(cappedServer([], { fail: { message: 'offline' } }));
    // An empty array here would look like "the household has no events" and
    // could wipe the view; null means "we learned nothing".
    expect(await engine.pull()).toBe(null);
    expect(engine.status().state).toBe(STATUS.ERROR);
  });
});

/**
 * A stand-in for PostgREST as Supabase runs it: every response is cut at
 * `maxRows` rows (Supabase's default is 1000) unless a range asks for a
 * smaller slice, and a count is reported only when asked for.
 */
function cappedServer(rows, { maxRows = 1000, fail = null } = {}) {
  const requests = [];
  const query = () => {
    const q = { orders: [], range: null, count: null };
    const run = async () => {
      requests.push({ ...q });
      if (fail) return { data: null, error: fail, count: null };
      const sorted = [...rows].sort((a, b) => {
        for (const [col, asc] of q.orders) {
          if (a[col] < b[col]) return asc ? -1 : 1;
          if (a[col] > b[col]) return asc ? 1 : -1;
        }
        return 0;
      });
      const [from, to] = q.range || [0, sorted.length - 1];
      const slice = sorted.slice(from, to + 1).slice(0, maxRows);
      return { data: slice, error: null, count: q.count ? rows.length : null };
    };
    const builder = {
      select: (_cols, opts) => { q.count = opts?.count || null; return builder; },
      eq: () => builder,
      order: (col, opts) => { q.orders.push([col, opts?.ascending !== false]); return builder; },
      range: (a, b) => { q.range = [a, b]; return builder; },
      then: (resolve, reject) => run().then(resolve, reject),
    };
    return builder;
  };
  return { requests, from: () => query() };
}

describe('pulling every row', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({
    id: `r${String(i).padStart(5, '0')}`, household: 'h', type: 'wet',
    start_ts: 1_000_000 + i * 60_000, end_ts: null, amount: null, side: null, descr: null,
  }));

  it('gets past the server 1000-row cap, oldest row included', async () => {
    const rows = many(2500);
    const server = cappedServer(rows);
    const engine = engineWith(server);
    const pulled = await engine.pull();
    expect(pulled).toHaveLength(2500);
    expect(new Set(pulled.map((r) => r.id)).size).toBe(2500);
    expect(pulled.some((r) => r.id === 'r00000')).toBe(true);   // the very first entry ever made
  });

  it('still gets everything when the server caps lower than a page', async () => {
    const engine = engineWith(cappedServer(many(1300), { maxRows: 400 }));
    expect(await engine.pull()).toHaveLength(1300);
  });

  it('a small household takes one request', async () => {
    const server = cappedServer(many(40));
    const engine = engineWith(server);
    expect(await engine.pull()).toHaveLength(40);
    expect(server.requests).toHaveLength(1);
  });

  it('an old measurement survives the sync that follows it', async () => {
    const { reconcile } = await import('../src/lib/events.js');
    const rows = many(1500);
    const old = { ...rows[0], id: 'length-22-jul', type: 'length', amount: 490 };
    rows[0] = old;
    const engine = engineWith(cappedServer(rows));
    const after = reconcile([old], await engine.pull(), new Set(), new Set());
    expect(after.some((e) => e.id === 'length-22-jul')).toBe(true);
  });
});

describe('describeError', () => {
  it('explains an RLS rejection in terms of the fix', () => {
    expect(describeError({ message: 'violates row-level security policy' }))
      .toMatch(/schema\.sql/);
  });
  it('passes through plain messages and handles nothing', () => {
    expect(describeError({ message: 'Failed to fetch' })).toBe('Failed to fetch');
    expect(describeError(null)).toBe(null);
  });
});
