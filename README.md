# ChEckIn

A baby-tracking Progressive Web App for two parents and one newborn. One screen,
big tappable tiles, works offline, syncs between phones.

**Prime directive: never lose data.** Every design decision here bows to that.
A logged feed survives app restarts, network drops and one phone being offline.
Deleting is always explicit and always undoable.

**Second directive: silent failure is the enemy.** The sync dot in the header
turns red — with the real error text — the moment a write is rejected.

---

## Quick start

```bash
npm install
cp .env.example .env      # fill in your Supabase URL, anon key and HOUSEHOLD
npm run dev               # http://localhost:5173
```

The app runs with **no backend at all** — it just keeps everything on the
device and shows a grey "local only" dot. Add Supabase when you want the two
phones to see each other's entries.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the test suite |
| `npm run icons` | Regenerate the PWA icons |

---

## Setting up Supabase (10 minutes)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run [`supabase/schema.sql`](supabase/schema.sql)
   **in full, as one unit.** It creates the table, the row-level-security
   policy and the realtime publication together — see the warning below.
3. Copy **Project Settings → API → Project URL** and the **anon/public** key
   into your `.env` (locally) and into Vercel's environment variables.
4. Choose a long private `HOUSEHOLD` phrase and set **exactly the same value on
   both phones**.

### ⚠️ Row Level Security — read this before debugging anything else

Supabase enables RLS on new tables by default. **With RLS on and no policy,
reads of already-cached rows keep working while every INSERT is silently
rejected.** That is precisely how the original app "stopped saving" invisibly
for days.

`schema.sql` ships the table and its policy together. If writes ever stop, check
this first:

```sql
select policyname, cmd from pg_policies where tablename = 'events';
```

One row back (`anon full access`, `ALL`) means you are fine. No rows means every
write is being rejected — re-run section 2 of `schema.sql`.

### The HOUSEHOLD phrase

`HOUSEHOLD` is written into every row and used to filter reads and realtime. It
is what lets two phones share one baby's data while staying private. **If the
two devices have different values they will silently not see each other's
entries** — treat a mismatch as the first suspect whenever "the other phone
isn't showing up".

The anon key and the household phrase ship in the client on purpose: RLS plus a
private phrase are the security model for a family app. The only real secrets
are the `service_role` key and the VAPID private key, and neither ever leaves
Supabase.

---

## Deploying to Vercel

1. Push this repo to GitHub.
2. In Vercel, **Add New → Project** and import that repo. Framework preset:
   **Vite**. Build command `npm run build`, output directory `dist`.
3. Add the environment variables from `.env.example` under
   **Settings → Environment Variables**.
4. Push to `main`. Vercel builds and deploys automatically.

### Three traps that cost the original days

1. **Vercel watching the wrong repo.** The original was connected to a repo path
   that no longer existed, so pushes never triggered builds and "Redeploy" only
   ever rebuilt stale code. Check **Settings → Git** points at the live repo, and
   confirm a trivial push produces a **new deployment dated now** — not a
   "Redeploy of" an old commit. If auto-deploy doesn't fire, fix the Git
   connection; don't keep redeploying.
2. **Stale service worker.** Phones can serve cached old code after a deploy.
   The cache version is stamped automatically on every build by the Vite plugin
   in `vite.config.js`, and old caches are deleted on activate — but still test
   the live URL in an **incognito window** first, before trusting the installed
   PWA.
3. **Missing table or RLS policy.** See the RLS section above. If saves stop,
   check the policy before anything else.

---

## How it works

### One table

Every action — a feed, a diaper, a nap, a weigh-in, a note, a task — is one row
in `events`. There are no other tables (except the optional `push_subs`). This
radical simplicity is deliberate.

Four choices in the data model prevent whole categories of bugs:

- **One table** — nothing to join, nothing to keep consistent.
- **Client-owned ids** — generated on tap, before any network call, so an
  offline entry has a stable id from the moment it exists and re-sending it is
  idempotent.
- **Millisecond timestamps** (`Date.now()`, stored in `bigint`) — no timezone
  ambiguity in storage.
- **Local-day grouping** — "today" is computed in the device's local timezone.
  A feed at 00:30 local falls on the *previous* UTC day; comparing against UTC
  days would make it vanish from Today.

### Sync: local-first with a durable queue

```
tap → local state + localStorage → outbound queue → Supabase → realtime → other phone
      └─ safe here already ─┘                       └─ only now does the dot go green ─┘
```

1. **Local state is the source of truth for the UI.** It renders instantly and
   works offline.
2. **Every mutation is optimistic** — state first, then the queue. The user
   never waits for the network.
3. **The outbound queue lives in localStorage**, so it survives reloads and
   crashes. It drains in order; a failure stops the drain with the item still in
   place and everything behind it intact.
