// Configuration. Values come from Vite env vars at build time (set these in
// Vercel → Settings → Environment Variables, or in a local .env file), with an
// optional runtime override on window.__CHECKIN_CONFIG__ so a deploy can be
// re-pointed without a rebuild. See .env.example and README §Configuration.
//
// The anon key and HOUSEHOLD phrase ship in the client on purpose: RLS plus the
// shared phrase are the security model for a family app (spec §13). The only
// real secrets are the VAPID private key and any service_role key — those never
// leave Supabase and must never enter this repo.

const runtime = (typeof window !== 'undefined' && window.__CHECKIN_CONFIG__) || {};
const env = import.meta.env || {};

function pick(key, fallback = '') {
  const v = runtime[key] ?? env[`VITE_${key}`] ?? fallback;
  return typeof v === 'string' ? v.trim() : v;
}

export const SUPABASE_URL = pick('SUPABASE_URL');
export const SUPABASE_ANON_KEY = pick('SUPABASE_ANON_KEY');

// HOUSEHOLD is the shared private phrase that groups this family's rows. BOTH
// phones must set it IDENTICALLY or they silently won't see each other's data —
// a mismatch is the top debugging suspect for "the other phone isn't showing up".
export const HOUSEHOLD = pick('HOUSEHOLD', 'checkin-default-household');

export const VAPID_PUBLIC_KEY = pick('VAPID_PUBLIC_KEY');

/** Supabase is only usable when both the URL and the anon key are present. */
export const CLOUD_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
