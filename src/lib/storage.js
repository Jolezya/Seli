// Thin, defensive localStorage wrapper. Every read is guarded: a corrupt or
// unavailable store (private mode, quota, a half-written value) must degrade to
// a default, never throw and take the app down with it.

const PREFIX = 'checkin.';

export const KEYS = {
  events: `${PREFIX}events.v1`,
  queue: `${PREFIX}queue.v1`,
  prefs: `${PREFIX}prefs.v1`,
};

function available() {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function readJSON(key, fallback) {
  if (!available()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  if (!available()) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded or storage disabled. The in-memory state is still correct,
    // and the outbound queue still carries the write to Supabase.
    return false;
  }
}
