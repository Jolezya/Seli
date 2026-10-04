// Seli on the lock screen while something is running.
//
// iPhone gives Live Activities (the live counter in the Dynamic Island) to
// native apps only, so a web app's nearest equivalent is a notification:
// posted when a sleep or tummy time starts, removed when it ends. The phone
// stamps it "now", "12m ago", "1h ago" and keeps that current, which is the
// running time to the minute. Tapping it opens Seli (public/sw.js).
//
// Posting needs the notification permission, asked once from a tap. The
// decision of what the lock screen should show is a pure function so it can
// be tested; the browser calls around it are best-effort and never throw.

import { clockTime } from './time.js';

const TAG = 'seli-active';
const POSTED_KEY = 'checkin.lockscreen.v1';
export const LOCKSCREEN_EVENT = 'seli-lockscreen';

const RUNNING_TYPES = ['night', 'nap', 'tummy'];
const WORDS = {
  night: { emoji: '😴', name: 'Night sleep' },
  nap: { emoji: '😴', name: 'Nap' },
  tummy: { emoji: '🤸', name: 'Tummy time' },
};

export const LOCKSCREEN_SUPPORTED = typeof window !== 'undefined'
  && 'Notification' in window && 'serviceWorker' in navigator;

export function lockPermission() {
  return LOCKSCREEN_SUPPORTED ? Notification.permission : 'unsupported';
}

/** The session the lock screen should show: the newest one still running. */
export function activeSession(events) {
  return events.find((e) => RUNNING_TYPES.includes(e.type) && e.end_ts == null) || null;
}

/** "😴 Night sleep since 21:30" and a line saying what a tap does. */
export function describe(session) {
  const w = WORDS[session.type] || { emoji: '⏱️', name: 'Running' };
  return {
    title: `${w.emoji} ${w.name} since ${clockTime(session.start_ts)}`,
    body: 'Tap to open Seli and end it.',
  };
}

/**
 * What to do, given what is running and what was last posted:
 *   'post'  — a session is running that has not been put up yet
 *   'close' — nothing should be up, or the feature is off
 *   'keep'  — the right one is already up
 */
export function plan({ enabled, granted, session, postedId }) {
  if (!enabled || !granted || !session) return postedId ? 'close' : 'keep';
  return postedId === session.id ? 'keep' : 'post';
}

function readPosted() {
  try { return localStorage.getItem(POSTED_KEY); } catch { return null; }
}
function writePosted(id) {
  try {
    if (id) localStorage.setItem(POSTED_KEY, id); else localStorage.removeItem(POSTED_KEY);
  } catch { /* storage refused: worst case a repeat post */ }
}

async function registration() {
  try {
    return (await navigator.serviceWorker.getRegistration()) || null;
  } catch {
    return null;
  }
}

async function shownNow(reg) {
  try {
    return typeof reg.getNotifications === 'function' ? await reg.getNotifications({ tag: TAG }) : null;
  } catch {
    return null;
  }
}

async function post(reg, session) {
  const { title, body } = describe(session);
  await reg.showNotification(title, {
    body,
    tag: TAG,
    renotify: false,
    // A sleeping baby is the usual reason this exists: no sound, no buzz,
    // where the phone honours it.
    silent: true,
    requireInteraction: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: '/', id: session.id },
  });
}

async function closeAll(reg) {
  const list = await shownNow(reg);
  for (const n of list || []) n.close();
}

/** Bring the lock screen in line with the events. Never throws. */
export async function syncLockScreen(events, enabled) {
  if (!LOCKSCREEN_SUPPORTED) return;
  try {
    const session = activeSession(events);
    const step = plan({ enabled, granted: Notification.permission === 'granted', session, postedId: readPosted() });
    if (step === 'keep') return;
    const reg = await registration();
    if (!reg) return;
    if (step === 'close') { await closeAll(reg); writePosted(null); return; }
    await closeAll(reg);
    await post(reg, session);
    writePosted(session.id);
  } catch { /* best-effort: the app itself is unaffected */ }
}

/**
 * Leaving the app with a session running: put it back if it was swiped away
 * or opened from, so the lock screen shows it whenever the app is not open.
 */
export async function restoreOnHide(events, enabled) {
  if (!LOCKSCREEN_SUPPORTED || !enabled || Notification.permission !== 'granted') return;
  try {
    const session = activeSession(events);
    if (!session) return;
    const reg = await registration();
    if (!reg) return;
    const shown = await shownNow(reg);
    if (shown && shown.length) return;
    await post(reg, session);
    writePosted(session.id);
  } catch { /* best-effort */ }
}

/**
 * Ask for permission the first time a session is started, from that tap.
 * Only asks while undecided; a "Don't allow" is never asked again.
 */
export function askIfUndecided(enabled) {
  if (!LOCKSCREEN_SUPPORTED || !enabled || Notification.permission !== 'default') return;
  try {
    Promise.resolve(Notification.requestPermission())
      .then(() => window.dispatchEvent(new Event(LOCKSCREEN_EVENT)))
      .catch(() => {});
  } catch { /* older Safari: callback form only; the header button still works */ }
}
