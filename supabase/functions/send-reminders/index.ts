// Supabase Edge Function: send the daily vitamin-D reminder.
//
// Deploy:   supabase functions deploy send-reminders
// Secrets:  supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
//
// The VAPID PRIVATE key lives only in Supabase secrets. It must never be
// committed, and never shipped to the browser (spec §12, §13).
//
// Scheduled hourly by pg_cron (see the SQL at the bottom of this file). Each
// run sends only to devices whose LOCAL time has just reached their chosen
// reminder hour, so one hourly job serves every timezone.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  // The service_role key stays server-side, inside this function only.
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

/** Local hour for a device, from its stored getTimezoneOffset() in minutes. */
function localHourFor(tzOffsetMinutes: number, now = new Date()): number {
  const localMs = now.getTime() - tzOffsetMinutes * 60_000;
  return new Date(localMs).getUTCHours();
}

Deno.serve(async () => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return new Response(JSON.stringify({ error: 'VAPID keys are not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const { data: subs, error } = await supabase.from('push_subs').select('*');
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  const now = new Date();
  let sent = 0;
  let pruned = 0;

  for (const sub of subs ?? []) {
    const hour = localHourFor(sub.tz_offset ?? 0, now);
    if (hour !== (sub.reminder_hour ?? 9)) continue;

    // Skip households that already logged vitamin D today (local time).
    const startOfLocalDay = Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    ) + (sub.tz_offset ?? 0) * 60_000 - hour * 3_600_000;

    const { count } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('household', sub.household)
      .eq('type', 'vitd')
      .gte('start_ts', startOfLocalDay);

    if ((count ?? 0) > 0) continue;

    try {
      await webpush.sendNotification(sub.subscription, JSON.stringify({
        title: 'ChEckIn',
        body: '💊 Time for vitamin D',
        tag: 'checkin-vitd',
        url: '/',
      }));
      sent += 1;
    } catch (err) {
      // 404/410 means the browser threw the subscription away: drop the row so
      // the list does not fill with dead endpoints.
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await supabase.from('push_subs').delete().eq('endpoint', sub.endpoint);
        pruned += 1;
      }
    }
  }

  return new Response(JSON.stringify({ sent, pruned, checked: subs?.length ?? 0 }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

/*
-- Schedule it hourly (run once in the SQL editor, after deploying):
--
-- select cron.schedule(
--   'checkin-daily-reminder',
--   '0 * * * *',
--   $$
--   select net.http_post(
--     url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-reminders',
--     headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR-ANON-KEY"}'::jsonb
--   );
--   $$
-- );
--
-- Requires the pg_cron and pg_net extensions (Database → Extensions).
*/
