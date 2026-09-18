// Overview: "what happened in the last day, and is that normal?"
//
// Three views of the same events, each answering a different question a
// parent actually has:
//   1. The last 24 hours against the household's usual — is today normal?
//   2. The last 24 hours laid out on a clock — what shape did the day have?
//   3. The last week (or two, or four) day by day — which way is it going?
//
// Every window here ends *now* rather than at midnight. At 3am "today" holds
// three hours of data and answers nothing; the last 24 hours is a full picture
// at any hour, and it compares fairly against whole-day averages because both
// are 24 hours long.

import React, { useMemo, useState } from 'react';
import { Card, CardTitle, Chip, Muted, Button } from '../ui.jsx';
import { categoryColor, categoryTint } from '../theme.js';
import {
  dailyTotals, windowTotals, baseline, timelineData, longestSleep,
  feedGapInWindow, formatGap, BASELINE_MIN_DAYS,
  periodRange, usualByElapsed, suspectSleeps,
} from '../lib/analytics.js';
import {
  HOUR, MINUTE, clockTime, formatDuration, dayLabel, startOfLocalDay, addDays,
  toDateInput, fromDateInput, dayKey, shortDate, timeAgo,
} from '../lib/time.js';
import { readings as tempReadings, isFever, FEVER_C, formatTemp } from '../lib/temp.js';


/** The four things the overview tracks, in a fixed order that never changes. */
const METRICS = [
  { key: 'feeds',    label: 'Feeds', category: 'nurse', unit: 'count' },
  { key: 'sleepMin', label: 'Sleep', category: 'night', unit: 'minutes' },
  { key: 'wet',      label: 'Wet',   category: 'wet',   unit: 'count' },
  { key: 'poop',     label: 'Poop',  category: 'poop',  unit: 'count' },
];

function formatValue(metric, value) {
  if (metric.unit === 'minutes') {
    if (value < 60) return `${Math.round(value)}m`;
    return `${(value / 60).toFixed(1)}h`;
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** A period as the picker holds it. */
const DEFAULT_A = { kind: 'today', date: null };
const DEFAULT_B = { kind: 'yesterday', date: null };

function periodLabel(period, range, now) {
  if (period.kind === '24h') return 'Last 24 hours';
  if (period.kind === 'today') return 'Today so far';
  if (period.kind === 'yesterday') return 'Yesterday';
  return dayLabel(range.from, now) + (range.partial ? ' so far' : '');
}

export default function Overview({ theme, events, store, now }) {
  const days = store.prefs.window;
  const [periodA, setPeriodA] = useState(DEFAULT_A);
  const [periodB, setPeriodB] = useState(DEFAULT_B);
  const [compare, setCompare] = useState(false);

  const rows = useMemo(() => dailyTotals(events, Math.max(days, 7), now), [events, days, now]);
  const usual = useMemo(() => baseline(dailyTotals(events, 30, now)), [events, now]);
  const suspects = useMemo(() => suspectSleeps(events, now), [events, now]);

  if (!events.length) {
    return (
      <Card theme={theme}>
        <CardTitle theme={theme}>Overview</CardTitle>
        <Muted theme={theme}>Nothing logged yet. This fills in as you go — the first day gives the timeline, three days give a baseline.</Muted>
      </Card>
    );
  }

  return (
    <Card theme={theme}>
      <CardTitle
        theme={theme}
        right={
          <Chip theme={theme} active={compare} onClick={() => { setCompare((v) => !v); if (!compare && periodA.kind === '24h') setPeriodA({ kind: 'today', date: null }); }}>
            Compare
          </Chip>
        }
      >Overview</CardTitle>

      {compare ? (
        <CompareView
          theme={theme} events={events} now={now} usual={usual} rows={rows}
          periodA={periodA} periodB={periodB} onA={setPeriodA} onB={setPeriodB}
        />
      ) : (
        <PeriodView theme={theme} events={events} now={now} usual={usual} rows={rows} period={periodA} onChange={setPeriodA} />
      )}

      {suspects.length > 0 && <SuspectSleeps theme={theme} suspects={suspects} now={now} store={store} />}

      {/* 3. Temperature ----------------------------------------------------- */}
      <TemperatureSection theme={theme} events={events} now={now} store={store} />
    </Card>
  );
}

function SectionLabel({ theme, children, style }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 650, color: theme.ink, margin: '0 0 8px', letterSpacing: '-0.005em', ...style,
    }}>{children}</div>
  );
}

