// Reading a backup file, whichever app wrote it.
//
// Seli's own backups carry rows in the database shape (start_ts, end_ts,
// descr). The original ChEckIn app backed up its in-memory shape instead —
// start, end, desc, no household — and that is the file a family brings
// with them. Both must restore, and both must land in THIS household: a
// backup from another Supabase project carries a household phrase that would
// make every restored row invisible here, which is a silent failure of the
// exact kind the spec forbids (§8, §14).

import { ALL_TYPES, isValidEvent, toRow } from './events.js';

const KNOWN = new Set(ALL_TYPES);

/** Lift one entry, in either shape, into Seli's row shape. Null when unusable. */
export function normalizeEntry(entry, household) {
  if (!entry || typeof entry !== 'object') return null;
  const start_ts = entry.start_ts ?? entry.start;
  const end_ts = entry.end_ts ?? entry.end ?? null;
  const descr = entry.descr ?? entry.desc ?? null;
  const candidate = {
    id: entry.id,
    household,
    type: entry.type,
    start_ts,
    end_ts,
    amount: entry.amount ?? null,
    side: entry.side ?? null,
    descr: descr === '' ? null : descr,
  };
  if (!isValidEvent(candidate) || !KNOWN.has(candidate.type)) return null;
  return toRow(candidate);
}

/**
 * Parse a backup payload (already JSON-decoded) into rows for this household.
 * Returns { rows, skipped, source } or { error }.
 */
export function normalizeBackup(payload, household) {
  const incoming = Array.isArray(payload) ? payload : payload?.events;
  if (!Array.isArray(incoming)) return { error: 'That file is not a Seli or ChEckIn backup.' };
  const rows = [];
  let skipped = 0;
  for (const entry of incoming) {
    const row = normalizeEntry(entry, household);
    if (row) rows.push(row); else skipped += 1;
  }
  if (!rows.length) return { error: 'No valid entries found in that file.' };
  const source = payload?.app === 'checker' ? 'ChEckIn' : payload?.app === 'Seli' ? 'Seli' : 'unknown';
  return { rows, skipped, source };
}
