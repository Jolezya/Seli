// The event model. There is exactly ONE kind of record in this app: an event.
// Every action — a feed, a diaper, a nap, a weigh-in, a note, a task — is one
// row in `events` (spec §3).

import { newId } from './ids.js';
import { HOUSEHOLD } from './config.js';
import { localHour, startOfLocalDay, dayKey } from './time.js';

/** Types that have a real duration (start + end). Everything else is a point event. */
export const TIMED_TYPES = ['nap', 'night', 'tummy'];

/** Types that count as a feed. */
export const FEED_TYPES = ['nurse', 'bottle'];

export const ALL_TYPES = [
  'nurse', 'bottle', 'nap', 'night', 'tummy',
  'wet', 'poop', 'vitd', 'weight', 'note', 'massage', 'exercise',
];

export function isTimedType(type) {
  return TIMED_TYPES.includes(type);
}

/** The columns Supabase knows about. Anything else is dropped before a write. */
const COLUMNS = ['id', 'household', 'type', 'start_ts', 'end_ts', 'amount', 'side', 'descr'];

/** Normalise a row to exactly the DB shape, with sane nulls. */
export function toRow(event) {
  const row = {};
  for (const key of COLUMNS) row[key] = event[key] ?? null;
  if (row.start_ts != null) row.start_ts = Number(row.start_ts);
  if (row.end_ts != null) row.end_ts = Number(row.end_ts);
  if (row.amount != null) row.amount = Math.round(Number(row.amount));
  return row;
}

/** Build a new event. `id` is client-owned and assigned right here. */
export function makeEvent(type, fields = {}) {
  const now = fields.start_ts ?? Date.now();
  return toRow({
    id: newId(),
    household: HOUSEHOLD,
    type,
    start_ts: now,
    end_ts: null,
    amount: null,
    side: null,
    descr: null,
    ...fields,
  });
}

/** A row is a valid event only if it has an id, a type and a start. */
export function isValidEvent(row) {
  return Boolean(
    row && typeof row === 'object' &&
    typeof row.id === 'string' && row.id &&
    typeof row.type === 'string' && row.type &&
    Number.isFinite(Number(row.start_ts))
  );
}

/** Newest first — the order the whole UI reads events in. */
export function sortEvents(events) {
  return [...events].sort((a, b) => (b.start_ts - a.start_ts) || String(a.id).localeCompare(String(b.id)));
}

/**
 * Merge incoming rows into a local list BY ID: insert when new, replace when it
 * exists, never drop anything that isn't in `incoming`.
 *
 * This is the single most important function for the prime directive. A
 * realtime payload or a server fetch that blindly replaced the array would drop
 * rows that exist locally but haven't round-tripped yet — exactly the "entry
 * appeared then vanished" bug (spec §5.4).
 */
export function mergeById(local, incoming) {
  const byId = new Map(local.map((e) => [e.id, e]));
  for (const row of incoming) {
    if (!isValidEvent(row)) continue;
    byId.set(row.id, toRow(row));
  }
  return sortEvents([...byId.values()]);
}

/** Remove a single id. The ONLY way a row leaves local state. */
export function removeById(local, id) {
  return local.filter((e) => e.id !== id);
}

/**
 * Reconcile a full server snapshot into local state.
 *
 * The server is authoritative for rows it has, but a row that is still sitting
 * in the outbound queue has NOT been accepted yet — it must survive, or an
 * offline entry would be erased by the next refresh. So: server rows are
 * applied over local, then every un-synced local row is re-applied on top.
 *
 * `pendingIds` is the set of ids with un-flushed queue operations.
 * `pendingDeletes` is the set of ids the user deleted locally whose delete has
 * not been confirmed — those must NOT be resurrected by the snapshot.
 */
export function reconcile(local, serverRows, pendingIds = new Set(), pendingDeletes = new Set()) {
  const localById = new Map(local.map((e) => [e.id, e]));
  const next = new Map();

  for (const row of serverRows) {
    if (!isValidEvent(row)) continue;
    if (pendingDeletes.has(row.id)) continue; // a local delete on its way out
    next.set(row.id, toRow(row));
  }

  // Re-apply local rows the server hasn't confirmed yet. A local row that is
  // absent from the snapshot AND absent from the queue was deleted on another
  // device, so it is correctly dropped.
  for (const [id, event] of localById) {
    if (pendingIds.has(id)) next.set(id, event);
  }

  return sortEvents([...next.values()]);
}

/** Events on a given local calendar day. */
export function eventsOnDay(events, dayTs) {
  const key = dayKey(dayTs);
  return events.filter((e) => dayKey(e.start_ts) === key);
}

/** Events of a type, newest first. */
export function ofType(events, type) {
  return events.filter((e) => e.type === type);
}

/** The most recent event of a type (events must already be newest-first). */
export function lastOfType(events, type) {
  return events.find((e) => e.type === type) || null;
}

/** An in-progress timed session: a timed-type row with no end. */
export function openSession(events, type) {
  if (!isTimedType(type)) return null;
  return events.find((e) => e.type === type && e.end_ts == null) || null;
}

/** Duration of a timed event in ms; an open session counts up to `now`. */
export function durationOf(event, now = Date.now()) {
  if (!event) return 0;
  const end = event.end_ts ?? now;
  return Math.max(0, end - event.start_ts);
}

/** Total ms of a timed type on a local day (open sessions count to `now`). */
export function totalDurationOnDay(events, type, dayTs, now = Date.now()) {
  return eventsOnDay(ofType(events, type), dayTs)
    .reduce((sum, e) => sum + durationOf(e, now), 0);
}

/** Bucket events into local-day keys. */
export function groupByDay(events) {
  const map = new Map();
  for (const e of events) {
    const key = dayKey(e.start_ts);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }
  return map;
}

export { localHour, startOfLocalDay };
