// Patterns: the card that answers "what rhythm is she settling into?"
//
// Everything here refuses to speak beyond its evidence — no trend without a
// real prior window, no next-feed time unless the spacing is genuinely
// consistent (spec §8).

import React, { useMemo, useState } from 'react';
import { Card, CardTitle, Chip, Muted } from '../ui.jsx';
import { categoryColor, categoryTint } from '../theme.js';
import {
  PATTERN_ROWS, hourlyHistogram, patternSummary, feedRhythm, formatGap, diaperWatch,
} from '../lib/analytics.js';
import { clockTime } from '../lib/time.js';

const WINDOWS = [7, 14, 30];
const ROW_CATEGORY = { feeds: 'nurse', sleep: 'night', wet: 'wet', poop: 'poop' };
const NIGHT_HOURS = new Set([20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7]);

export default function PatternsCard({ theme, events, now }) {
  const [days, setDays] = useState(7);
  const [expanded, setExpanded] = useState(null);

  const rhythm = useMemo(() => feedRhythm(events, now), [events, now]);
  const watch = useMemo(() => diaperWatch(events, now), [events, now]);

  return (
    <Card theme={theme}>
      <CardTitle
        theme={theme}
        right={
          <div style={{ display: 'flex', gap: 6 }}>
            {WINDOWS.map((d) => (
              <Chip key={d} theme={theme} active={days === d} onClick={() => setDays(d)}>{d}d</Chip>
            ))}
          </div>
        }
      >Patterns</CardTitle>

      <FeedRhythm theme={theme} rhythm={rhythm} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
        {PATTERN_ROWS.map((row) => (
          <HeatRow
            key={row.key}
            theme={theme}
            row={row}
            events={events}
            days={days}
            now={now}
            expanded={expanded === row.key}
            onToggle={() => setExpanded((cur) => (cur === row.key ? null : row.key))}
          />
        ))}
      </div>

      <Muted theme={theme} size={11} style={{ marginTop: 12 }}>
        {theme.name === 'night' ? 'Brighter' : 'Darker'} = more often · tap a row name for hourly detail
      </Muted>

      {watch && (
        <Muted theme={theme} size={11.5} style={{ marginTop: 8, color: theme.warn }}>{watch}</Muted>
      )}
    </Card>
  );
}

function FeedRhythm({ theme, rhythm }) {
  const accent = categoryColor(theme, 'nurse');
  return (
    <div style={{
      borderRadius: 14,
      background: categoryTint(theme, 'nurse', theme.name === 'night' ? 0.16 : 0.10),
      padding: '11px 12px',
    }}>
      {rhythm.hasData ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 650, color: theme.ink }}>
            Feeds every ~{formatGap(rhythm.typicalGapMs)}
          </div>
          {rhythm.steadiness && (
            <Muted theme={theme} size={11.5} style={{ marginTop: 2 }}>
              Spacing is {rhythm.steadiness === 'same' ? 'about the same as' : `${rhythm.steadiness} than`} last week
            </Muted>
          )}
          <div style={{ fontSize: 12.5, marginTop: 4, color: rhythm.prediction ? accent : theme.inkSoft, fontWeight: rhythm.prediction ? 600 : 400 }}>
            {rhythm.prediction
              ? `Next feed likely around ${clockTime(rhythm.prediction)}`
              : rhythm.message}
          </div>
        </>
      ) : (
        <Muted theme={theme} size={12.5}>{rhythm.message}</Muted>
      )}
    </div>
  );
}

function HeatRow({ theme, row, events, days, now, expanded, onToggle }) {
  const accent = categoryColor(theme, ROW_CATEGORY[row.key]);
  const hist = useMemo(() => hourlyHistogram(events, row.types, days, now), [events, row.types, days, now]);
  const summary = useMemo(() => patternSummary(events, row.types, days, now), [events, row.types, days, now]);
  const max = Math.max(...hist, 1);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <button
          type="button"
          onClick={onToggle}
          style={{
            appearance: 'none', border: 'none', background: 'transparent', padding: 0,
            color: theme.ink, fontSize: 12.5, fontWeight: 650, cursor: 'pointer',
          }}
        >{row.label} {expanded ? '▾' : '▸'}</button>
        <Muted theme={theme} size={11} style={{ textAlign: 'right' }}>
          {summary.perDay.toFixed(1)}/day
          {summary.peakHour != null && ` · most often ~${String(summary.peakHour).padStart(2, '0')}:00`}
          {/* A trend appears ONLY when the prior window genuinely has data. */}
          {summary.trend && (
            <span style={{ color: summary.trend.direction === 'up' ? theme.good : theme.inkSoft }}>
              {' · '}{summary.trend.direction === 'up' ? '↑' : summary.trend.direction === 'down' ? '↓' : '→'}
              {Math.abs(summary.trend.delta).toFixed(1)} vs prior {days}d
            </span>
          )}
        </Muted>
      </div>

      <div style={{ display: 'flex', gap: 1.5, marginTop: 5 }}>
        {hist.map((count, hour) => (
          <div
            key={hour}
            title={`${String(hour).padStart(2, '0')}:00 — ${count}`}
            style={{
              flex: 1,
              height: 16,
              borderRadius: 2.5,
              minWidth: 0,
              background: count > 0 ? accent : theme.line,
              opacity: count > 0 ? 0.25 + 0.75 * (count / max) : (NIGHT_HOURS.has(hour) ? 0.55 : 0.3),
              boxShadow: NIGHT_HOURS.has(hour) && count === 0 ? `inset 0 0 0 10px ${theme.bgTint}` : 'none',
            }}
          />
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
        {['00', '06', '12', '18'].map((h) => (
          <span key={h} style={{ fontSize: 8.5, color: theme.inkFaint }}>{h}</span>
        ))}
      </div>

      {expanded && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {hist.map((count, hour) => count > 0 && (
            <span key={hour} style={{
              fontSize: 10, color: theme.inkSoft, border: `1px solid ${theme.line}`,
              borderRadius: 6, padding: '2px 5px', fontVariantNumeric: 'tabular-nums',
            }}>{String(hour).padStart(2, '0')}:00 · {count}</span>
          ))}
          {summary.count === 0 && <Muted theme={theme} size={11}>Nothing logged in this window.</Muted>}
        </div>
      )}
    </div>
  );
}
