// Ids are generated on the CLIENT the instant the user taps, before any network
// call. The id is both the primary key and the idempotency key for sync: the
// same id upserted twice is harmless. The server must never generate ids, so
// that offline entries have stable ids from the moment they exist (spec §3.3).

export function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older WebViews: timestamp + entropy is collision-proof enough
  // for a two-phone household.
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand()}${rand()}`;
}