/** Coloured mark beside a text label — identity never rides on text colour. */
function Key({ theme, category, shape = 'dot' }) {
  const c = categoryColor(theme, category);
  if (shape === 'bar') return <span style={{ display: 'inline-block', width: 12, height: 5, borderRadius: 2, background: c, verticalAlign: 'middle' }} />;
  if (shape === 'ring') return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, border: `2px solid ${c}`, boxSizing: 'border-box', verticalAlign: 'middle' }} />;
  if (shape === 'tick') return <span style={{ display: 'inline-block', width: 2, height: 10, borderRadius: 1, background: c, verticalAlign: 'middle' }} />;
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: c, verticalAlign: 'middle' }} />;
}

// ---------------------------------------------------------------------------
// Period picker and the two views it drives.
// ---------------------------------------------------------------------------

const PERIODS = [
  { kind: '24h', label: 'Last 24h' },
  { kind: 'today', label: 'Today' },
  { kind: 'yesterday', label: 'Yesterday' },
  { kind: 'date', label: 'Pick a day' },
];

/** One row of chips, with a date field when a specific day is chosen. */
function PeriodPicker({ theme, period, onChange, now, allowRolling = true, accent }) {
  const options = allowRolling ? PERIODS : PERIODS.filter((p) => p.kind !== '24h');
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {options.map((p) => (
        <Chip
          key={p.kind}
          theme={theme}
          accent={accent}
          active={period.kind === p.kind}
          onClick={() => onChange({ kind: p.kind, date: p.kind === 'date' ? (period.date ?? toDateInput(addDays(now, -2))) : null })}
        >{p.label}</Chip>
      ))}
      {period.kind === 'date' && (
        <input
          type="date"
          value={period.date ?? ''}
          max={toDateInput(now)}
          onChange={(e) => onChange({ kind: 'date', date: e.target.value })}
          style={{
            border: `1px solid ${theme.line}`, background: theme.bg, color: theme.ink,
            borderRadius: 999, padding: '5px 10px', fontSize: 12, minWidth: 0,
          }}
        />
      )}
    </div>
  );
}

function resolve(period, now) {
  const dateTs = period.kind === 'date' ? (fromDateInput(period.date) ?? now) : null;
  return periodRange(period.kind, now, dateTs);
}

/** The baseline that is fair for this period: full-day, or by-this-time. */
function usualFor(events, range, usual, now) {
  if (!range.partial || range.rolling) return usual;
  return usualByElapsed(events, range.elapsedTo - range.from, now);
}

function stripProps(range) {
  if (range.rolling) return { leftLabel: '24h ago', rightLabel: 'now', axisTo: range.elapsedTo };
  return { leftLabel: '00:00', rightLabel: '24:00', axisTo: range.dayEnd };
}

