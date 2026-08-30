-- ChEckIn — complete Supabase schema.
--
-- Run this whole file in the Supabase SQL editor. Run it AS ONE UNIT every
-- time: the table and its row-level-security policy belong together. A table
-- with RLS enabled and no policy still serves reads from cache while silently
-- rejecting every INSERT — the failure that made the original app "stop
-- saving" invisibly for days.

-- ---------------------------------------------------------------------------
-- 1. The one table. Every feed, nappy, nap, weigh-in, note and task is a row.
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  id        text primary key,   -- client-generated; also the idempotency key
  household text,               -- shared secret phrase grouping one family
  type      text,               -- nurse|bottle|nap|night|tummy|wet|poop|
                                --   vitd|weight|note|massage|exercise
  start_ts  bigint,             -- event start, UNIX epoch MILLISECONDS
  end_ts    bigint,             -- event end in ms, or NULL
  amount    integer,            -- bottle ml, or weight in grams; else NULL
  side      text,               -- who gave the vitamin D; else NULL
  descr     text                -- note body; else NULL
);

-- Reads are always "everything for this household, newest first".
create index if not exists events_household_start_idx
  on public.events (household, start_ts desc);

-- ---------------------------------------------------------------------------
-- 2. Row Level Security. CRITICAL — do not skip, do not run separately.
-- ---------------------------------------------------------------------------

alter table public.events enable row level security;

drop policy if exists "anon full access" on public.events;
create policy "anon full access" on public.events
  for all to anon using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 3. Realtime, so the other phone sees a feed within seconds.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.events;

-- ---------------------------------------------------------------------------
-- 4. Push notification subscriptions (OPTIONAL — only needed for §12).
-- ---------------------------------------------------------------------------

create table if not exists public.push_subs (
  endpoint     text primary key,
  household    text,
  subscription jsonb not null,   -- the full PushSubscription JSON
  reminder_hour integer default 9,
  tz_offset    integer default 0, -- minutes returned by Date.getTimezoneOffset()
  created_at   timestamptz default now()
);

alter table public.push_subs enable row level security;

drop policy if exists "anon manage own subs" on public.push_subs;
create policy "anon manage own subs" on public.push_subs
  for all to anon using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 5. Health check. Run this FIRST whenever writes mysteriously stop.
-- ---------------------------------------------------------------------------
--
--   select policyname, cmd from pg_policies where tablename = 'events';
--
-- One row back ("anon full access", ALL) means the policy is in place. No rows
-- means every write is being rejected — re-run section 2 above.
