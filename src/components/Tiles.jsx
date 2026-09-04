// The tile grid: six equal targets, tappable one-handed at 3am.
//
// Two behaviours only — one-tap point events, and one timed activity, sleep,
// which starts on the first tap and ends on the second. Tummy time lives in
// the task list, where its daily-minutes goal is the point (spec §5, §6).

import React, { useState } from 'react';
import { Pressable, IconWell, Eyebrow, haptic, surfaceStyle } from '../ui.jsx';
import { categoryColor, categoryTint } from '../theme.js';
import { timeAgo, clockTime, whenLabel, daysBetween } from '../lib/time.js';
import { SLEEP_TYPES, openSleep, lastSleep, lastOfType } from '../lib/events.js';
import { predictNext } from '../lib/analytics.js';
import { formatGrams } from '../lib/weight.js';

/**
 * Six tiles, 3 rows x 2. `types` is what a tile reads; `mode` is what a tap
 * does. Sleep reads both kinds and lets the clock decide which a tap starts.
 * Bath and Weight are the low-frequency tiles, and that is their point: the
 * recurring questions are "when did we last bathe her?" and "what did she
 * weigh, and when?". This household breastfeeds only, so there is no bottle
 * tile; the type still exists for the analytics and the day log.
 */
export const TILES = [
  { key: 'nurse',  types: ['nurse'],   label: 'Nursing',      emoji: '🤱', category: 'nurse',  mode: 'point',  subtitle: 'last feed',   canUpdate: true },
  { key: 'weight', types: ['weight'],  label: 'Weight',       emoji: '⚖️', category: 'weight', mode: 'weight' },
  { key: 'sleep',  types: SLEEP_TYPES, label: 'Sleep',        emoji: '😴', category: 'night',  mode: 'sleep',  subtitle: 'last sleep',  canUpdate: true },
  { key: 'bath',   types: ['bath'],    label: 'Bath',         emoji: '🛁', category: 'bath',   mode: 'point',  subtitle: 'last bath', days: true },
  { key: 'wet',    types: ['wet'],     label: 'Wet diapers',  emoji: '💧', category: 'wet',    mode: 'point',  subtitle: 'last change' },
  { key: 'poop',   types: ['poop'],    label: 'Poop diapers', emoji: '💩', category: 'poop',   mode: 'point',  subtitle: 'last change' },
];

const KIND_LABEL = { night: 'Night sleep', nap: 'Nap' };

/**
 * For the tiles whose question is "how many days" — bath, and the weigh-in
 * caption — hours are noise: "45h 8m ago" should read "yesterday".
 */
function daysAgo(ts, now) {
  const days = -daysBetween(now, ts);
  if (days <= 0) return timeAgo(ts, now);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

/** Weigh-ins are stamped at local noon, so the honest unit is the day. */
function weighedLabel(ts, now) {
  const days = -daysBetween(now, ts);
  if (days <= 0) return 'weighed today';
  if (days === 1) return 'weighed yesterday';
  return `${days}d ago · ${new Date(ts).toLocaleDateString(undefined, { weekday: 'short' })}`;
}

export default function Tiles({ theme, events, store, now }) {
  const [chooser, setChooser] = useState(null); // key of the tile whose entry overlay is open

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
  const isWeight = tile.mode === 'weight';

  const last = isSleep ? lastSleep(events) : lastOfType(events, tile.key);
  const open = isSleep ? openSleep(events) : null;
  const running = Boolean(open);

  // The moment this tile counts from: when a sleep ENDED, or when a point
  // event happened.
  const reference = last ? (last.end_ts ?? last.start_ts) : null;
  const prediction = tile.key === 'nurse' || isWeight ? null : predictNext(events, tile.types, now);

  const handleTap = () => {
    if (isSleep) { store.toggleSleep(); return; }
    if (isWeight) { onOpenChooser(!chooserOpen); return; }
    store.logPoint(tile.key);
  };

  // Weight inverts the tile: the grams are the big number, because the value
  // is what you want at a glance, and "when" moves to the subtitle.
  const value = running
    ? 'Sleeping'
    : isWeight
      ? (last ? formatGrams(last.amount) : 'never')
      : (reference ? (tile.days ? daysAgo(reference, now) : timeAgo(reference, now)) : 'never');

  const subtitle = running
    ? `${KIND_LABEL[open.type]} since ${clockTime(open.start_ts)} · tap to end`
    : isWeight
      ? (last ? weighedLabel(last.start_ts, now) : 'tap to add')
      : (reference
        ? `${isSleep && last ? `${KIND_LABEL[last.type].toLowerCase()} ended` : tile.subtitle} ${whenLabel(reference, now)}`
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
        // Tall enough for the three-line case (value, subtitle, "next ≈"), so a
        // row whose tiles have only two lines is the same height as the rest
        // and the grid stays perfectly symmetric.
        minHeight: 156,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
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

      <div style={{ minWidth: 0 }}>
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

      {chooserOpen && isWeight && (
        <WeightEntry
          theme={theme}
          accent={accent}
          initial={last ? last.amount : ''}
          onSave={(grams) => {
            if (store.setWeight(now, grams)) onOpenChooser(false);
          }}
          onClose={() => onOpenChooser(false)}
        />
      )}
    </Pressable>
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

/**
 * A weigh-in without leaving the grid: grams for today, prefilled with the
 * last reading so a correction or a small gain is a two-tap job. Backdating
 * still lives on the Weight card, which has the date field.
 */
function WeightEntry({ theme, accent, initial, onSave, onClose }) {
  const [grams, setGrams] = useState(initial === '' ? '' : String(initial));
  const submit = (e) => { e.preventDefault(); onSave(grams); };
  return (
    <form
      onSubmit={submit}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        inset: 0,
        background: theme.surface,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        justifyContent: 'center',
      }}
    >
      <div style={{ fontSize: 10.5, letterSpacing: '0.09em', textTransform: 'uppercase', color: theme.inkSoft, fontWeight: 700 }}>
        Weight today · grams
      </div>
      <input
        autoFocus
        type="number"
        inputMode="numeric"
        min="500"
        max="20000"
        value={grams}
        onChange={(e) => setGrams(e.target.value)}
        onFocus={(e) => e.target.select()}
        style={{
          width: '100%', border: `1px solid ${accent}`, background: theme.surface, color: theme.ink,
          borderRadius: 10, padding: '8px 10px', fontSize: 18, fontWeight: 650, fontVariantNumeric: 'tabular-nums',
        }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="submit"
          onClick={() => haptic()}
          style={{
            appearance: 'none', border: 'none', background: accent, color: '#fff',
            borderRadius: 10, padding: '8px 10px', fontSize: 13, fontWeight: 700, cursor: 'pointer', flex: 1,
          }}
        >Save</button>
        <button
          type="button"
          onClick={onClose}
          style={{
            appearance: 'none', border: `1px solid ${theme.line}`, background: 'transparent',
            color: theme.inkSoft, borderRadius: 10, padding: '8px 10px', fontSize: 13, cursor: 'pointer',
          }}
        >cancel</button>
      </div>
    </form>
  );
}
