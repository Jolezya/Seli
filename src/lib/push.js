// Push notifications (spec §12) — entirely optional. Every entry point here
// returns false when VAPID_PUBLIC_KEY is unset, so a deployment without push
// configured behaves exactly as if this file did not exist.

import { VAPID_PUBLIC_KEY, HOUSEHOLD, CLOUD_CONFIGURED } from './config.js';

export const PUSH_AVAILABLE = Boolean(
  VAPID_PUBLIC_KEY && CLOUD_CONFIGURED &&
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
);

/** VAPID keys are base64url; PushManager wants raw bytes. */
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Is this device already subscribed? */
export async function currentSubscription() {
  if (!PUSH_AVAILABLE) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/**
 * Subscribe this device to the daily reminder and store it in `push_subs`.
 * The row carries the household and the device's timezone offset so the
 * scheduled job can fire at the right LOCAL hour.
 */
export async function subscribe(client, reminderHour = 9) {
  if (!PUSH_AVAILABLE) return { ok: false, error: 'Push notifications are not configured.' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, error: 'Notifications were not allowed.' };

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  const json = subscription.toJSON();
  const { error } = await client.from('push_subs').upsert({
    endpoint: json.endpoint,
    household: HOUSEHOLD,
    subscription: json,
    reminder_hour: reminderHour,
    tz_offset: new Date().getTimezoneOffset(),
  }, { onConflict: 'endpoint' });

  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}

/** Unsubscribe this device and forget the row. */
export async function unsubscribe(client) {
  const subscription = await currentSubscription();
  if (!subscription) return { ok: true, error: null };
  const { endpoint } = subscription.toJSON();
  await subscription.unsubscribe();
  const { error } = await client.from('push_subs').delete().eq('endpoint', endpoint);
  return { ok: !error, error: error?.message || null };
}
