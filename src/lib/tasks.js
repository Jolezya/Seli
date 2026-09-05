// Today's-tasks timing. The list resets at LOCAL midnight (a task is "done"
// when an event of its type exists today), so the deadline every task shares
// is the end of the local day — and that is what the header counts down to.
// Pure functions, so the escalation rules are testable without React.

import { startOfLocalDay, addDays, formatDuration, HOUR, MINUTE } from './time.js';

/** Under this much day left with tasks open, the card nudges (spec §6). */
export const NUDGE_MS = 2 * HOUR;

/** Milliseconds until the next local midnight. Never negative. */
export function msLeftInDay(now = Date.now()) {
  return Math.max(0, addDays(startOfLocalDay(now), 1) - now);
}

/**
 * "9h 32m left" / "45m left" / "under a minute". Whole minutes: seconds
 * would only tick, and nothing here is that urgent.
 */
export function leftLabel(ms) {
  if (ms < MINUTE) return 'under a minute';
  return `${formatDuration(ms)} left`;
}

/**
 * The header's tone, gentle by design and stopping at amber (spec §6):
 *   done  — every task ticked, green.
 *   nudge — under two hours left with tasks open, amber, even in the morning
 *           (a baby born at 22:30 has a short first day).
 *   warn  — afternoon with tasks open, amber.
 *   calm  — otherwise.
 */
export function taskTone({ allDone, now = Date.now() }) {
  if (allDone) return 'done';
  const left = msLeftInDay(now);
  if (left < NUDGE_MS) return 'nudge';
  if (new Date(now).getHours() >= 12) return 'warn';
  return 'calm';
}
