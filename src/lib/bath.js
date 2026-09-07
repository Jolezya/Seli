// The bath rhythm. Baths are scheduled — this family showers her on set
// weekdays — so the tile can say when the next one is and the task list can
// ask for it on the day. Days are JS weekday numbers, 0 = Sunday.

import { DAY, addDays, startOfLocalDay, dayKey } from './time.js';

export const DEFAULT_BATH_DAYS = [3, 6];   // Wednesday, Saturday
export const WEEKDAYS = [
  { day: 1, short: 'M', label: 'Mon' },
  { day: 2, short: 'T', label: 'Tue' },
  { day: 3, short: 'W', label: 'Wed' },
  { day: 4, short: 'T', label: 'Thu' },
  { day: 5, short: 'F', label: 'Fri' },
  { day: 6, short: 'S', label: 'Sat' },
  { day: 0, short: 'S', label: 'Sun' },
];

export function weekdayLabel(ts) {
  return WEEKDAYS.find((w) => w.day === new Date(ts).getDay())?.label ?? '';
}

/** Toggle a weekday in a schedule, keeping the list sorted. */
export function toggleDay(days, day) {
  const set = new Set(days);
  if (set.has(day)) set.delete(day); else set.add(day);
  return [...set].sort((a, b) => a - b);
}

/**
 * Where the schedule stands today.
 *   isBathDay  — today is a scheduled day
 *   doneToday  — the bath logged today, if any
 *   next       — the next scheduled day after today (null with an empty schedule)
 *   missed     — the most recent scheduled day that passed with no bath on it
 *                and none since; null once a bath is logged after it
 */
export function bathSchedule(events, days = DEFAULT_BATH_DAYS, now = Date.now()) {
  const schedule = new Set(days);
  const baths = events.filter((e) => e.type === 'bath');
  const today0 = startOfLocalDay(now);
  const onDay = (dayTs) => baths.find((b) => dayKey(b.start_ts) === dayKey(dayTs)) || null;

  const isBathDay = schedule.has(new Date(now).getDay());
  const doneToday = onDay(now);

  let next = null;
  if (schedule.size) {
    for (let i = 1; i <= 7; i++) {
      const ts = addDays(today0, i);
      if (schedule.has(new Date(ts).getDay())) { next = { ts, label: weekdayLabel(ts) }; break; }
    }
  }

  let missed = null;
  if (schedule.size) {
    for (let i = 1; i <= 7; i++) {
      const ts = addDays(today0, -i);
      if (!schedule.has(new Date(ts).getDay())) continue;
      const bathSince = baths.some((b) => b.start_ts >= ts);
      if (!onDay(ts) && !bathSince) missed = { ts, label: weekdayLabel(ts) };
      break;   // only the most recent scheduled day counts
    }
  }

  return { isBathDay, doneToday, next, missed, days: [...schedule].sort((a, b) => a - b) };
}

/** The tile's third line: "bath day today" / "next Wed" / "missed Wed · next Sat". */
export function bathHint(schedule) {
  if (!schedule.days.length) return null;
  if (schedule.isBathDay && !schedule.doneToday) return 'bath day today';
  if (schedule.missed && schedule.next) return `missed ${schedule.missed.label} · next ${schedule.next.label}`;
  if (schedule.next) return `next ${schedule.next.label}`;
  return null;
}

export { DAY };