4. **Reconciliation merges by id.** A server snapshot never erases a local row
   that is still queued, and never resurrects one whose delete hasn't flushed.
5. **Realtime payloads are deltas, not snapshots** — merged by id, never
   replacing the array.

### The sync dot

| Colour | Meaning |
|---|---|
| 🟢 green | Queue empty, last write **acknowledged by Supabase** |
| 🟠 amber | Work pending or a flush in flight |
| 🔴 red | The last flush failed — tap the dot for the actual error text |
| ⚪ grey | Supabase not configured; local only |

The dot reflects *confirmed persistence*, never the optimistic local update.
It is the direct countermeasure to the original's worst bug: had it existed, a
multi-day outage would have been caught in seconds. The **↻** button beside it
force-flushes the queue and re-pulls everything.

### Never fabricating a signal

Analytics stay silent rather than guess:

- A week-over-week **trend** appears only when the prior window really has data
  (≥3 events spanning at least half the window). A brand-new user never sees
  "↑7.8 vs prior 14d" invented from nothing.
- A **next-feed prediction** appears only when the spacing between feeds is
  genuinely consistent (coefficient of variation ≤ 0.33). Otherwise it says
  "Rhythm still settling — no reliable next-feed time yet."

---

## Project layout

```
src/
  lib/
    time.js        local-day grouping, "2h 5m ago", input round-trips
    events.js      the event model, mergeById, reconcile
    queue.js       the durable outbound queue
    sync.js        SyncEngine: flush, pull, realtime, status
    analytics.js   comparison series, heatmap, feed rhythm, predictions
    weight.js      weigh-ins, nadir, expected trajectory, projection
    files.js       backup / restore / CSV export
    push.js        optional push subscription
    config.js      env vars + optional runtime override
  components/      Header, TaskCard, Tiles, WeightCard, ComparisonChart,
                   PatternsCard, DayLog, Toast
  store.js         the one hook that owns events, sync and prefs
  theme.js         design tokens + automatic day/night
tests/             74 tests over the logic that must not break
supabase/
  schema.sql       table + RLS policy + realtime (run as one unit)
  functions/       optional push reminder edge function
```

---

## Testing

```bash
npm test
```

The suite covers what actually breaks: local-day boundaries, the merge and
reconcile rules that stop entries vanishing, queue ordering under failure, the
"don't fabricate a trend" rules, and the weight projection maths.

Three of these tests exist because they caught real bugs during the build:

- A weight row with a null amount read as a **0 g weigh-in** (`Number(null)` is `0`).
- A second `flush()` arriving while one was in flight **returned a stale status**,
  so the caller could report success over a failing queue.
- Analytics windows bounded at the render clock **dropped a just-logged feed**,
  showing "0.0/day" beside a tile that said "just now".

### Manual checks worth doing on a real phone

- Airplane-mode a phone, log several events, re-enable the network → everything
  syncs, nothing is lost, order preserved.
- Two phones with the same `HOUSEHOLD` see each other's entries within seconds.
- Temporarily drop the RLS policy → the dot goes red with the real message.
- Tap Wet, wait a minute with the other phone open → the entry stays on both
  phones and in the database.

---

## Optional: push notifications

A daily "give vitamin D" reminder. The whole feature is gated behind
`VITE_VAPID_PUBLIC_KEY` — leave it blank and the app behaves as if push did not
exist (no bell button, no permission prompt).

1. Generate a key pair: `npx web-push generate-vapid-keys`
2. Put the **public** key in `VITE_VAPID_PUBLIC_KEY`.
3. Keep the **private** key in Supabase only:
   `supabase secrets set VAPID_PRIVATE_KEY=... VAPID_PUBLIC_KEY=... VAPID_SUBJECT=mailto:you@example.com`
4. `supabase functions deploy send-reminders`
5. Schedule it hourly with pg_cron — the SQL is at the bottom of
   [`supabase/functions/send-reminders/index.ts`](supabase/functions/send-reminders/index.ts).

The hourly job only notifies devices whose *local* time has reached their chosen
reminder hour, and skips households that already logged vitamin D today.

> This part has been written and type-checked but not exercised against a live
> Supabase project — it needs your own VAPID keys to run end to end. The core app
> does not depend on it.

---

## Principles carried into every decision

- **Local-first, always.** The UI reads local state; the network is a background
  reconciler.
- **Confirm persistence before showing "synced".**
- **Make failures loud.** Silent write failures are the expensive kind.
- **Deleting is sacred.** Only on explicit user action, always undoable, never as
  a side effect of "cleanup". No automatic cleanup may ever touch one-tap events
  — `wet`, `poop`, `vitd` and `note` all legitimately have a null `end_ts`, and a
  dedupe keyed on that would delete real entries.
- **Bump the cache, verify the deploy, check RLS** — the three-item preflight
  whenever "nothing is updating" or "nothing is saving".
