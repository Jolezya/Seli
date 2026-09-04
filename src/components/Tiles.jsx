// The tile grid: five large targets, tappable one-handed at 3am.
//
// Two behaviours only — one-tap point events, and one timed activity, sleep,
// which starts on the first tap and ends on the second. Sleep spans the row:
// it is the one thing that runs for hours, and the width carries the last
// 24 hours' total beside "since when". Tummy time lives in the task list,
// where its daily-minutes goal is the point (spec §5, §6).

import React, { useMemo, useState } from 'react';
import { Pressable, IconWell, Eyebrow, haptic, surfaceStyle } from '../ui.jsx';
import { categoryColor, categoryTint } from '../theme.js';
import { timeAgo, clockTime, formatDuration, HOUR } from '../lib/time.js';
import { SLEEP_TYPES, openSleep, lastSleep, lastOfType } from '../lib/events.js';
import { predictNext, windowTotals } from '../lib/analytics.js';

/**
 * Five tiles. `types` is what a tile reads; `mode` is what a tap does. Sleep
 * reads both kinds and lets the clock decide which kind a tap starts.
 */
export const TILES = [
  { key: 'nurse',  types: ['nurse'],  label: 'Nursing',      emoji: '🤱', category: 'nurse', mode: 'point',  subtitle: 'last feed',   canUpdate: true },
  { key: 'bottle', types: ['bottle'], label: 'Bottle',       emoji: '🍼', category: 'bottle', mode: 'amount', subtitle: 'last bottle' },
  { key: 'sleep',  types: SLEEP_TYPES, label: 'Sleep',       emoji: '😴', category: 'night', mode: 'sleep',  subtitle: 'last sleep',  canUpdate: true, wide: true },
  { key: 'wet',    types: ['wet'],    label: 'Wet diapers',  emoji: '💧', category: 'wet',   mode: 'point',  subtitle: 'last change' },
  { key: 'poop',   types: ['poop'],   label: 'Poop diapers', emoji: '💩', category: 'poop',  mode: 'point',  subtitle: 'last change' },
];

export const BOTTLE_AMOUNTS = [30, 60, 90, 120, 150];

const KIND_LABEL = { night: 'Night sleep', nap: 'Nap' };

export default function Tiles({ theme, events, store, now }) {
  const [chooser, setChooser] = useState(null); // key of the tile whose amount chooser is open

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: 12,
      marginBottom: 14,
    }}>
      {TILES.map((tile) => (
        <Tile
          key={tile.key}
          tile={tile}
          theme={theme}
          events={events}
          store={store}
          now={now}
          chooserOpen={chooser === tile.key}
          onOpenChooser={(open) => setChooser(open ? tile.key : null)}
        />
      ))}
    </div>
  );
}

