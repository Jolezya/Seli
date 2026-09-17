// Temperature readings. A 'temp' event holds the reading in `amount` as
// TENTHS of a degree Celsius (382 = 38.2 °C), because `amount` is an integer
// column. The tracker is meant for an illness, not for every day: the card
// draws the line only while there are readings in the last few days.

import { HOUR } from './time.js';

/** 38.0 °C or more is a fever; under three months old that is a call, not a wait. */
export const FEVER_C = 38.0;
export const RECENT_HOURS = 72;
const MIN_C = 34;
const MAX_C = 43;

export function toTenths(celsius) {
  const c = Number(String(celsius).replace(',', '.'));
  if (!Number.isFinite(c) || c < MIN_C || c > MAX_C) return null;
  return Math.round(c * 10);
}

export function toCelsius(tenths) {
  return tenths == null ? null : tenths / 10;
}

/** "38.2 °C" */
export function formatTemp(tenths) {
  const c = toCelsius(tenths);
  return c == null ? '—' : `${c.toFixed(1)} °C`;
}

/** Readings oldest first, with `c` in Celsius; malformed rows dropped. */
export function readings(events) {
  return events
    .filter((e) => e.type === 'temp' && e.amount != null && Number.isFinite(Number(e.amount)))
    .map((e) => ({ ...e, c: Number(e.amount) / 10 }))
    .sort((a, b) => a.start_ts - b.start_ts);
}

export function lastReading(events) {
  const list = readings(events);
  return list.length ? list[list.length - 1] : null;
}

/** Readings in the last RECENT_HOURS, oldest first. */
export function recentReadings(events, now = Date.now(), hours = RECENT_HOURS) {
  const from = now - hours * HOUR;
  return readings(events).filter((r) => r.start_ts >= from && r.start_ts <= now + HOUR);
}

export function isFever(tenths) {
  return tenths != null && tenths >= FEVER_C * 10;
}
