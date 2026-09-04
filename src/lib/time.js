// All timestamps in this app are UNIX epoch MILLISECONDS (Date.now()).
// All day-grouping is done in the DEVICE'S LOCAL TIMEZONE. Never compare
// against UTC days: a feed at 00:30 local falls on the previous UTC day and
// would vanish from "today". See spec §3.3.

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Local calendar-day key for a timestamp, e.g. "2026-08-30". */
export function dayKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Timestamp of local midnight starting the day that contains `ts`. */
export function startOfLocalDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Timestamp of local noon of the day containing `ts` (used to stamp weigh-ins). */
export function localNoon(ts) {
  const d = new Date(ts);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

/** Add n whole local days to a timestamp, preserving wall-clock time across DST. */
export function addDays(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** True when two timestamps land on the same local calendar day. */
export function isSameLocalDay(a, b) {
  return dayKey(a) === dayKey(b);
}

export function isToday(ts, now = Date.now()) {
  return isSameLocalDay(ts, now);
}

/** Whole local days between two timestamps (b - a), by calendar day, not by 24h chunks. */
export function daysBetween(a, b) {
  return Math.round((startOfLocalDay(b) - startOfLocalDay(a)) / DAY);
}

/** Ordered list of local day-start timestamps ending on `end`'s day, `count` long. */
export function lastNDays(count, end = Date.now()) {
  const out = [];
  const last = startOfLocalDay(end);
  for (let i = count - 1; i >= 0; i--) out.push(addDays(last, -i));
  return out;
}

/** "14:30" in local time. */
export function clockTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * The tile's big value: time elapsed since `ts`. Spec §5.3.
 *   < 45s        -> "just now"
 *   < 48h        -> "2h 5m ago" / "5m ago"
 *   >= 48h       -> "3d ago"  (whole days, so the tile never overflows)
 */
export function timeAgo(ts, now = Date.now()) {
  if (ts == null) return '—';
  const ms = Math.max(0, now - ts);
  if (ms < 45 * 1000) return 'just now';
  if (ms < 48 * HOUR) {
    const totalMin = Math.floor(ms / MINUTE);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m}m ago`;
    return m === 0 ? `${h}h ago` : `${h}h ${m}m ago`;
  }
  return `${Math.floor(ms / DAY)}d ago`;
}

/** Compact duration for stats: "1h 05m" / "45m". */
export function formatDuration(ms) {
  if (!ms || ms < 0) return '0m';
  const totalMin = Math.round(ms / MINUTE);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** "Today" / "Yesterday" / "Sat 30 Aug" for the day-log header. */
export function dayLabel(ts, now = Date.now()) {
  const diff = daysBetween(now, ts);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

export function shortDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Hour-of-day (0-23) in local time — the heatmap bucket. */
export function localHour(ts) {
  return new Date(ts).getHours();
}

/** Datetime-local input value ("2026-08-30T14:30") for a timestamp, in local time. */
export function toDatetimeLocal(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse a datetime-local input value back to epoch ms, interpreted as LOCAL time. */
export function fromDatetimeLocal(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
}

/** Date input value ("2026-08-30") for a timestamp, in local time. */
export function toDateInput(ts) {
  return dayKey(ts);
}

/** Parse a date input value to LOCAL noon of that date. */
export function fromDateInput(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  return new Date(y, mo - 1, d, 12, 0, 0, 0).getTime();
}

/**
 * Compact "when" for a tile subtitle: just the clock time if it was today,
 * otherwise the weekday too — "18:40" / "Tue 18:40". A bath three days ago
 * captioned only "18:40" tells you nothing.
 */
export function whenLabel(ts, now = Date.now()) {
  if (isSameLocalDay(ts, now)) return clockTime(ts);
  const weekday = new Date(ts).toLocaleDateString(undefined, { weekday: 'short' });
  return `${weekday} ${clockTime(ts)}`;
}