function Tile({ tile, theme, events, store, now, chooserOpen, onOpenChooser }) {
  const accent = categoryColor(theme, tile.category);
  const isSleep = tile.mode === 'sleep';

  const last = isSleep ? lastSleep(events) : lastOfType(events, tile.key);
  const open = isSleep ? openSleep(events) : null;
  const running = Boolean(open);

  // The moment this tile counts from: when a sleep ENDED, or when a point
  // event happened.
  const reference = last ? (last.end_ts ?? last.start_ts) : null;
  const prediction = tile.key === 'nurse' ? null : predictNext(events, tile.types, now);

  const handleTap = () => {
    if (isSleep) { store.toggleSleep(); return; }
    if (tile.mode === 'amount') { onOpenChooser(!chooserOpen); return; }
    store.logPoint(tile.key);
  };

  const value = running
    ? 'Sleeping'
    : (reference ? timeAgo(reference, now) : 'never');

  const subtitle = running
    ? `${KIND_LABEL[open.type]} since ${clockTime(open.start_ts)} · tap to end`
    : (reference
      ? `${isSleep && last ? `${KIND_LABEL[last.type].toLowerCase()} ended` : tile.subtitle} ${clockTime(reference)}`
      : 'tap to log');

  return (
    <Pressable
      onClick={handleTap}
      ariaLabel={`${tile.label}: ${value}`}
      style={{
        ...surfaceStyle(theme, { radius: 24 }),
        // Clipping lives on the CONTAINER. Never on the text line, or the tails
        // of g/y/j in "ago" and "just" get sheared off (spec §5.3).
        overflow: 'hidden',
        padding: 14,
        minHeight: 148,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        gridColumn: tile.wide ? '1 / -1' : 'auto',
        ...(running ? {
          background: `linear-gradient(180deg, ${categoryTint(theme, tile.category, 0.20)} 0%, ${theme.surfaceBottom} 100%)`,
          boxShadow: [
            `inset 0 0 0 1.5px ${accent}`,
            theme.highlight,
            theme.shadowContact,
            `0 8px 26px ${categoryTint(theme, tile.category, 0.35)}`,
          ].join(', '),
        } : null),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <IconWell theme={theme} category={tile.category} char={tile.emoji} />
        {running
          ? <PulseDot color={accent} />
          : (tile.canUpdate && last && <UpdatePill theme={theme} accent={accent} onTap={() => store.bumpLast(tile.key)} />)}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, minWidth: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Eyebrow theme={theme} color={running ? accent : theme.inkSoft}>{tile.label}</Eyebrow>
          <div style={{
            fontSize: 22,
            fontWeight: 650,
            letterSpacing: '-0.02em',
            color: theme.ink,
            fontVariantNumeric: 'tabular-nums',
            // Room for descenders: generous line-height and a hair of padding.
            lineHeight: 1.25,
            padding: '2px 0 3px',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            marginTop: 3,
          }}>{value}</div>
          <div style={{
            fontSize: 11.5, color: theme.inkSoft, whiteSpace: 'nowrap',
            textOverflow: 'ellipsis', overflow: 'hidden', lineHeight: 1.35,
          }}>{subtitle}</div>
          {prediction && !running && (
            <div style={{ fontSize: 11, color: theme.inkFaint, marginTop: 2 }}>
              next ≈ {clockTime(prediction)}
            </div>
          )}
        </div>

        {/* The wide tile's second column: what the last day of sleep added up to. */}
        {isSleep && <SleepSummary theme={theme} events={events} now={now} />}
      </div>

      {chooserOpen && tile.mode === 'amount' && (
        <AmountChooser
          theme={theme}
          accent={accent}
          onPick={(ml) => {
            store.logPoint('bottle', { amount: ml });
            onOpenChooser(false);
          }}
          onClose={() => onOpenChooser(false)}
        />
      )}
    </Pressable>
  );
}

/** Last 24 hours of sleep, split the way the clock split it. */
function SleepSummary({ theme, events, now }) {
  const totals = useMemo(() => windowTotals(events, now - 24 * HOUR, now + 1, now), [events, now]);
  const naps = useMemo(
    () => events.filter((e) => e.type === 'nap' && e.start_ts >= now - 24 * HOUR && e.start_ts <= now).length,
    [events, now],
  );
  if (!totals.sleepMin) return null;
  return (
    <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
      <div style={{ fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: theme.inkFaint, fontWeight: 700 }}>
        last 24 h
      </div>
      <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: '-0.02em', color: theme.ink, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums' }}>
        {formatDuration(totals.sleepMin * 60_000)}
      </div>
      <div style={{ fontSize: 11, color: theme.inkSoft, whiteSpace: 'nowrap' }}>
        {naps} {naps === 1 ? 'nap' : 'naps'} · night {formatDuration(totals.nightMin * 60_000)}
      </div>
    </div>
  );
}

/**
 * The Update pill: moves the last session's end to now WITHOUT creating a row,
 * so cluster feeds keep "time since last feed" honest without five entries
 * (spec §5.2). Its tap must not fall through to the tile.
 */
function UpdatePill({ theme, accent, onTap }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); haptic(); onTap(); }}
      style={{
        appearance: 'none',
        border: `1px solid ${accent}`,
        background: 'transparent',
        color: accent,
        borderRadius: 999,
        padding: '4px 9px',
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '0.02em',
        cursor: 'pointer',
        flex: '0 0 auto',
      }}
    >Update</button>
  );
}

function PulseDot({ color }) {
  return (
    <span style={{
      width: 10, height: 10, borderRadius: 999, background: color,
      boxShadow: `0 0 10px ${color}`, animation: 'seli-pulse 1.8s ease-in-out infinite',
      flex: '0 0 auto', marginTop: 4,
    }} />
  );
}

function AmountChooser({ theme, accent, onPick, onClose }) {
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        inset: 0,
        background: theme.name === 'night' ? 'rgba(12,12,17,0.94)' : 'rgba(255,255,255,0.95)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 12,
        justifyContent: 'center',
      }}
    >
      <div style={{ fontSize: 10.5, letterSpacing: '0.09em', textTransform: 'uppercase', color: theme.inkSoft, fontWeight: 700 }}>
        Bottle ml
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {BOTTLE_AMOUNTS.map((ml) => (
          <button
            key={ml}
            type="button"
            onClick={() => { haptic(); onPick(ml); }}
            style={{
              appearance: 'none', border: `1px solid ${accent}`, background: 'transparent',
              color: accent, borderRadius: 10, padding: '8px 10px', fontSize: 13,
              fontWeight: 700, cursor: 'pointer', flex: '1 0 28%',
            }}
          >{ml}</button>
        ))}
      </div>
      <button
        type="button"
        onClick={onClose}
        style={{
          appearance: 'none', border: 'none', background: 'transparent',
          color: theme.inkFaint, fontSize: 11.5, cursor: 'pointer', padding: 2,
        }}
      >cancel</button>
    </div>
  );
}
