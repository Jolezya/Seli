// Header: identity, date, and the three controls that keep the app honest —
// the sync dot, the refresh button and the theme toggle.

import React, { useEffect, useState } from 'react';
import { STATUS } from '../lib/sync.js';
import { timeAgo, clockTime } from '../lib/time.js';
import { Muted } from '../ui.jsx';

/** Colour and words for each sync state (spec §9.4). */
export function statusPresentation(theme, status) {
  switch (status.state) {
    case STATUS.SYNCED:
      return {
        color: theme.good,
        label: 'Synced',
        detail: status.lastSyncedAt ? `Synced · ${timeAgo(status.lastSyncedAt)}` : 'Synced',
      };
    case STATUS.SYNCING:
      return {
        color: theme.warn,
        label: 'Syncing',
        detail: `Syncing · ${status.pending} pending`,
      };
    case STATUS.ERROR:
      return {
        color: theme.bad,
        label: 'Not syncing',
        detail: `Not syncing · ${status.pending} waiting · ${status.error || 'unknown error'}`,
      };
    default:
      return {
        color: theme.inkFaint,
        label: 'Local only',
        detail: 'Local only · cloud sync is not configured',
      };
  }
}

export default function Header({ theme, status, onRefresh, onToggleTheme, push }) {
  const [expanded, setExpanded] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const s = statusPresentation(theme, status);

  // Tick on the minute boundary itself. Riding the app's 20-second tick would
  // let the displayed minute lag by up to 20 seconds, which is exactly the
  // thing you would notice while staring at a clock at 3am.
  useEffect(() => {
    let timer;
    const schedule = () => {
      const now = new Date();
      setClock(now);
      const msToNextMinute = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
      timer = setTimeout(schedule, msToNextMinute + 20);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  const today = clock.toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  // Deliberately the app's own clockTime rather than a locale time format:
  // every other time in Seli — tile subtitles, log entries — is rendered by it,
  // and a header reading "4:43 PM" above tiles reading "16:43" would be worse
  // than either format on its own.
  const time = clockTime(clock.getTime());

  const refresh = async () => {
    setSpinning(true);
    try { await onRefresh(); } finally { setSpinning(false); }
  };

  const iconButton = {
    appearance: 'none',
    border: `1px solid ${theme.line}`,
    background: 'transparent',
    color: theme.ink,
    width: 34,
    height: 34,
    borderRadius: 11,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 15,
    cursor: 'pointer',
    padding: 0,
  };

  return (
    <header style={{ padding: '4px 2px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{
            margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: theme.ink,
          }}>Seli</h1>
          <Muted theme={theme} style={{ marginTop: 2 }}>
            {today} · <span style={{ fontVariantNumeric: 'tabular-nums' }}>{time}</span>
          </Muted>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            title={s.detail}
            aria-label={`Sync status: ${s.detail}`}
            style={{ ...iconButton, gap: 6, width: 'auto', padding: '0 10px' }}
          >
            <span style={{
              width: 9, height: 9, borderRadius: 999, background: s.color,
              boxShadow: `0 0 8px ${s.color}`, flex: '0 0 auto',
            }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: theme.inkSoft }}>
              {status.pending > 0 ? status.pending : ''}
            </span>
          </button>

          <button
            type="button"
            onClick={refresh}
            title="Sync now"
            aria-label="Sync now"
            style={{
              ...iconButton,
              transform: spinning ? 'rotate(180deg)' : 'none',
              transition: 'transform 400ms ease',
            }}
          >↻</button>

          {push?.available && (
            <button
              type="button"
              onClick={push.onToggle}
              title={push.enabled ? 'Daily reminder is on' : 'Turn on the daily reminder'}
              aria-label={push.enabled ? 'Daily reminder is on' : 'Turn on the daily reminder'}
              style={{ ...iconButton, color: push.enabled ? theme.good : theme.ink }}
            >{push.enabled ? '🔔' : '🔕'}</button>
          )}

          <button
            type="button"
            onClick={onToggleTheme}
            title="Switch day/night theme"
            aria-label="Switch day/night theme"
            style={iconButton}
          >{theme.name === 'night' ? '☾' : '☀'}</button>
        </div>
      </div>

      {expanded && (
        <div
          onClick={() => setExpanded(false)}
          style={{
            marginTop: 10, padding: '10px 12px', borderRadius: 12,
            border: `1px solid ${status.state === STATUS.ERROR ? theme.bad : theme.line}`,
            color: status.state === STATUS.ERROR ? theme.bad : theme.inkSoft,
            fontSize: 12, lineHeight: 1.45, cursor: 'pointer', wordBreak: 'break-word',
          }}
        >
          {s.detail}
        </div>
      )}
    </header>
  );
}
