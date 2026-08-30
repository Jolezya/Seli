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
    const engine = engineWith({
      from: () => ({
        select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { message: 'offline' } }) }) }),
      }),
    });
    // An empty array here would look like "the household has no events" and
    // could wipe the view; null means "we learned nothing".
    expect(await engine.pull()).toBe(null);
    expect(engine.status().state).toBe(STATUS.ERROR);
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