function PeriodView({ theme, events, now, usual, rows, period, onChange }) {
  const range = useMemo(() => resolve(period, now), [period, now]);
  const totals = useMemo(() => windowTotals(events, range.from, range.to + 1, now), [events, range, now]);
  const base = useMemo(() => usualFor(events, range, usual, now), [events, range, usual, now]);
  const label = periodLabel(period, range, now);

  return (
    <>
      <PeriodPicker theme={theme} period={period} onChange={onChange} now={now} />

      <SectionLabel theme={theme} style={{ marginTop: 14 }}>{label}</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', gap: 8 }}>
        {METRICS.map((m) => (
          <StatTile
            key={m.key}
            theme={theme}
            metric={m}
            value={totals[m.key]}
            usual={base.ready ? base[m.key] : null}
            usualWord={base.byTime ? 'usually by now' : 'usually'}
            highlightKey={range.rolling ? null : dayKey(range.from)}
            rows={rows.slice(-7)}
          />
        ))}
      </div>
      <Muted theme={theme} size={11} style={{ marginTop: 8 }}>
        {base.ready
          ? (base.byTime
            ? `“Usually by now” is what the last ${base.days} full days had reached by this time of day.`
            : `“Usually” is the average of the last ${base.days} full ${base.days === 1 ? 'day' : 'days'}.`)
          : `A baseline appears after ${BASELINE_MIN_DAYS} full days — ${base.days} so far.`}
      </Muted>

      <SectionLabel theme={theme} style={{ marginTop: 18 }}>
        {range.rolling ? 'The last 24 hours, hour by hour' : `${label.replace(' so far', '')}, hour by hour`}
      </SectionLabel>
      <Timeline theme={theme} events={events} from={range.from} to={range.to} now={now} {...stripProps(range)} />
    </>
  );
}

