// The sync engine: local-first writes, a durable outbound queue, a full pull,
// and realtime fan-out to the other phone.
//
// Status only reports "synced" when Supabase has ACKNOWLEDGED the writes — never
// on the optimistic local update. A silent write failure is the worst bug this
// app can have, so every failure surfaces as a red dot carrying the real error
// text (spec §9.4).

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, HOUSEHOLD, CLOUD_CONFIGURED } from './config.js';
import { KEYS, readJSON, writeJSON } from './storage.js';
import { toRow } from './events.js';
import {
  queueUpsert, queueDelete, pendingUpsertIds, pendingDeleteIds, sanitizeQueue,
} from './queue.js';

export const STATUS = {
  LOCAL_ONLY: 'local-only', // Supabase not configured
  SYNCED: 'synced',         // queue empty, last write acknowledged
  SYNCING: 'syncing',       // work pending or a flush in flight
  ERROR: 'error',           // the last flush failed — show the real error
};

export class SyncEngine {
  constructor({ onStatus, onRemoteChange } = {}) {
    this.onStatus = onStatus || (() => {});
    this.onRemoteChange = onRemoteChange || (() => {});
    this.queue = sanitizeQueue(readJSON(KEYS.queue, []));
    this.flushPromise = null;
    this.lastSyncedAt = readJSON(`${KEYS.queue}.lastSync`, null);
    this.error = null;
    this.channel = null;
    this.client = CLOUD_CONFIGURED
      ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false },
          realtime: { params: { eventsPerSecond: 5 } },
        })
      : null;
  }

  get configured() {
    return Boolean(this.client);
  }

  status() {
    if (!this.configured) {
      return { state: STATUS.LOCAL_ONLY, pending: this.queue.length, error: null, lastSyncedAt: this.lastSyncedAt };
    }
    if (this.error) {
      return { state: STATUS.ERROR, pending: this.queue.length, error: this.error, lastSyncedAt: this.lastSyncedAt };
    }
    if (this.queue.length > 0 || this.flushPromise) {
      return { state: STATUS.SYNCING, pending: this.queue.length, error: null, lastSyncedAt: this.lastSyncedAt };
    }
    return { state: STATUS.SYNCED, pending: 0, error: null, lastSyncedAt: this.lastSyncedAt };
  }

  emit() {
    this.onStatus(this.status());
  }

  persistQueue() {
    writeJSON(KEYS.queue, this.queue);
  }

  pendingIds() {
    return pendingUpsertIds(this.queue);
  }

  pendingDeletes() {
    return pendingDeleteIds(this.queue);
  }

  /** Enqueue an upsert and kick a flush. Returns immediately — never awaited by the UI. */
  upsert(event) {
    this.queue = queueUpsert(this.queue, toRow(event));
    this.persistQueue();
    this.emit();
    this.flush();
  }

  /** Enqueue a delete and kick a flush. */
  remove(id) {
    this.queue = queueDelete(this.queue, id);
    this.persistQueue();
    this.emit();
    this.flush();
  }

  /**
   * Drain the queue IN ORDER.
   *
   * Callers await this and trust the result, so a flush that arrives while
   * another is in flight must not return early with a stale status: it chains
   * onto the running pass and, if work is still queued and nothing has failed,
   * runs again. Only one pass talks to the network at a time.
   */
  flush() {
    if (!this.configured) return Promise.resolve(this.status());
    if (this.flushPromise) {
      return this.flushPromise.then(() => (
        this.queue.length > 0 && !this.error ? this.flush() : this.status()
      ));
    }
    if (this.queue.length === 0) return Promise.resolve(this.status());

    // Clear the in-flight marker BEFORE the final emit, or listeners would be
    // told "syncing" as the last word on a pass that actually finished.
    this.flushPromise = this.drain().finally(() => {
      this.flushPromise = null;
      this.emit();
    });
    return this.flushPromise;
  }

  /**
   * One pass over the queue. On the first failure, stop and keep every
   * remaining item — order is preserved and nothing is dropped, so the next
   * flush (a new mutation, coming back online, the timer, or the refresh
   * button) picks up exactly where this one stopped.
   */
  async drain() {
    this.error = null;
    this.emit();

    try {
      while (this.queue.length > 0) {
        const op = this.queue[0];
        let error = null;

        if (op.kind === 'upsert') {
          // Conflict target is the primary key, making a replayed queue
          // idempotent rather than duplicate-producing (spec §9.2).
          ({ error } = await this.client.from('events').upsert(op.row, { onConflict: 'id' }));
        } else if (op.kind === 'delete') {
          ({ error } = await this.client.from('events').delete().eq('id', op.id));
        }

        if (error) {
          this.error = describeError(error);
          this.emit();
          return this.status();
        }

        // Acknowledged. Only now does the op leave the queue.
        this.queue = this.queue.slice(1);
        this.persistQueue();
      }

      this.lastSyncedAt = Date.now();
      writeJSON(`${KEYS.queue}.lastSync`, this.lastSyncedAt);
    } catch (err) {
      this.error = describeError(err);
    } finally {
      this.emit();
    }
    return this.status();
  }

  /** Fetch every row for this household. Returns null on failure (never []). */
  async pull() {
    if (!this.configured) return null;
    const { data, error } = await this.client
      .from('events')
      .select('*')
      .eq('household', HOUSEHOLD)
      .order('start_ts', { ascending: false });

    if (error) {
      this.error = describeError(error);
      this.emit();
      return null;
    }
    this.error = null;
    this.lastSyncedAt = Date.now();
    writeJSON(`${KEYS.queue}.lastSync`, this.lastSyncedAt);
    this.emit();
    return data || [];
  }

  /**
   * Realtime: merge single rows by id. Never replaces the local array — a
   * websocket payload is a delta, not a snapshot (spec §9.3).
   */
  subscribe() {
    if (!this.configured || this.channel) return;
    this.channel = this.client
      .channel(`events:${HOUSEHOLD}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'events', filter: `household=eq.${HOUSEHOLD}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const id = payload.old?.id;
            if (id) this.onRemoteChange({ kind: 'delete', id });
          } else if (payload.new) {
            this.onRemoteChange({ kind: 'upsert', row: payload.new });
          }
        },
      )
      .subscribe();
  }

  unsubscribe() {
    if (this.channel) {
      this.client.removeChannel(this.channel);
      this.channel = null;
    }
  }

  /** Manual "sync now": force a flush, then re-pull. Used by the refresh button. */
  async refresh() {
    await this.flush();
    if (this.error) return { ok: false, rows: null, error: this.error };
    const rows = await this.pull();
    if (rows == null) return { ok: false, rows: null, error: this.error };
    return { ok: true, rows, error: null };
  }
}

/** Turn any thrown/returned error into text a tired parent can act on. */
export function describeError(error) {
  if (!error) return null;
  if (typeof error === 'string') return error;
  const parts = [];
  if (error.message) parts.push(error.message);
  if (error.hint) parts.push(error.hint);
  if (error.details && error.details !== error.message) parts.push(error.details);
  const text = parts.join(' · ') || 'Unknown error';
  // The RLS rejection is the failure that cost the original days of data.
  // Name it explicitly so the fix is obvious from the dot alone.
  if (/row-level security|violates row-level/i.test(text)) {
    return `${text} — check the RLS policy on public.events (see supabase/schema.sql)`;
  }
  return text;
}
