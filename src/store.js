// The app store: one React hook owning all events, the sync engine and prefs.
//
// Local state is the source of truth for the UI. Every mutation lands in state
// and localStorage FIRST, then goes to the outbound queue. Nothing in this file
// ever waits for the network before showing the user their entry (spec §9.1).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SyncEngine, STATUS } from './lib/sync.js';
import { KEYS, readJSON, writeJSON } from './lib/storage.js';
import {
  makeEvent, mergeById, removeById, reconcile, sortEvents, toRow,
  openSession, isTimedType, lastOfType, isValidEvent,
  sleepTypeFor, openSleep, lastSleep, matchEvents,
} from './lib/events.js';
import { localNoon, dayKey } from './lib/time.js';
import { weighInOnDay, clampGain, DEFAULT_GAIN } from './lib/weight.js';
import { HOUSEHOLD } from './lib/config.js';

const DEFAULT_PREFS = {
  gain: DEFAULT_GAIN,
  tummyGoal: 15,
  logHidden: false,
  themeOverride: null,
  metric: 'feeds',
  window: 7,
  weightRange: '3m',
};

/** Periodic safety-net flush + pull, in case realtime or a retry was missed. */
const REFRESH_INTERVAL = 60 * 1000;

export function useStore() {
  const [events, setEvents] = useState(() => sortEvents(
    (readJSON(KEYS.events, []) || []).filter(isValidEvent).map(toRow),
  ));
  const [prefs, setPrefsState] = useState(() => ({ ...DEFAULT_PREFS, ...readJSON(KEYS.prefs, {}) }));
  const [status, setStatus] = useState({ state: STATUS.LOCAL_ONLY, pending: 0, error: null, lastSyncedAt: null });
  const [toast, setToast] = useState(null);

  const engineRef = useRef(null);
  const toastTimer = useRef(null);

  // Mirror every change of the event list to the cache. This is what makes a
  // logged event safe the instant it exists, before any server call.
  useEffect(() => {
    writeJSON(KEYS.events, events);
  }, [events]);

  useEffect(() => {
    writeJSON(KEYS.prefs, prefs);
  }, [prefs]);

  if (!engineRef.current) {
    engineRef.current = new SyncEngine({
      onStatus: setStatus,
      onRemoteChange: (change) => {
        // A realtime payload is a DELTA. Merging by id — never replacing the
        // array — is what stops another phone's echo from dropping a row that
        // has not round-tripped yet (spec §9.3).
        setEvents((current) => (
          change.kind === 'delete'
            ? removeById(current, change.id)
            : mergeById(current, [change.row])
        ));
      },
    });
  }
  const engine = engineRef.current;

  const showToast = useCallback((message, action = null, ms = 6000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, action, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  /** Apply a server snapshot without ever losing un-synced local work. */
  const applySnapshot = useCallback((rows) => {
    if (!rows) return;
    setEvents((current) => reconcile(current, rows, engine.pendingIds(), engine.pendingDeletes()));
  }, [engine]);

  // Startup: cache is already rendered, now pull the server and go live.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus(engine.status());
      if (!engine.configured) return;
      await engine.flush();
      const rows = await engine.pull();
      if (!cancelled) applySnapshot(rows);
      engine.subscribe();
    })();

    const onOnline = () => { engine.flush(); };
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      await engine.flush();
      applySnapshot(await engine.pull());
    };
    const timer = setInterval(async () => {
      if (!engine.configured) return;
      await engine.flush();
      if (engine.queue.length === 0) applySnapshot(await engine.pull());
    }, REFRESH_INTERVAL);

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      engine.unsubscribe();
    };
  }, [engine, applySnapshot]);

  /** Write one event: local first, queue second. Returns the stored row. */
  const put = useCallback((event) => {
    const row = toRow(event);
    setEvents((current) => mergeById(current, [row]));
    engine.upsert(row);
    return row;
  }, [engine]);

  const log = useCallback((type, fields = {}) => put(makeEvent(type, fields)), [put]);

  const update = useCallback((id, patch) => {
    let updated = null;
    setEvents((current) => {
      const existing = current.find((e) => e.id === id);
      if (!existing) return current;
      updated = toRow({ ...existing, ...patch });
      return mergeById(current, [updated]);
    });
    // The queue write happens after state settles so it carries the merged row.
    setTimeout(() => { if (updated) engine.upsert(updated); }, 0);
    return updated;
  }, [engine]);

  /**
   * Delete one event, always undoable. Deleting is only ever an explicit user
   * action — nothing in this app removes a row as a side effect of cleanup
   * (spec §17).
   */
  const remove = useCallback((id, label = 'Entry') => {
    const victim = events.find((e) => e.id === id);
    setEvents((current) => removeById(current, id));
    engine.remove(id);
    if (victim) {
      showToast(`${label} deleted`, {
        label: 'Undo',
        run: () => {
          setEvents((current) => mergeById(current, [victim]));
          engine.upsert(victim);
          dismissToast();
        },
      });
    }
  }, [events, engine, showToast, dismissToast]);

  // ---- Activity helpers -------------------------------------------------

  /** One-tap log for point events (wet, poop, nurse, massage, exercise, …). */
  const logPoint = useCallback((type, fields = {}) => {
    const now = Date.now();
    // Nursing is one-tap but keeps start === end so duration-based analytics
    // still read it as a completed session (spec §5.1).
    const extra = type === 'nurse' ? { end_ts: now } : {};
    return log(type, { start_ts: now, ...extra, ...fields });
  }, [log]);

  /** Start or end a timed session (night, tummy, nap). */
  const toggleSession = useCallback((type) => {
    const open = openSession(events, type);
    if (open) return update(open.id, { end_ts: Date.now() });
    return log(type, { start_ts: Date.now(), end_ts: null });
  }, [events, log, update]);

  /**
   * Start or end a sleep. The tile does not ask which kind: the clock decides
   * at the moment the sleep starts, and the row is stored as 'night' or 'nap'
   * so every analytic downstream keeps working unchanged.
   */
  const toggleSleep = useCallback(() => {
    const open = openSleep(events);
    if (open) return update(open.id, { end_ts: Date.now() });
    const now = Date.now();
    return log(sleepTypeFor(now), { start_ts: now, end_ts: null });
  }, [events, log, update]);

  /**
   * The Update pill: move the last completed session's end (or the nurse
   * event's timestamp) to now. It MUTATES the existing row and never inserts —
   * that is the whole point of cluster-feed tracking (spec §5.2).
   */
  const bumpLast = useCallback((type) => {
    const last = type === 'sleep' ? lastSleep(events) : lastOfType(events, type);
    if (!last) return null;
    const now = Date.now();
    if (type === 'nurse') return update(last.id, { start_ts: now, end_ts: now });
    if ((type === 'sleep' || isTimedType(type)) && last.end_ts != null) return update(last.id, { end_ts: now });
    return update(last.id, { start_ts: now });
  }, [events, update]);

  /**
   * Record a weigh-in. One per day: an entry for a date that already has one
   * UPDATES it in place rather than adding a duplicate (spec §7).
   */
  const setWeight = useCallback((dateTs, grams) => {
    const ts = localNoon(dateTs);
    const amount = Math.round(Number(grams));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const existing = weighInOnDay(events, ts);
    if (existing) return update(existing.id, { amount, start_ts: ts });
    return log('weight', { start_ts: ts, amount });
  }, [events, log, update]);

  // ---- Data safety ------------------------------------------------------

  /** Back up: the entire local event list as a portable JSON document. */
  const backup = useCallback(() => ({
    app: 'Seli',
    version: 1,
    exported_at: new Date().toISOString(),
    household: HOUSEHOLD,
    count: events.length,
    events,
  }), [events]);

  /** Restore: merge rows in by id, so re-importing the same file is a no-op. */
  const restore = useCallback((payload) => {
    const incoming = Array.isArray(payload) ? payload : payload?.events;
    if (!Array.isArray(incoming)) return { ok: false, added: 0, error: 'That file is not a Seli backup.' };
    const rows = incoming.filter(isValidEvent).map((r) => toRow({ ...r, household: r.household || HOUSEHOLD }));
    if (!rows.length) return { ok: false, added: 0, error: 'No valid entries found in that file.' };

    const known = new Set(events.map((e) => e.id));
    setEvents((current) => mergeById(current, rows));
    for (const row of rows) engine.upsert(row);
    return { ok: true, added: rows.filter((r) => !known.has(r.id)).length, total: rows.length, error: null };
  }, [events, engine]);

  /** Clear data — destructive, explicit, and optionally narrowed by type/date. */
  const clearData = useCallback((filter = {}) => {
    const doomed = matchEvents(events, filter);
    if (!doomed.length) return 0;
    const ids = new Set(doomed.map((e) => e.id));
    setEvents((current) => current.filter((e) => !ids.has(e.id)));
    for (const e of doomed) engine.remove(e.id);
    showToast(`${doomed.length} ${doomed.length === 1 ? 'entry' : 'entries'} deleted`, {
      label: 'Undo',
      run: () => {
        setEvents((current) => mergeById(current, doomed));
        for (const e of doomed) engine.upsert(e);
        dismissToast();
      },
    }, 12000);
    return doomed.length;
  }, [events, engine, showToast, dismissToast]);

  /** The refresh button: force a flush, re-pull, and report honestly. */
  const refresh = useCallback(async () => {
    if (!engine.configured) {
      showToast('Local only — cloud sync is not configured');
      return false;
    }
    const result = await engine.refresh();
    if (!result.ok) {
      showToast(`Couldn't refresh — ${result.error || 'check connection'}`);
      return false;
    }
    applySnapshot(result.rows);
    showToast('Refreshed ✓', null, 2500);
    return true;
  }, [engine, applySnapshot, showToast]);

  const setPrefs = useCallback((patch) => {
    setPrefsState((current) => {
      const next = { ...current, ...patch };
      if (patch.gain != null) next.gain = clampGain(patch.gain);
      return next;
    });
  }, []);

  return useMemo(() => ({
    events, prefs, status, toast,
    log, logPoint, toggleSession, toggleSleep, bumpLast, update, remove, setWeight,
    backup, restore, clearData, refresh, setPrefs, showToast, dismissToast,
    configured: engine.configured,
    client: engine.client,
  }), [
    events, prefs, status, toast, log, logPoint, toggleSession, toggleSleep, bumpLast,
    update, remove, setWeight, backup, restore, clearData, refresh, setPrefs,
    showToast, dismissToast, engine,
  ]);
}

export { STATUS, dayKey };