/** Two periods side by side: the four metrics with deltas, then both strips. */
function CompareView({ theme, events, now, usual, rows, periodA, periodB, onA, onB }) {
  const a = useMemo(() => resolve(periodA, now), [periodA, now]);
  const b = useMemo(() => resolve(periodB, now), [periodB, now]);
  const ta = useMemo(() => windowTotals(events, a.from, a.to + 1, now), [events, a, now]);
  const tb = useMemo(() => windowTotals(events, b.from, b.to + 1, now), [events, b, now]);
  const la = periodLabel(periodA, a, now);
  const lb = periodLabel(periodB, b, now);
  const accentA = theme.ink;
  const accentB = categoryColor(theme, 'expected');

  const cell = { padding: '7px 6px', fontSize: 13, borderBottom: `1px solid ${theme.line}` };
  const num = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
  const head = { ...cell, fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: theme.inkFaint, fontWeight: 600, textAlign: 'right' };

  const deltaText = (m, va, vb) => {
    const d = va - vb;
    const tol = m.unit === 'minutes' ? 20 : 0.5;
    if (Math.abs(d) < tol) return 'same';
    const sign = d > 0 ? '+' : '−';
    return `${sign}${formatValue(m, Math.abs(d))}`;
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: accentA, width: 14 }}>A</span>
          <PeriodPicker theme={theme} period={periodA} onChange={onA} now={now} allowRolling={false} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: accentB, width: 14 }}>B</span>
          <PeriodPicker theme={theme} period={periodB} onChange={onB} now={now} allowRolling={false} accent={accentB} />
        </div>
      </div>

      {(a.partial || b.partial) && (
        <Muted theme={theme} size={11} style={{ marginTop: 8 }}>
          A day still in progress is compared as far as it has got — the numbers are not final.
        </Muted>
      )}

      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', color: theme.ink }}>
          <thead>
            <tr>
              <th style={{ ...head, textAlign: 'left' }}></th>
              <th style={head}>A · {la}</th>
              <th style={{ ...head, color: accentB }}>B · {lb}</th>
              <th style={head}>A − B</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => (
              <tr key={m.key}>
                <td style={cell}><Key theme={theme} category={m.category} /> {m.label}</td>
                <td style={{ ...num, fontWeight: 650 }}>{formatValue(m, ta[m.key])}</td>
                <td style={{ ...num, fontWeight: 650 }}>{formatValue(m, tb[m.key])}</td>
                <td style={{ ...num, color: theme.inkSoft }}>{deltaText(m, ta[m.key], tb[m.key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionLabel theme={theme} style={{ marginTop: 18, color: accentA }}>A · {la.replace(' so far', '')}</SectionLabel>
      <Timeline theme={theme} events={events} from={a.from} to={a.to} now={now} {...stripProps(a)} />
      <SectionLabel theme={theme} style={{ marginTop: 18, color: accentB }}>B · {lb.replace(' so far', '')}</SectionLabel>
      <Timeline theme={theme} events={events} from={b.from} to={b.to} now={now} {...stripProps(b)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// 1. Stat tile: value, "usually", and the last seven days as a strip.
// ---------------------------------------------------------------------------

function StatTile({ theme, metric, value, usual, rows, usualWord = 'usually', highlightKey = null }) {
  const accent = categoryColor(theme, metric.category);
  const soft = categoryTint(theme, metric.category, theme.name === 'night' ? 0.42 : 0.32);

  // Neither direction is "good" for a baby — more feeds is not a win and fewer
  // is not a loss — so the delta stays in ink, never in status colour.
  let cue = null;
  if (usual != null) {
    const tolerance = metric.unit === 'minutes' ? Math.max(30, usual * 0.1) : Math.max(0.5, usual * 0.1);
    cue = value > usual + tolerance ? '▲' : value < usual - tolerance ? '▼' : '—';
  }

  const max = Math.max(...rows.map((r) => r[metric.key]), 1);
  return (
    <div style={{
      border: `1px solid ${theme.line}`, borderRadius: 14, padding: '10px 11px 9px',
      display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: theme.inkSoft, fontWeight: 600 }}>
        <Key theme={theme} category={metric.category} /> {metric.label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 650, letterSpacing: '-0.02em', color: theme.ink, lineHeight: 1.1 }}>
        {formatValue(metric, value)}
      </div>
      <div style={{ fontSize: 11, color: theme.inkSoft, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {usual != null
          ? <>{cue !== '—' && <span style={{ fontSize: 9, marginRight: 3 }}>{cue}</span>}{usualWord} {formatValue(metric, usual)}</>
          : <span style={{ color: theme.inkFaint }}>no baseline yet</span>}
      </div>
      {/* Seven thin columns; the past in the soft tint, today in the accent. */}
      <svg viewBox="0 0 70 22" width="100%" height="22" style={{ display: 'block', marginTop: 2 }} aria-hidden="true">
        {rows.map((r, i) => {
          if (!r.tracked) return null;
          const h = Math.max(r[metric.key] > 0 ? 2 : 0, (r[metric.key] / max) * 20);
          return (
            <rect
              key={r.key} x={i * 10 + 1} y={22 - h} width={8} height={h} rx={1.5}
              fill={(highlightKey ? r.key === highlightKey : r.isToday) ? accent : soft}
            />
          );
        })}
        <line x1="0" y1="21.5" x2="70" y2="21.5" stroke={theme.line} strokeWidth="1" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. The 24-hour strip.
// ---------------------------------------------------------------------------

function Timeline({ theme, events, from, to, now, leftLabel = '24h ago', rightLabel = 'now', axisTo = to }) {
  const data = useMemo(() => timelineData(events, from, to, now), [events, from, to, now]);
  const longest = useMemo(() => longestSleep(events, from, to, now), [events, from, to, now]);
  const gap = useMemo(() => feedGapInWindow(events, from, to + 1), [events, from, to]);
  const totals = useMemo(() => windowTotals(events, from, to + 1, now), [events, from, to, now]);

  const W = 520;
  const H = 92;
  const pad = 10;
  // The axis may run past the data (a day still in progress runs to 24:00).
  const x = (ts) => pad + ((ts - from) / (axisTo - from)) * (W - 2 * pad);
  const nowInside = now >= from && now <= axisTo;
  const laneSleep = 18;
  const laneFeed = 46;
  const laneDiaper = 68;
  const surface = theme.surfaceBottom;

  const sleepColor = categoryColor(theme, 'night');
  const feedColor = categoryColor(theme, 'nurse');
  const wetColor = categoryColor(theme, 'wet');
  const poopColor = categoryColor(theme, 'poop');

  // Clean hour labels: every local 06/12/18/00 that falls inside the window.
  const ticks = [];
  for (let t = startOfLocalDay(from); t <= axisTo; t += 6 * HOUR) {
    const px = x(t);
    if (px > pad + 44 && px < W - pad - 30) ticks.push(t);
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
        role="img"
        aria-label="Sleeps, feeds and diapers over the last 24 hours"
      >
        {/* Hairline lanes and hour ticks, one step off the surface. */}
        {[laneSleep, laneFeed, laneDiaper].map((y) => (
          <line key={y} x1={pad} y1={y} x2={W - pad} y2={y} stroke={theme.line} strokeWidth="1" />
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={laneSleep - 10} x2={x(t)} y2={laneDiaper + 8} stroke={theme.line} strokeWidth="1" />
            <text x={x(t)} y={H - 4} fontSize="9" fill={theme.inkFaint} textAnchor="middle">{clockTime(t)}</text>
          </g>
        ))}
        <text x={pad} y={H - 4} fontSize="9" fill={theme.inkFaint}>{leftLabel}</text>
        <text x={W - pad} y={H - 4} fontSize="9" fill={theme.inkFaint} textAnchor="end">{rightLabel}</text>

        {/* Sleep spans, 12px thick, square where a session is still running. */}
        {data.sleeps.map((s) => {
          const x0 = x(s.start);
          const x1 = x(s.end);
          return (
            <rect
              key={s.id} x={x0} y={laneSleep - 6} width={Math.max(2, x1 - x0)} height={12}
              rx={s.open ? 0 : 3} fill={sleepColor}
            >
              <title>{`${s.type === 'night' ? 'Night sleep' : 'Nap'} ${clockTime(s.start)}–${s.open ? 'now' : clockTime(s.end)} · ${formatDuration(s.end - s.start)}`}</title>
            </rect>
          );
        })}

        {/* Feeds: nursing filled, bottle as a ring — shape carries the subtype. */}
        {data.feeds.map((f) => (
          <g key={f.id}>
            <circle cx={x(f.ts)} cy={laneFeed} r={7} fill={surface} />
            {f.type === 'nurse'
              ? <circle cx={x(f.ts)} cy={laneFeed} r={5} fill={feedColor} />
              : <circle cx={x(f.ts)} cy={laneFeed} r={4} fill={surface} stroke={feedColor} strokeWidth={2} />}
            <circle cx={x(f.ts)} cy={laneFeed} r={12} fill="transparent">
              <title>{`${f.type === 'nurse' ? 'Nursing' : `Bottle${f.amount ? ` ${f.amount} ml` : ''}`} · ${clockTime(f.ts)}`}</title>
            </circle>
          </g>
        ))}

        {/* Diapers as ticks: wet above the lane, poop below, so a change with
            both never hides one behind the other. */}
        {data.diapers.map((d) => {
          // A small poop is a shorter tick: the size is the point of logging it.
          const h = d.type === 'poop' && d.size === 'small' ? 4 : 8;
          return (
            <g key={d.id}>
              <rect
                x={x(d.ts) - 1} y={d.type === 'wet' ? laneDiaper - 9 : laneDiaper + 1}
                width={2} height={h} rx={1} fill={d.type === 'wet' ? wetColor : poopColor}
              />
              <rect x={x(d.ts) - 6} y={laneDiaper - 12} width={12} height={24} fill="transparent">
                <title>{`${d.type === 'wet' ? 'Wet' : `Poop${d.size ? ` (${d.size})` : ''}`} · ${clockTime(d.ts)}`}</title>
              </rect>
            </g>
          );
        })}

        {/* Now — only when it falls inside the axis. */}
        {nowInside && (
          <line x1={x(now)} y1={laneSleep - 12} x2={x(now)} y2={laneDiaper + 12} stroke={theme.inkSoft} strokeWidth="1" />
        )}
      </svg>

      {/* Legend: with five marks, identity never rests on colour alone. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 4, fontSize: 11, color: theme.inkSoft }}>
        <span><Key theme={theme} category="night" shape="bar" /> Sleep</span>
        <span><Key theme={theme} category="nurse" /> Nursing</span>
        {data.feeds.some((f) => f.type === 'bottle') && (
          <span><Key theme={theme} category="nurse" shape="ring" /> Bottle</span>
        )}
        <span><Key theme={theme} category="wet" shape="tick" /> Wet</span>
        <span><Key theme={theme} category="poop" shape="tick" /> Poop</span>
      </div>

      <Muted theme={theme} size={12} style={{ marginTop: 6, color: theme.ink }}>
        {totals.feeds} {totals.feeds === 1 ? 'feed' : 'feeds'}
        {gap ? ` · every ~${formatGap(gap)}` : ''}
        {longest ? ` · longest sleep ${formatDuration(longest.ms)} (${clockTime(longest.start)}–${longest.open ? 'now' : clockTime(longest.end)})` : ''}
        {` · ${totals.wet} wet · ${totals.poop} poop`}
      </Muted>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Small multiples: one metric per panel, one axis each, never two.
// ---------------------------------------------------------------------------

/** A column with a rounded cap and a square base. */
/**
 * Sleeps the analytics refused: longer than 16 hours, or ending before
 * they start. Each one would add a full day of sleep to every day it spans.
 * Named here with a way to fix or delete, never dropped quietly.
 */
function SuspectSleeps({ theme, suspects, now, store }) {
  return (
    <div style={{
      marginTop: 16, padding: '10px 12px', borderRadius: 12,
      background: categoryTint(theme, 'night', 0.10), border: `1px solid ${theme.warn}`,
    }}>
      <div style={{ fontSize: 12.5, fontWeight: 650, color: theme.warn }}>
        {suspects.length === 1 ? 'One sleep entry looks wrong' : `${suspects.length} sleep entries look wrong`} and is left out of the totals
      </div>
      {suspects.map((e) => (
        <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 12, color: theme.ink, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 160 }}>
            {e.type === 'night' ? 'Night sleep' : 'Nap'} {shortDate(e.start_ts)} {clockTime(e.start_ts)}
            {' → '}{e.end_ts == null ? 'still open' : `${shortDate(e.end_ts)} ${clockTime(e.end_ts)}`}
            {' · '}{formatDuration(Math.abs((e.end_ts ?? now) - e.start_ts))}
          </span>
          <Button theme={theme} onClick={() => store.update(e.id, { end_ts: e.start_ts + 2 * HOUR })} style={{ padding: '4px 9px', fontSize: 12 }} title="Set the end to two hours after the start; adjust in the day log">
            End after 2h
          </Button>
          <Button theme={theme} onClick={() => store.remove(e.id, 'Sleep')} style={{ padding: '4px 9px', fontSize: 12, color: theme.bad }}>Delete</Button>
        </div>
      ))}
      <Muted theme={theme} size={11} style={{ marginTop: 6 }}>Open the day log on that date to set the exact times.</Muted>
    </div>
  );
}

const TEMP_RANGES = [
  { key: '24h', label: '24h', hours: 24 },
  { key: '3d', label: '3 days', hours: 72 },
  { key: '7d', label: '7 days', hours: 168 },
];

/**
 * Temperature in detail: every reading at its exact time, the fever zone
 * shaded, and the readings listed newest first with the change from the one
 * before. For an illness, not for every day — with nothing in the last week
 * it is one quiet line.
 */
function TemperatureSection({ theme, events, now, store }) {
  const [rangeKey, setRangeKey] = useState('3d');
  const range = TEMP_RANGES.find((r) => r.key === rangeKey) || TEMP_RANGES[1];
  const all = useMemo(() => tempReadings(events), [events]);
  const inWeek = all.filter((r) => r.start_ts >= now - 168 * HOUR);
  const accent = categoryColor(theme, 'temp');

  if (!inWeek.length) {
    return (
      <div style={{ marginTop: 18 }}>
        <SectionLabel theme={theme}>Temperature</SectionLabel>
        <Muted theme={theme}>No readings in the last week. Measure from the care card when she feels warm; the line and the list appear here.</Muted>
      </div>
    );
  }

  const from = now - range.hours * HOUR;
  const shown = all.filter((r) => r.start_ts >= from);
  const listed = [...inWeek].reverse();

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <SectionLabel theme={theme} style={{ margin: 0 }}>Temperature</SectionLabel>
        <div style={{ display: 'flex', gap: 6 }}>
          {TEMP_RANGES.map((r) => (
            <Chip key={r.key} theme={theme} accent={accent} active={rangeKey === r.key} onClick={() => setRangeKey(r.key)}>{r.label}</Chip>
          ))}
        </div>
      </div>

      {shown.length ? (
        <TempChart theme={theme} readings={shown} from={from} now={now} accent={accent} />
      ) : (
        <Muted theme={theme} style={{ marginTop: 8 }}>No readings in the last {range.label}.</Muted>
      )}

      <div style={{ marginTop: 8 }}>
        {listed.map((r, i) => {
          const prev = listed[i + 1] || null;
          const delta = prev ? r.c - prev.c : null;
          const fever = isFever(r.amount);
          return (
            <div key={r.id} style={{
              display: 'grid', gridTemplateColumns: 'minmax(84px, auto) 56px 1fr auto', alignItems: 'baseline', columnGap: 8, padding: '6px 0',
              borderTop: i ? `1px solid ${theme.line}` : 'none', fontSize: 12, color: theme.ink,
            }}>
              <span style={{ color: theme.inkSoft, whiteSpace: 'nowrap' }}>{dayLabel(r.start_ts, now)} {clockTime(r.start_ts)}</span>
              <span style={{ fontWeight: 650, color: fever ? theme.warn : theme.ink, fontVariantNumeric: 'tabular-nums' }}>{formatTemp(r.amount)}</span>
              <span style={{ color: theme.inkFaint, fontVariantNumeric: 'tabular-nums', minWidth: 0 }}>
                {delta == null ? 'first reading' : delta === 0 ? 'no change' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} since ${clockTime(prev.start_ts)}`}
              </span>
              <span style={{ color: theme.inkFaint, fontSize: 11, whiteSpace: 'nowrap', textAlign: 'right' }}>{timeAgo(r.start_ts, now)}</span>
            </div>
          );
        })}
      </div>
      <Muted theme={theme} size={11} style={{ marginTop: 6 }}>
        <span style={{ color: theme.warn }}>shaded</span> = {FEVER_C.toFixed(1)} °C and above · tap an entry in the day log to correct it
      </Muted>
    </div>
  );
}

/**
 * Readings on a time axis with hour and day ticks sized to the range, the
 * fever zone shaded, every point labelled that has room. Fixed aspect.
 */
function TempChart({ theme, readings, from, now, accent }) {
  const W = 340;
  const H = 150;
  const pad = { top: 16, right: 14, bottom: 30, left: 30 };
  const to = now;
  const temps = readings.map((r) => r.c);
  const minY = Math.floor(Math.min(36.5, ...temps) - 0.4);
  const maxY = Math.ceil(Math.max(38.5, ...temps) + 0.3);
  const x = (ts) => pad.left + ((ts - from) / (to - from)) * (W - pad.left - pad.right);
  const y = (c) => pad.top + (1 - (c - minY) / (maxY - minY)) * (H - pad.top - pad.bottom);
  const path = readings.map((r, i) => `${i ? 'L' : 'M'}${x(r.start_ts).toFixed(1)},${y(r.c).toFixed(1)}`).join(' ');
  const hours = (to - from) / HOUR;
  const tickEvery = hours <= 24 ? 6 * HOUR : hours <= 72 ? 12 * HOUR : 24 * HOUR;
  const ticks = [];
  const first = Math.ceil(from / tickEvery) * tickEvery;
  for (let t = first; t < to - HOUR; t += tickEvery) {
    const d = new Date(t);
    // Round to the local wall clock so 12-hour ticks land at 00:00 / 12:00.
    d.setMinutes(0, 0, 0);
    const local = d.getHours() % (tickEvery / HOUR);
    if (local !== 0) continue;
    if (x(d.getTime()) < W - pad.right - 28) ticks.push(d.getTime());
  }
  const gridY = [];
  for (let g = minY; g <= maxY; g += 1) gridY.push(g);
  const latest = readings[readings.length - 1];
  const highest = readings.reduce((m, r) => (r.c > m.c ? r : m), readings[0]);
  const labelled = new Set([latest.id]);
  const taken = [x(latest.start_ts)];
  if (highest.id !== latest.id && Math.abs(x(highest.start_ts) - taken[0]) >= 30) { labelled.add(highest.id); taken.push(x(highest.start_ts)); }
  for (const r of readings) {
    if (labelled.has(r.id)) continue;
    const px = x(r.start_ts);
    if (taken.every((tx) => Math.abs(px - tx) >= 30)) { labelled.add(r.id); taken.push(px); }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', marginTop: 8, overflow: 'visible' }} role="img" aria-label="Temperature readings over time">
      {FEVER_C < maxY && (
        <rect x={pad.left} y={y(maxY)} width={W - pad.left - pad.right} height={Math.max(0, y(FEVER_C) - y(maxY))} fill={categoryTint(theme, 'temp', theme.name === 'night' ? 0.16 : 0.10)} />
      )}
      {gridY.map((g) => (
        <g key={g}>
          <line x1={pad.left} y1={y(g)} x2={W - pad.right} y2={y(g)} stroke={theme.line} strokeWidth="0.75" />
          <text x={pad.left - 6} y={y(g) + 3} fontSize="8.5" fill={theme.inkFaint} textAnchor="end">{g}°</text>
        </g>
      ))}
      <line x1={pad.left} y1={y(FEVER_C)} x2={W - pad.right} y2={y(FEVER_C)} stroke={theme.warn} strokeWidth="1" strokeDasharray="4 3" />
      {ticks.map((t) => {
        const d = new Date(t);
        const label = d.getHours() === 0 ? shortDate(t) : clockTime(t);
        return (
          <g key={t}>
            <line x1={x(t)} y1={pad.top} x2={x(t)} y2={H - pad.bottom} stroke={theme.line} strokeWidth="0.75" />
            <text x={x(t)} y={H - pad.bottom + 11} fontSize="8.5" fill={theme.inkFaint} textAnchor="middle">{label}</text>
          </g>
        );
      })}
      <text x={W - pad.right} y={H - pad.bottom + 11} fontSize="8.5" fill={theme.inkFaint} textAnchor="end">now</text>
      <text x={pad.left} y={H - 4} fontSize="8.5" fill={theme.inkFaint}>{shortDate(from)} {clockTime(from)}</text>
      {readings.length > 1 && <path d={path} fill="none" stroke={accent} strokeWidth="1.5" strokeLinejoin="round" />}
      {readings.map((r) => (
        <g key={r.id}>
          <circle cx={x(r.start_ts)} cy={y(r.c)} r="3.2" fill={isFever(r.amount) ? theme.warn : accent} stroke={theme.surface} strokeWidth="1.5">
            <title>{`${r.c.toFixed(1)} °C · ${shortDate(r.start_ts)} ${clockTime(r.start_ts)}`}</title>
          </circle>
          {labelled.has(r.id) && (
            <text
              x={Math.max(pad.left + 10, Math.min(W - pad.right - 10, x(r.start_ts)))} y={y(r.c) - 7}
              fontSize="9" fill={theme.inkSoft} textAnchor="middle" fontVariantNumeric="tabular-nums"
              stroke={theme.surface} strokeWidth="3" paintOrder="stroke"
            >{r.c.toFixed(1)}</text>
          )}
        </g>
      ))}
    </svg>
  );
}
